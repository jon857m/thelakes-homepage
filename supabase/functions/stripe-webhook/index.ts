import Stripe from "npm:stripe@^22";
import { json } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const cryptoProvider = Stripe.createSubtleCryptoProvider();

function listingStatus(status: Stripe.Subscription.Status) {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid" || status === "incomplete") return "past_due";
  if (status === "canceled" || status === "incomplete_expired") return "cancelled";
  return "awaiting_payment";
}

function subscriptionPriority(subscription: Stripe.Subscription) {
  const rank: Partial<Record<Stripe.Subscription.Status, number>> = {
    active: 60,
    trialing: 50,
    past_due: 40,
    unpaid: 30,
    incomplete: 20,
    paused: 10,
    canceled: 0,
    incomplete_expired: -10,
  };
  return (rank[subscription.status] ?? 0) * 10_000_000_000 + subscription.created;
}

function belongsToBusiness(subscription: Stripe.Subscription, businessId: string) {
  return subscription.metadata.business_id === businessId;
}

async function reconcileBusinessSubscription(
  admin: ReturnType<typeof adminClient>,
  businessId: string,
  customerId: string,
) {
  const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
  const relevant = subscriptions.data.filter((subscription) => belongsToBusiness(subscription, businessId));
  if (!relevant.length) return;

  // Stripe can deliver events out of order. Always retain the best current
  // entitlement, so an older cancelled subscription cannot hide a newer one.
  const selected = relevant.sort((a, b) => subscriptionPriority(b) - subscriptionPriority(a))[0];
  const periodEnd = selected.items.data[0]?.current_period_end;
  const cancellationDate = selected.cancel_at ?? null;
  const { error: subscriptionError } = await admin.from("business_subscriptions").update({
    stripe_customer_id: customerId,
    stripe_subscription_id: selected.id,
    stripe_price_id: selected.items.data[0]?.price.id ?? null,
    stripe_status: selected.status,
    current_period_end: cancellationDate
      ? new Date(cancellationDate * 1000).toISOString()
      : periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: selected.cancel_at_period_end || Boolean(cancellationDate),
    updated_at: new Date().toISOString(),
  }).eq("business_id", businessId);
  assertDatabaseWrite(subscriptionError, "Reconciling subscription state");

  const { error: businessError } = await admin.from("businesses")
    .update({ listing_status: listingStatus(selected.status) })
    .eq("id", businessId);
  assertDatabaseWrite(businessError, "Reconciling listing state");
}
function assertDatabaseWrite(error: { message: string } | null, operation: string) {
  if (error) throw new Error(`${operation}: ${error.message}`);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const signature = request.headers.get("stripe-signature") ?? "";
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
      undefined,
      cryptoProvider,
    );
  } catch (error) {
    console.error("Invalid Stripe signature", error);
    return json({ error: "Invalid signature" }, 400);
  }

  const admin = adminClient();
  const { error: claimError } = await admin.from("stripe_webhook_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
  });
  if (claimError?.code === "23505") return json({ received: true, duplicate: true });
  if (claimError) return json({ error: claimError.message }, 500);

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const businessId = session.metadata?.business_id ?? session.client_reference_id;
      if (businessId) {
        const { error } = await admin.from("business_subscriptions").update({
          stripe_customer_id: String(session.customer),
          stripe_subscription_id: String(session.subscription),
          updated_at: new Date().toISOString(),
        }).eq("business_id", businessId);
        assertDatabaseWrite(error, "Recording completed Checkout");
      }
    }

    if (event.type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as Stripe.Subscription;
      const businessId = subscription.metadata.business_id;
      if (businessId) {
        await reconcileBusinessSubscription(admin, businessId, String(subscription.customer));
      }
    }

    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.parent?.subscription_details?.subscription === "string"
        ? invoice.parent.subscription_details.subscription
        : invoice.parent?.subscription_details?.subscription?.id;
      if (subscriptionId) {
        const { error: subscriptionError } = await admin.from("business_subscriptions").update({
          stripe_status: event.type === "invoice.paid" ? "active" : "past_due",
          updated_at: new Date().toISOString(),
        }).eq("stripe_subscription_id", subscriptionId);
        assertDatabaseWrite(subscriptionError, "Updating invoice state");
        const { data: record } = await admin.from("business_subscriptions").select("business_id").eq("stripe_subscription_id", subscriptionId).single();
        if (record) {
          const { error: businessError } = await admin.from("businesses").update({ listing_status: event.type === "invoice.paid" ? "active" : "past_due" }).eq("id", record.business_id);
          assertDatabaseWrite(businessError, "Updating listing from invoice");
        }
      }
    }

    return json({ received: true });
  } catch (error) {
    await admin.from("stripe_webhook_events").delete().eq("stripe_event_id", event.id);
    console.error(error);
    return json({ error: "Webhook processing failed" }, 500);
  }
});
