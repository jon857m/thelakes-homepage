import { json } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import { escapeHtml, sendAdminEmail } from "../_shared/email.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (request.headers.get("x-cron-secret") !== Deno.env.get("ABANDONMENT_CRON_SECRET")) return json({ error: "Forbidden" }, 403);
  const admin = adminClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.from("businesses").select("id,owner_user_id,name,category,town,postcode,created_at,last_subscriber_activity_at")
    .eq("listing_type", "subscriber").in("listing_status", ["draft", "awaiting_payment"])
    .is("abandonment_notified_at", null).lt("created_at", cutoff).limit(100);
  if (error) return json({ error: error.message }, 500);
  let notified = 0;
  for (const business of data ?? []) {
    const lastActivity = business.last_subscriber_activity_at ?? business.created_at;
    if (lastActivity > cutoff) continue;
    const { data: userData } = await admin.auth.admin.getUserById(business.owner_user_id);
    const delivery = await sendAdminEmail(`Incomplete subscriber signup: ${business.name}`, `<h1>Incomplete subscriber signup</h1><p><strong>${escapeHtml(business.name)}</strong> has not completed subscription within 24 hours.</p><p>Email: ${escapeHtml(userData.user?.email)}<br>Category: ${escapeHtml(business.category)}<br>Location: ${escapeHtml([business.town, business.postcode].filter(Boolean).join(", "))}</p>`);
    if (!delivery.sent) continue;
    await admin.from("businesses").update({ abandonment_notified_at: new Date().toISOString() }).eq("id", business.id);
    notified += 1;
  }
  return json({ checked: data?.length ?? 0, notified });
});
