const SETTINGS_TTL_MS = 5000;
const BYPASS_COOKIE = "tl_maintenance_bypass";
let settingsCache = null;

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function signingKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function createBypassCookie(secret) {
  const expires = Date.now() + 8 * 60 * 60 * 1000;
  const payload = String(expires);
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}

async function hasValidBypass(request, secret) {
  if (!secret) return false;
  const cookie = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${BYPASS_COOKIE}=`));
  const value = cookie?.slice(BYPASS_COOKIE.length + 1);
  if (!value) return false;
  const [expires, signature] = value.split(".");
  if (!expires || !signature || Number(expires) <= Date.now()) return false;
  return crypto.subtle.verify("HMAC", await signingKey(secret), decode(signature), new TextEncoder().encode(expires));
}

async function isSupabaseAdmin(request, env) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization, "Content-Type": "application/json" },
    body: "{}",
  });
  return response.ok && await response.json() === true;
}

async function getSettings(env) {
  if (settingsCache && Date.now() - settingsCache.fetchedAt < SETTINGS_TTL_MS) return settingsCache.value;
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/site_operations?id=eq.global&select=maintenance_enabled,maintenance_message,expected_back_at`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
  });
  if (!response.ok) throw new Error(`Operations API returned ${response.status}`);
  const [value] = await response.json();
  settingsCache = { fetchedAt: Date.now(), value };
  return value;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function maintenanceResponse(settings, request) {
  const expected = settings.expected_back_at
    ? `<p class="return">Expected back: <strong>${escapeHtml(new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(settings.expected_back_at)))}</strong></p>`
    : "";
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Briefly unavailable | The Lake District</title><style>
    *{box-sizing:border-box}html,body{min-height:100%;margin:0}body{display:grid;place-items:center;padding:24px;color:#f7f2e5;background:radial-gradient(circle at 30% 20%,#45654d 0,#1d3526 42%,#101c15 100%);font-family:Inter,ui-sans-serif,system-ui,sans-serif}.card{width:min(620px,100%);padding:42px;border:1px solid rgba(255,255,255,.2);border-radius:26px;background:rgba(14,29,19,.58);box-shadow:0 28px 80px rgba(0,0,0,.3);backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:14px}.mark{display:grid;width:62px;height:62px;place-items:center;border:1px solid rgba(255,255,255,.25);border-radius:15px;background:linear-gradient(145deg,#dfbc68,#87612d);box-shadow:0 12px 35px rgba(0,0,0,.3);font:700 25px Georgia,serif}.brand strong,.brand small{display:block}.brand strong{font:700 25px/1 Georgia,serif}.brand small{margin-top:7px;color:rgba(247,242,229,.65);font-size:11px;letter-spacing:.08em;text-transform:uppercase}.rule{width:72px;height:3px;margin:30px 0 24px;border-radius:99px;background:#e7bd5e}h1{max-width:480px;margin:0 0 16px;font:700 46px/1.02 Georgia,serif}p{color:rgba(247,242,229,.76);line-height:1.6}.return{margin-top:22px;color:#f2d990}.admin{display:inline-block;margin-top:24px;color:rgba(247,242,229,.5);font-size:11px}@media(max-width:600px){.card{padding:28px 24px}h1{font-size:37px}}
  </style></head><body><main class="card"><div class="brand"><span class="mark">LD</span><span><strong>The Lake District</strong><small>Visitor &amp; local community hub</small></span></div><div class="rule"></div><h1>We’ll be back shortly</h1><p>${escapeHtml(settings.maintenance_message)}</p>${expected}<a class="admin" href="/map/login/">Administrator access</a></main></body></html>`;
  return new Response(request.method === "HEAD" ? null : body, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "300", "X-Robots-Tag": "noindex" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/_ops/maintenance/bypass") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (!await isSupabaseAdmin(request, env)) return new Response("Forbidden", { status: 403 });
      const cookie = await createBypassCookie(env.BYPASS_SIGNING_SECRET);
      return new Response(null, { status: 204, headers: { "Set-Cookie": `${BYPASS_COOKIE}=${cookie}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict` } });
    }

    if (await hasValidBypass(request, env.BYPASS_SIGNING_SECRET)) return fetch(request);
    const loginBootstrap = url.pathname.startsWith("/map/login") || url.pathname.startsWith("/map/assets/") || url.pathname.startsWith("/map/brand/");
    try {
      const settings = await getSettings(env);
      if (settings?.maintenance_enabled && !loginBootstrap) return maintenanceResponse(settings, request);
    } catch (error) {
      console.error("Maintenance settings unavailable; failing open", error);
    }
    return fetch(request);
  },
};
