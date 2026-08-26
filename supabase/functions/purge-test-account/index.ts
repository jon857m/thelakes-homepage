import Stripe from "npm:stripe@^22";
import { corsHeaders, json } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";

type RequestBody = {
  action?: "preview" | "purge";
  targetUserId?: string;
  confirmation?: string;
  purgeStripe?: boolean;
};

type BusinessRow = { id: string; name: string };
type SubscriptionRow = {
  business_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

function unique(values: (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}

async function listBusinessStorage(admin: ReturnType<typeof adminClient>, businessId: string) {
  const objects: { id: string | null; name: string }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from("business-images").list(businessId, { limit: 1000, offset });
    if (error) throw new Error(`Could not inspect Storage for ${businessId}: ${errorMessage(error, "Unknown Storage error")}`);
    const page = (data ?? []) as { id: string | null; name: string }[];
    objects.push(...page.filter((item) => item.id));
    if (page.length < 1000) break;
  }
  return objects;
}

async function requireAdmin(authorization: string) {
  const scoped = userClient(authorization);
  const { data: { user }, error } = await scoped.auth.getUser();
  if (error || !user) throw new Error("AUTH_REQUIRED");

  const { data: isAdmin, error: adminError } = await scoped.rpc("is_admin");
  if (adminError || !isAdmin) throw new Error("ADMIN_REQUIRED");
  return { caller: user, scoped, admin: adminClient() };
}

async function accountSnapshot(admin: ReturnType<typeof adminClient>, scoped: ReturnType<typeof userClient>, targetUserId: string) {
  const { data: userResult, error: userError } = await admin.auth.admin.getUserById(targetUserId);
  if (userError || !userResult.user) throw new Error("Account not found.");

  const { data: businesses, error: businessError } = await admin.from("businesses")
    .select("id,name").eq("owner_user_id", targetUserId).order("name");
  if (businessError) throw new Error(`Could not load owned businesses: ${errorMessage(businessError, "Unknown database error")}`);
  const businessRows = (businesses ?? []) as BusinessRow[];
  const businessIds = businessRows.map((business) => business.id);

  let subscriptions: SubscriptionRow[] = [];
  let imageRows = 0;
  let storageObjects = 0;
  if (businessIds.length) {
    const [subscriptionResult, imageResult] = await Promise.all([
      admin.from("business_subscriptions")
        .select("business_id,stripe_customer_id,stripe_subscription_id")
        .in("business_id", businessIds),
      scoped.from("business_images").select("id").in("business_id", businessIds),
    ]);
    if (subscriptionResult.error) throw new Error(`Could not load subscriptions: ${errorMessage(subscriptionResult.error, "Unknown database error")}`);
    if (imageResult.error) throw new Error(`Could not count image records: ${errorMessage(imageResult.error, "Unknown database error")}`);
    subscriptions = (subscriptionResult.data ?? []) as SubscriptionRow[];
    imageRows = imageResult.data?.length ?? 0;

    for (const businessId of businessIds) {
      storageObjects += (await listBusinessStorage(admin, businessId)).length;
    }
  }

  return {
    user: { id: userResult.user.id, email: userResult.user.email ?? "" },
    businesses: businessRows,
    databaseImageRows: imageRows,
    storageObjects,
    stripeCustomerIds: unique(subscriptions.map((item) => item.stripe_customer_id)),
    stripeSubscriptionIds: unique(subscriptions.map((item) => item.stripe_subscription_id)),
  };
}

async function removeBusinessStorage(admin: ReturnType<typeof adminClient>, businessIds: string[]) {
  let deleted = 0;
  for (const businessId of businessIds) {
    const paths = (await listBusinessStorage(admin, businessId)).map((item) => `${businessId}/${item.name}`);
    for (let index = 0; index < paths.length; index += 1000) {
      const batch = paths.slice(index, index + 1000);
      const { error: removeError } = await admin.storage.from("business-images").remove(batch);
      if (removeError) throw removeError;
      deleted += batch.length;
    }
  }
  return deleted;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (Deno.env.get("ALLOW_TEST_ACCOUNT_PURGE") !== "true") {
      return json({ error: "Test-account purge is disabled on this Supabase project." }, 403);
    }

    const authorization = request.headers.get("Authorization") ?? "";
    const { caller, scoped, admin } = await requireAdmin(authorization);
    const { action, targetUserId, confirmation, purgeStripe = false } = await request.json() as RequestBody;
    if (!targetUserId) return json({ error: "Choose an account to purge." }, 400);
    if (targetUserId === caller.id) return json({ error: "You cannot purge the admin account you are signed in with." }, 409);

    const snapshot = await accountSnapshot(admin, scoped, targetUserId);
    if (action === "preview") return json(snapshot);
    if (action !== "purge") return json({ error: "Unknown action." }, 400);
    if (!snapshot.user.email || confirmation?.trim().toLowerCase() !== snapshot.user.email.toLowerCase()) {
      return json({ error: "Type the account email exactly to confirm the purge." }, 400);
    }

    if (purgeStripe && snapshot.stripeCustomerIds.length) {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
      if (!stripeKey.startsWith("sk_test_")) {
        return json({ error: "Stripe deletion is allowed only when STRIPE_SECRET_KEY is a test-mode key." }, 409);
      }
      const stripe = new Stripe(stripeKey);
      for (const customerId of snapshot.stripeCustomerIds) await stripe.customers.del(customerId);
    }

    const businessIds = snapshot.businesses.map((business) => business.id);
    const removedStorageObjects = await removeBusinessStorage(admin, businessIds);
    if (businessIds.length) {
      const { error: deleteError } = await admin.from("businesses").delete().in("id", businessIds);
      if (deleteError) throw new Error(`Could not delete owned businesses: ${errorMessage(deleteError, "Unknown database error")}`);
    }
    const { error: authError } = await admin.auth.admin.deleteUser(targetUserId);
    if (authError) throw authError;

    return json({
      deleted: true,
      email: snapshot.user.email,
      businesses: businessIds.length,
      storageObjects: removedStorageObjects,
      stripeCustomers: purgeStripe ? snapshot.stripeCustomerIds.length : 0,
    });
  } catch (error) {
    console.error(error);
    const message = errorMessage(error, "Unable to purge the test account.");
    if (message === "AUTH_REQUIRED") return json({ error: "Sign in to continue." }, 401);
    if (message === "ADMIN_REQUIRED") return json({ error: "Administrator access is required." }, 403);
    return json({ error: message }, 500);
  }
});
