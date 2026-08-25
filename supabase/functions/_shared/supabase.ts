import { createClient } from "npm:@supabase/supabase-js@2";

function namedKey(variable: string, legacyVariable: string) {
  const named = Deno.env.get(variable);
  if (named) {
    const values = JSON.parse(named) as Record<string, string>;
    if (values.default) return values.default;
    const first = Object.values(values)[0];
    if (first) return first;
  }
  const legacy = Deno.env.get(legacyVariable);
  if (!legacy) throw new Error(`Missing ${variable}`);
  return legacy;
}

export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    namedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
}

export function userClient(authorization: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    namedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"),
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
  );
}
