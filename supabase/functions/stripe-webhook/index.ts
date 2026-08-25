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
        await admin.from("business_subscriptions").update({
          stripe_customer_id: String(session.customer),
          stripe_subscription_id: String(session.subscription),
          updated_at: new Date().toISOString(),
        }).eq("business_id", businessId);
      }
    }

    if (event.type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as Stripe.Subscription;
      const businessId = subscription.metadata.business_id;
      if (businessId) {
        const periodEnd = subscription.items.data[0]?.current_period_end;
        await admin.from("business_subscriptions").update({
          stripe_customer_id: String(subscription.customer),
          stripe_subscription_id: subscription.id,
          stripe_price_id: subscription.items.data[0]?.price.id ?? null,
          stripe_status: subscription.status,
          current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          cancel_at_period_end: subscription.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        }).eq("business_id", businessId);
        await admin.from("businesses").update({ listing_status: listingStatus(subscription.status) }).eq("id", businessId);
      }
    }

    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.parent?.subscription_details?.subscription === "string"
        ? invoice.parent.subscription_details.subscription
        : invoice.parent?.subscription_details?.subscription?.id;
      if (subscriptionId) {
        await admin.from("business_subscriptions").update({
          stripe_status: event.type === "invoice.paid" ? "active" : "past_due",
          updated_at: new Date().toISOString(),
        }).eq("stripe_subscription_id", subscriptionId);
        const { data: record } = await admin.from("business_subscriptions").select("business_id").eq("stripe_subscription_id", subscriptionId).single();
        if (record) await admin.from("businesses").update({ listing_status: event.type === "invoice.paid" ? "active" : "past_due" }).eq("id", record.business_id);
      }
    }

    return json({ received: true });
  } catch (error) {
    await admin.from("stripe_webhook_events").delete().eq("stripe_event_id", event.id);
    console.error(error);
    return json({ error: "Webhook processing failed" }, 500);
  }
});
