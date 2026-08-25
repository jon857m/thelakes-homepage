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
    const { data: business } = await admin.from("businesses")
      .select("id,name,owner_user_id,listing_type,listing_status")
      .eq("id", businessId).eq("owner_user_id", user.id).single();
    if (!business || business.listing_type !== "subscriber") return json({ error: "Listing not found" }, 404);
    if (!["draft", "awaiting_payment", "past_due", "cancelled"].includes(business.listing_status)) {
      return json({ error: "This listing already has an active subscription" }, 409);
    }

    const { data: subscription } = await admin.from("business_subscriptions")
      .select("*").eq("business_id", business.id).single();
    if (!subscription) return json({ error: "Subscription record not found" }, 409);

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

    const origin = Deno.env.get("SITE_URL") ?? "https://www.thelakesincumbria.co.uk";
    const priceId = Deno.env.get("STRIPE_PRICE_STANDARD_MONTHLY");
    if (!priceId) throw new Error("The Stripe monthly price has not been configured");

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
