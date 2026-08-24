import { useEffect, useMemo, useState, type ChangeEvent, type ClipboardEvent, type FormEvent } from "react";
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
  logo_url: string | null;
  image_url: string | null;
  business_images?: BusinessImage[];
  listing_type: "editorial" | "subscriber";
  listing_status: "draft" | "awaiting_payment" | "active" | "past_due" | "cancelled" | "suspended";
  featured: boolean;
};

type BusinessImage = { id: string; image_url: string; storage_path: string; sort_order: number };

const categories = ["Accommodation", "Camping", "Eating", "Activities", "Gifts"];
const statuses: AdminBusiness["listing_status"][] = ["draft", "awaiting_payment", "active", "past_due", "cancelled", "suspended"];

function parseCoordinatePart(value: string) {
  const cleaned = value.trim().replace(/[−–—]/g, "-").replace(/[°º]/g, "");
  const match = cleaned.match(/^([+-]?\d{1,3})(?:[.,\s]+(\d+))?$/);
  if (!match) return null;
  const result = Number(match[2] ? `${match[1]}.${match[2]}` : match[1]);
  return Number.isFinite(result) ? result : null;
}

function parseCoordinatePaste(value: string) {
  const cleaned = value.trim().replace(/[−–—]/g, "-");
  const signedSecond = cleaned.match(/^(.+?)[,;\s]+(?=[+-]\s*\d)(.+)$/);
  if (signedSecond) {
    const latitude = parseCoordinatePart(signedSecond[1]);
    const longitude = parseCoordinatePart(signedSecond[2]);
    if (latitude !== null && longitude !== null) return [latitude, longitude] as const;
  }
  const standardPair = cleaned.match(/^\s*([+-]?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*([+-]?\d{1,3}(?:\.\d+)?)\s*$/);
  if (standardPair) return [Number(standardPair[1]), Number(standardPair[2])] as const;
  return null;
}

async function optimiseImage(file: File, maxDimension: number) {
  if (!file.type.startsWith("image/")) throw new Error("Choose a JPG, PNG or WebP image.");
  if (file.size > 10 * 1024 * 1024) throw new Error("The original image must be smaller than 10 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not optimise this image.")), "image/webp", 0.84));
  if (blob.size > 5 * 1024 * 1024) throw new Error("The optimised image is still larger than 5 MB.");
  return blob;
}

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
  const [imageBusy, setImageBusy] = useState(false);
  const set = (field: keyof AdminBusiness, value: string | boolean | number) => setDraft((current) => ({ ...current, [field]: value }));

  function updateCoordinate(field: "latitude" | "longitude", value: string) {
    const coordinate = parseCoordinatePart(value);
    if (coordinate !== null) set(field, coordinate);
  }

  function pasteCoordinates(event: ClipboardEvent<HTMLInputElement>, field: "latitude" | "longitude") {
    const pasted = event.clipboardData.getData("text");
    const pair = parseCoordinatePaste(pasted);
    if (pair) {
      event.preventDefault();
      setDraft((current) => ({ ...current, latitude: pair[0], longitude: pair[1] }));
      setMessage("Latitude and longitude pasted.");
      return;
    }
    const coordinate = parseCoordinatePart(pasted);
    if (coordinate !== null) {
      event.preventDefault();
      set(field, coordinate);
    }
  }

  useEffect(() => {
    setDraft(business);
    setMessage("");
  }, [business]);

  async function uploadImage(event: ChangeEvent<HTMLInputElement>, kind: "logo" | "hero" | "gallery") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !supabase) return;
    if (kind === "gallery" && (draft.business_images?.length ?? 0) >= 5) return setMessage("A listing can have up to five gallery images.");
    setImageBusy(true);
    setMessage("Optimising image…");
    try {
      const blob = await optimiseImage(file, kind === "logo" ? 800 : 1600);
      const path = `${draft.id}/${kind}-${crypto.randomUUID()}.webp`;
      const { error: uploadError } = await supabase.storage.from("business-images").upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" });
      if (uploadError) throw uploadError;
      const imageUrl = supabase.storage.from("business-images").getPublicUrl(path).data.publicUrl;
      if (kind === "gallery") {
        const { data, error } = await supabase.from("business_images").insert({ business_id: draft.id, image_url: imageUrl, storage_path: path, sort_order: draft.business_images?.length ?? 0 }).select().single();
        if (error) throw error;
        const updated = { ...draft, business_images: [...(draft.business_images ?? []), data as BusinessImage] };
        setDraft(updated);
        onSaved(updated);
      } else {
        const field = kind === "logo" ? "logo_url" : "image_url";
        const { error } = await supabase.from("businesses").update({ [field]: imageUrl, updated_at: new Date().toISOString() }).eq("id", draft.id);
        if (error) throw error;
        const updated = { ...draft, [field]: imageUrl };
        setDraft(updated);
        onSaved(updated);
      }
      setMessage("Image uploaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to upload this image.");
    } finally {
      setImageBusy(false);
    }
  }

  async function removeGalleryImage(image: BusinessImage) {
    if (!supabase) return;
    setImageBusy(true);
    const { error } = await supabase.from("business_images").delete().eq("id", image.id);
    if (!error) await supabase.storage.from("business-images").remove([image.storage_path]);
    setImageBusy(false);
    if (error) setMessage(error.message);
    else {
      const updated = { ...draft, business_images: (draft.business_images ?? []).filter((item) => item.id !== image.id) };
      setDraft(updated);
      onSaved(updated);
      setMessage("Image removed.");
    }
  }

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
    else {
      const saved = { ...draft, ...(data as AdminBusiness), business_images: draft.business_images };
      setDraft(saved);
      setMessage("Saved.");
      onSaved(saved);
    }
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
      <label>Latitude<input type="text" inputMode="decimal" value={draft.latitude} onChange={(e) => updateCoordinate("latitude", e.target.value)} onPaste={(e) => pasteCoordinates(e, "latitude")} title="Paste one coordinate or a latitude, longitude pair" /></label>
      <label>Longitude<input type="text" inputMode="decimal" value={draft.longitude} onChange={(e) => updateCoordinate("longitude", e.target.value)} onPaste={(e) => pasteCoordinates(e, "longitude")} title="Paste one coordinate or a latitude, longitude pair" /></label>
      <label className="check-field"><input type="checkbox" checked={draft.featured} onChange={(e) => set("featured", e.target.checked)} /> Featured listing</label>
      <fieldset className="admin-images field-wide" disabled={imageBusy}>
        <legend>Business images</legend>
        <p>Images are resized and compressed before upload. Add one logo, one main image and up to five gallery images.</p>
        <div className="admin-image-slots">
          <label className="admin-image-upload">{draft.logo_url ? <img src={draft.logo_url} alt="Current logo" /> : <span>Logo</span>}<b>{draft.logo_url ? "Replace logo" : "Add logo"}</b><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadImage(event, "logo")} /></label>
          <label className="admin-image-upload admin-image-upload--hero">{draft.image_url ? <img src={draft.image_url} alt="Current main" /> : <span>Main image</span>}<b>{draft.image_url ? "Replace main image" : "Add main image"}</b><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadImage(event, "hero")} /></label>
          {(draft.business_images ?? []).map((image, index) => <div className="admin-image-preview" key={image.id}><img src={image.image_url} alt={`Gallery ${index + 1}`} /><button type="button" onClick={() => void removeGalleryImage(image)} aria-label={`Remove gallery image ${index + 1}`}>×</button></div>)}
          {(draft.business_images?.length ?? 0) < 5 && <label className="admin-image-upload"><span>＋</span><b>Add gallery image</b><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadImage(event, "gallery")} /></label>}
        </div>
      </fieldset>
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
    void supabase.from("businesses").select("*,business_images(*)").order("name").then(({ data }) => {
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
