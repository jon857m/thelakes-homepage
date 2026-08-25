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
    const admin = adminClient();
    const { data: subscription } = await admin.from("business_subscriptions")
      .select("stripe_customer_id")
      .eq("business_id", businessId).eq("owner_user_id", user.id).single();
    if (!subscription?.stripe_customer_id) return json({ error: "No billing account exists for this listing" }, 404);

    const origin = Deno.env.get("SITE_URL") ?? "https://www.thelakesincumbria.co.uk";
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${origin}/map/business/?billing=returned`,
    });
    return json({ url: session.url });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to open billing" }, 500);
  }
});
