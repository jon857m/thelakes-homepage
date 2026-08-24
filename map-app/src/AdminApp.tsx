import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

type AdminBusiness = {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  category: string;
  latitude: number;
  longitude: number;
  address: string | null;
  town: string | null;
  postcode: string | null;
  website_url: string | null;
  phone: string | null;
  listing_type: "editorial" | "subscriber";
  listing_status: "draft" | "awaiting_payment" | "active" | "past_due" | "cancelled" | "suspended";
  featured: boolean;
};

const categories = ["Accommodation", "Camping", "Eating", "Activities", "Gifts"];
const statuses: AdminBusiness["listing_status"][] = ["draft", "awaiting_payment", "active", "past_due", "cancelled", "suspended"];

function Login({ onSession }: { onSession: (session: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setMessage(error.message);
    else if (data.session) onSession(data.session);
  }

  async function resetPassword() {
    if (!supabase || !email) return setMessage("Enter your email address first.");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/map/login/`
    });
    setMessage(error ? error.message : "Password reset email sent.");
  }

  async function createAccount() {
    if (!supabase || !email || !password) return setMessage("Enter an email address and password first.");
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) setMessage(error.message);
    else if (data.session) onSession(data.session);
    else setMessage("Account created. Check your email to confirm it, then sign in.");
  }

  return <main className="account-shell">
    <a className="account-brand" href="/map/">← The Lake District map</a>
    <section className="login-card">
      <div className="account-kicker">Business accounts</div>
      <h1>Welcome back</h1>
      <p>Sign in to manage your listing or administer the map.</p>
      {!isSupabaseConfigured && <div className="account-alert">Add the Supabase environment variables to enable login.</div>}
      <form onSubmit={submit}>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        <button className="account-primary" disabled={busy || !isSupabaseConfigured}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <div className="login-links"><button className="account-link" onClick={createAccount}>Create an account</button><button className="account-link" onClick={resetPassword}>Forgotten your password?</button></div>
      {message && <p className="account-message" role="status">{message}</p>}
    </section>
  </main>;
}

function BusinessEditor({ business, onSaved }: { business: AdminBusiness; onSaved: (business: AdminBusiness) => void }) {
  const [draft, setDraft] = useState(business);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (field: keyof AdminBusiness, value: string | boolean | number) => setDraft((current) => ({ ...current, [field]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const { data, error } = await supabase.from("businesses").update({
      name: draft.name, slug: draft.slug, tagline: draft.tagline, description: draft.description,
      category: draft.category, latitude: draft.latitude, longitude: draft.longitude,
      address: draft.address || null, town: draft.town || null, postcode: draft.postcode || null,
      website_url: draft.website_url || null, phone: draft.phone || null,
      listing_type: draft.listing_type, listing_status: draft.listing_status, featured: draft.featured,
      updated_at: new Date().toISOString()
    }).eq("id", draft.id).select().single();
    setBusy(false);
    if (error) setMessage(error.message);
    else { setMessage("Saved."); onSaved(data as AdminBusiness); }
  }

  return <form className="admin-editor" onSubmit={save}>
    <div className="admin-editor__heading"><div><span>Edit listing</span><h2>{draft.name}</h2></div><a href={`/map/?admin=1&business=${draft.id}`} target="_blank">View on map ↗</a></div>
    <div className="admin-fields">
      <label>Company name<input value={draft.name} onChange={(e) => set("name", e.target.value)} required /></label>
      <label>Slug<input value={draft.slug} onChange={(e) => set("slug", e.target.value)} required /></label>
      <label className="field-wide">Tagline <small>{draft.tagline.length}/80</small><input maxLength={80} value={draft.tagline} onChange={(e) => set("tagline", e.target.value)} /></label>
      <label className="field-wide">Details<textarea rows={5} value={draft.description} onChange={(e) => set("description", e.target.value)} /></label>
      <label>Category<select value={draft.category} onChange={(e) => set("category", e.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Status<select value={draft.listing_status} onChange={(e) => set("listing_status", e.target.value)}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Listing type<select value={draft.listing_type} onChange={(e) => set("listing_type", e.target.value)}><option value="editorial">Editorial</option><option value="subscriber">Subscriber</option></select></label>
      <label>Town / village<input value={draft.town ?? ""} onChange={(e) => set("town", e.target.value)} /></label>
      <label className="field-wide">Address<input value={draft.address ?? ""} onChange={(e) => set("address", e.target.value)} /></label>
      <label>Postcode<input value={draft.postcode ?? ""} onChange={(e) => set("postcode", e.target.value)} /></label>
      <label>Phone<input value={draft.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></label>
      <label className="field-wide">Website<input type="url" value={draft.website_url ?? ""} onChange={(e) => set("website_url", e.target.value)} /></label>
      <label>Latitude<input type="number" step="any" value={draft.latitude} onChange={(e) => set("latitude", Number(e.target.value))} /></label>
      <label>Longitude<input type="number" step="any" value={draft.longitude} onChange={(e) => set("longitude", Number(e.target.value))} /></label>
      <label className="check-field"><input type="checkbox" checked={draft.featured} onChange={(e) => set("featured", e.target.checked)} /> Featured listing</label>
    </div>
    <div className="admin-save"><button className="account-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>{message && <span role="status">{message}</span>}</div>
  </form>;
}

function AdminDashboard({ session }: { session: Session }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [businesses, setBusinesses] = useState<AdminBusiness[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AdminBusiness | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.rpc("is_admin").then(({ data }) => setAllowed(Boolean(data)));
  }, []);
  useEffect(() => {
    if (!supabase || !allowed) return;
    void supabase.from("businesses").select("*").order("name").then(({ data }) => {
      const loaded = (data ?? []) as AdminBusiness[];
      setBusinesses(loaded);
      const requestedId = new URLSearchParams(window.location.search).get("business");
      if (requestedId) setSelected(loaded.find((item) => item.id === requestedId) ?? null);
    });
  }, [allowed]);
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return businesses.filter((item) => !term || `${item.name} ${item.town ?? ""} ${item.postcode ?? ""}`.toLowerCase().includes(term));
  }, [businesses, query]);

  async function createBusiness() {
    if (!supabase) return;
    const suffix = Date.now().toString(36);
    const { data, error } = await supabase.from("businesses").insert({
      name: "New business", slug: `new-business-${suffix}`, tagline: "", description: "",
      category: "Activities", latitude: 54.46, longitude: -3.08, town: "",
      listing_type: "editorial", listing_status: "draft"
    }).select().single();
    if (error) return window.alert(error.message);
    const created = data as AdminBusiness;
    setBusinesses((all) => [created, ...all]);
    setSelected(created);
  }

  if (allowed === null) return <main className="account-shell"><div className="login-card">Checking access…</div></main>;
  if (!allowed) return <main className="account-shell"><section className="login-card"><h1>Business account</h1><p>{session.user.email} is signed in, but does not have administrator access.</p><a className="account-primary" href="/map/">Return to map</a></section></main>;
  return <main className="admin-shell">
    <header className="admin-header"><div><span className="account-kicker">The Lake District</span><h1>Business administration</h1></div><nav><a href="/map/?admin=1">Edit from map</a><button onClick={() => void supabase?.auth.signOut().then(() => location.assign("/map/login/"))}>Sign out</button></nav></header>
    <div className="admin-layout">
      <aside className="admin-list"><button className="admin-create" onClick={createBusiness}>＋ Add business</button><input type="search" placeholder="Search business, town or postcode" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus /><p>{visible.length} businesses</p>{visible.map((item) => <button className={selected?.id === item.id ? "is-selected" : ""} key={item.id} onClick={() => setSelected(item)}><strong>{item.name}</strong><span>{item.town || "No town"} · {item.listing_status.replace("_", " ")}</span></button>)}</aside>
      <section className="admin-workspace">{selected ? <BusinessEditor business={selected} onSaved={(saved) => { setSelected(saved); setBusinesses((all) => all.map((item) => item.id === saved.id ? saved : item)); }} /> : <div className="admin-empty"><h2>Select a business</h2><p>Search the list, or use “Edit from map” to find it geographically.</p></div>}</section>
    </div>
  </main>;
}

export function AdminApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <main className="account-shell"><div className="login-card">Loading…</div></main>;
  if (!session) return <Login onSession={setSession} />;
  return <AdminDashboard session={session} />;
}
