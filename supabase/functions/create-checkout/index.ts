import Stripe from "npm:stripe@^22";
import { corsHeaders, json } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization") ?? "";
    const scoped = userClient(authorization);
    const { data: { user }, error: userError } = await scoped.auth.getUser();
    if (userError || !user) return json({ error: "Sign in to continue" }, 401);

    const { businessId } = await request.json() as { businessId?: string };
    if (!businessId) return json({ error: "Choose a business listing" }, 400);

    const admin = adminClient();
    const { data: operations, error: operationsError } = await admin.from("site_operations")
      .select("maintenance_enabled,signup_paused").eq("id", "global").single();
    if (operationsError) throw new Error(`Unable to check site availability: ${operationsError.message}`);
    if (operations?.maintenance_enabled || operations?.signup_paused) {
      return json({ error: "New subscriptions are temporarily paused. Please try again shortly." }, 503);
    }

    const { data: business, error: businessError } = await scoped.from("businesses")
      .select("id,name,owner_user_id,listing_type,listing_status")
      .eq("id", businessId).single();
    if (businessError) {
      console.error("Unable to load checkout listing", businessError);
      return json({ error: businessError.code === "PGRST116" ? "This listing does not belong to your account" : businessError.message }, businessError.code === "PGRST116" ? 404 : 500);
    }
    if (!business || business.owner_user_id !== user.id) return json({ error: "This listing does not belong to your account" }, 404);
    if (business.listing_type !== "subscriber") return json({ error: "Editorial listings cannot be subscribed to" }, 409);
    if (!["draft", "awaiting_payment", "past_due", "cancelled"].includes(business.listing_status)) {
      return json({ error: "This listing already has an active subscription" }, 409);
    }
    const { data: subscription, error: subscriptionError } = await admin.from("business_subscriptions")
      .select("*").eq("business_id", business.id).single();
    if (subscriptionError) {
      console.error("Unable to load subscription record", subscriptionError);
      return json({ error: subscriptionError.message }, 500);
    }
    if (!subscription) return json({ error: "Subscription record not found" }, 409);

    const priceId = Deno.env.get("STRIPE_PRICE_STANDARD_MONTHLY");
    if (!priceId) throw new Error("The Stripe monthly price has not been configured");

    let customerId = subscription.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: business.name,
        metadata: { supabase_user_id: user.id, business_id: business.id },
      });
      customerId = customer.id;
      await admin.from("business_subscriptions").update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() }).eq("business_id", business.id);
    }

    const stripeSubscriptions = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
    const existing = stripeSubscriptions.data
      .filter((candidate) => !["canceled", "incomplete_expired"].includes(candidate.status))
      .find((candidate) => candidate.metadata.business_id === business.id || (
        !candidate.metadata.business_id && candidate.items.data.some((item) => item.price.id === priceId)
      ));
    if (existing) {
      const periodEnd = existing.items.data[0]?.current_period_end;
      const cancellationDate = existing.cancel_at ?? null;
      const paidStatus = existing.status === "active" || existing.status === "trialing" ? "active" : "past_due";
      const { error: reconciliationError } = await admin.from("business_subscriptions").update({
        stripe_subscription_id: existing.id,
        stripe_price_id: existing.items.data[0]?.price.id ?? priceId,
        stripe_status: existing.status,
        current_period_end: cancellationDate
          ? new Date(cancellationDate * 1000).toISOString()
          : periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        cancel_at_period_end: existing.cancel_at_period_end || Boolean(cancellationDate),
        updated_at: new Date().toISOString(),
      }).eq("business_id", business.id);
      if (reconciliationError) throw new Error(`Unable to reconcile subscription: ${reconciliationError.message}`);
      const { error: listingError } = await admin.from("businesses").update({ listing_status: paidStatus }).eq("id", business.id);
      if (listingError) throw new Error(`Unable to reconcile listing: ${listingError.message}`);
      return json({ error: "This listing already has a Stripe subscription. Use Manage billing instead of subscribing again." }, 409);
    }

    const origin = Deno.env.get("SITE_URL") ?? "https://www.thelakesincumbria.co.uk";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: business.id,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${origin}/map/business/?checkout=success`,
      cancel_url: `${origin}/map/business/?checkout=cancelled`,
      metadata: { business_id: business.id, owner_user_id: user.id },
      subscription_data: { metadata: { business_id: business.id, owner_user_id: user.id } },
    });

    await admin.from("businesses").update({ listing_status: "awaiting_payment" }).eq("id", business.id);
    return json({ url: session.url });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to start checkout" }, 500);
  }
});
