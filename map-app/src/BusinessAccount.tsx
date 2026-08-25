import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import { supabase } from "./lib/supabase";
import { trackEvent } from "./lib/analytics";

const categories = ["Accommodation", "Camping", "Eating", "Activities", "Gifts"];
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const mapTilerKey = import.meta.env.VITE_MAPTILER_KEY as string | undefined;
const pickerStyle = mapTilerKey ? `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${mapTilerKey}` : "https://tiles.openfreemap.org/styles/liberty";

type Hours = Record<string, { closed: boolean; open: string; close: string }>;
type Subscription = { plan_code: string; amount_pence: number; currency: string; stripe_customer_id: string | null; stripe_status: string | null; current_period_end: string | null; cancel_at_period_end: boolean };
type CustomerBusiness = {
  id: string; name: string; slug: string; tagline: string; description: string; category: string;
  latitude: number; longitude: number; address: string | null; town: string | null; postcode: string | null;
  website_url: string | null; phone: string | null; facebook_url: string | null; instagram_url: string | null;
  directions_url: string | null; logo_url: string | null; image_url: string | null; opening_hours: Hours;
  hours_vary: boolean; listing_status: "draft" | "awaiting_payment" | "active" | "past_due" | "cancelled" | "suspended";
  business_subscriptions?: Subscription[];
};

function blankHours(): Hours {
  return Object.fromEntries(days.map((day) => [day, { closed: day === "Sunday", open: "09:00", close: "17:00" }]));
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
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not optimise this image.")), "image/webp", 0.84));
}

function LocationPicker({ latitude, longitude, onChange }: { latitude: number; longitude: number; onChange: (latitude: number, longitude: number) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = new maplibregl.Map({ container: container.current, style: pickerStyle, center: [longitude, latitude], zoom: 13, attributionControl: false });
    const pin = new maplibregl.Marker({ draggable: true }).setLngLat([longitude, latitude]).addTo(instance);
    pin.on("dragend", () => { const point = pin.getLngLat(); onChange(point.lat, point.lng); });
    instance.on("click", (event) => { pin.setLngLat(event.lngLat); onChange(event.lngLat.lat, event.lngLat.lng); });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.current = instance;
    marker.current = pin;
    return () => { pin.remove(); instance.remove(); map.current = null; };
  }, []);
  useEffect(() => { marker.current?.setLngLat([longitude, latitude]); }, [latitude, longitude]);
  return <div className="onboarding-map" ref={container} aria-label="Place your business marker on the map" />;
}

function statusLabel(status: CustomerBusiness["listing_status"]) {
  return ({ draft: "Draft", awaiting_payment: "Awaiting payment", active: "Listing active", past_due: "Payment needs attention", cancelled: "Subscription cancelled", suspended: "Listing suspended" })[status];
}

export function BusinessAccount({ session }: { session: Session }) {
  const returnedFromBilling = new URLSearchParams(window.location.search).get("billing") === "returned";
  const [selected, setSelected] = useState<CustomerBusiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("Accommodation");

  async function load() {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.from("businesses")
      .select("*,business_subscriptions(*)")
      .eq("owner_user_id", session.user.id)
      .order("created_at");
    setLoading(false);
    if (error) return setMessage(error.message);
    const loaded = (data ?? []) as CustomerBusiness[];
    setSelected((current) => loaded.find((item) => item.id === current?.id) ?? loaded[0] ?? null);
  }

  useEffect(() => { void load(); }, []);

  async function createListing(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setMessage("");
    const { data, error } = await supabase.rpc("create_subscriber_draft", { business_name: newName, business_category: newCategory });
    setBusy(false);
    if (error) return setMessage(error.message);
    const created = { ...(data as CustomerBusiness), opening_hours: blankHours(), business_subscriptions: [] };
    setSelected(created); setStep(1);
    trackEvent("begin_business_onboarding", { business_id: created.id, business_category: created.category });
  }

  function set(field: keyof CustomerBusiness, value: unknown) {
    setSelected((current) => current ? { ...current, [field]: value } : current);
  }

  async function saveCurrent(nextStep?: number) {
    if (!supabase || !selected) return false;
    setBusy(true); setMessage("");
    const payload = {
      name: selected.name, tagline: selected.tagline, description: selected.description, category: selected.category,
      latitude: selected.latitude, longitude: selected.longitude, address: selected.address || null, town: selected.town || null,
      postcode: selected.postcode || null, website_url: selected.website_url || null, phone: selected.phone || null,
      facebook_url: selected.facebook_url || null, instagram_url: selected.instagram_url || null,
      directions_url: selected.directions_url || null, opening_hours: selected.opening_hours ?? {}, hours_vary: selected.hours_vary,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from("businesses").update(payload).eq("id", selected.id).select("*,business_subscriptions(*)").single();
    setBusy(false);
    if (error) { setMessage(error.message); return false; }
    const saved = data as CustomerBusiness;
    setSelected(saved);
    setMessage("Saved.");
    if (nextStep) { setStep(nextStep); trackEvent("business_onboarding_step", { business_id: saved.id, step: nextStep }); }
    return true;
  }

  async function saveAndCheckout() {
    const saved = await saveCurrent();
    if (saved) await openHostedPage("create-checkout");
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>, kind: "logo" | "hero") {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !supabase || !selected) return;
    setBusy(true); setMessage("Optimising image…");
    try {
      const blob = await optimiseImage(file, kind === "logo" ? 800 : 1600);
      const path = `${selected.id}/${kind}-${crypto.randomUUID()}.webp`;
      const { error: uploadError } = await supabase.storage.from("business-images").upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" });
      if (uploadError) throw uploadError;
      const imageUrl = supabase.storage.from("business-images").getPublicUrl(path).data.publicUrl;
      const field = kind === "logo" ? "logo_url" : "image_url";
      const { error } = await supabase.from("businesses").update({ [field]: imageUrl }).eq("id", selected.id);
      if (error) throw error;
      set(field, imageUrl); setMessage("Image uploaded.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to upload image."); }
    finally { setBusy(false); }
  }

  async function openHostedPage(functionName: "create-checkout" | "create-billing-portal") {
    if (!supabase || !selected) return;
    setBusy(true); setMessage("");
    const { data: authData } = await supabase.auth.getSession();
    const accessToken = authData.session?.access_token;
    if (!accessToken) { setBusy(false); setMessage("Your session has expired. Sign in again to continue."); return; }
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: { businessId: selected.id },
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    setBusy(false);
    if (error || !data?.url) {
      let detail = data?.error as string | undefined;
      const context = error && "context" in error ? (error as { context?: Response }).context : undefined;
      if (!detail && context) {
        try { detail = ((await context.clone().json()) as { error?: string; message?: string }).error; }
        catch { /* Keep the SDK's fallback message for non-JSON responses. */ }
      }
      return setMessage(detail ?? error?.message ?? "Unable to open payment page.");
    }
    if (functionName === "create-checkout") trackEvent("begin_checkout", { business_id: selected.id, business_slug: selected.slug, value: 10, currency: "GBP" });
    window.location.assign(data.url as string);
  }

  if (loading) return <main className="account-shell"><section className="login-card"><h1>Loading your business…</h1></section></main>;
  if (!selected) return <main className="account-shell business-account-shell">
    <a className="account-brand" href="/map/">← The Lake District map</a>
    <section className="login-card onboarding-start"><div className="account-kicker">List your business</div><h1>Be on the map in five minutes</h1><p>Listings are £10 per month. Start with the essentials—you can update everything later.</p>
      <form onSubmit={createListing}><label>Business name<input value={newName} onChange={(event) => setNewName(event.target.value)} required autoFocus /></label><label>Category<select value={newCategory} onChange={(event) => setNewCategory(event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><button className="account-primary" disabled={busy}>{busy ? "Creating…" : "Start my listing"}</button></form>
      {message && <p className="account-message">{message}</p>}
      <button className="account-link" onClick={() => void supabase?.auth.signOut().then(() => location.reload())}>Sign out</button>
    </section>
  </main>;

  const subscription = selected.business_subscriptions?.[0];
  const isActive = selected.listing_status === "active";
  return <main className="customer-shell">
    <header className="customer-header"><a href="/map/">The Lake District · 3D Explorer</a><div><span>{session.user.email}</span><button onClick={() => void supabase?.auth.signOut().then(() => location.assign("/map/login/"))}>Sign out</button></div></header>
    <div className="customer-layout">
      <aside className="customer-progress"><div className="account-kicker">Your listing</div><h1>{selected.name}</h1><span className={`listing-status listing-status--${selected.listing_status}`}>{statusLabel(selected.listing_status)}</span>{!isActive && <ol>{["Your business", "Location", "Details & preview"].map((label, index) => <li className={step === index + 1 ? "is-current" : step > index + 1 ? "is-done" : ""} key={label}><button onClick={() => setStep(index + 1)}><i>{index + 1}</i>{label}</button></li>)}</ol>}
        {isActive && <nav><button onClick={() => setStep(1)}>Edit business</button><a href={`/map/?business=${selected.id}`} target="_blank">View on map ↗</a><button onClick={() => void openHostedPage("create-billing-portal")}>Manage billing</button></nav>}
      </aside>
      <section className="customer-workspace">
        {returnedFromBilling && isActive && <section className="billing-return" aria-labelledby="billing-return-title">
          <div><div className="account-kicker">Back from Stripe</div><h2 id="billing-return-title">Your billing settings are saved</h2><p>You can now continue editing your business or check how the live listing looks on the map.</p></div>
          <div><button onClick={() => setStep(1)}>Continue editing</button><a href={`/map/?business=${selected.id}`}>View live listing ↗</a></div>
        </section>}
        {step === 1 && <div className="onboarding-step"><div className="account-kicker">Step 1 of 3</div><h2>Your business</h2><p>Just enough information to help visitors decide whether to tap your marker.</p><div className="customer-fields"><label>Business name<input value={selected.name} onChange={(event) => set("name", event.target.value)} /></label><label>Category<select value={selected.category} onChange={(event) => set("category", event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label className="field-wide">Tagline <small>{selected.tagline.length}/80</small><input maxLength={80} value={selected.tagline} onChange={(event) => set("tagline", event.target.value)} placeholder="What makes your business worth a visit?" /></label><label className="field-wide">Short description<textarea rows={5} maxLength={600} value={selected.description} onChange={(event) => set("description", event.target.value)} /></label><label>Website<input type="url" value={selected.website_url ?? ""} onChange={(event) => set("website_url", event.target.value)} /></label><label>Phone (optional)<input type="tel" value={selected.phone ?? ""} onChange={(event) => set("phone", event.target.value)} /></label></div><div className="onboarding-actions"><button className="account-primary" onClick={() => void saveCurrent(2)} disabled={busy}>Save and continue</button></div></div>}
        {step === 2 && <div className="onboarding-step"><div className="account-kicker">Step 2 of 3</div><h2>Where are you?</h2><p>Enter the address, then tap or drag the marker to the exact entrance visitors should use.</p><div className="customer-fields"><label className="field-wide">Address<input value={selected.address ?? ""} onChange={(event) => set("address", event.target.value)} /></label><label>Town or village<input value={selected.town ?? ""} onChange={(event) => set("town", event.target.value)} /></label><label>Postcode<input value={selected.postcode ?? ""} onChange={(event) => set("postcode", event.target.value)} /></label><div className="field-wide"><LocationPicker latitude={selected.latitude} longitude={selected.longitude} onChange={(latitude, longitude) => setSelected((current) => current ? { ...current, latitude, longitude } : current)} /><p className="map-confirmation">Marker position: {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}</p></div></div><div className="onboarding-actions"><button className="secondary" onClick={() => setStep(1)}>Back</button><button className="account-primary" onClick={() => void saveCurrent(3)} disabled={busy}>Yes, this is where we are</button></div></div>}
        {step === 3 && <div className="onboarding-step"><div className="account-kicker">Step 3 of 3</div><h2>Details, preview and payment</h2><div className="customer-fields"><label>Facebook (optional)<input type="url" value={selected.facebook_url ?? ""} onChange={(event) => set("facebook_url", event.target.value)} /></label><label>Instagram (optional)<input type="url" value={selected.instagram_url ?? ""} onChange={(event) => set("instagram_url", event.target.value)} /></label><label className="check-field field-wide"><input type="checkbox" checked={selected.hours_vary} onChange={(event) => set("hours_vary", event.target.checked)} /> Hours vary—ask visitors to check our website</label>{!selected.hours_vary && <fieldset className="opening-hours field-wide"><legend>Opening hours</legend>{days.map((day) => { const hours = selected.opening_hours?.[day] ?? blankHours()[day]; return <div key={day}><strong>{day}</strong><label><input type="checkbox" checked={hours.closed} onChange={(event) => set("opening_hours", { ...selected.opening_hours, [day]: { ...hours, closed: event.target.checked } })} /> Closed</label><input type="time" disabled={hours.closed} value={hours.open} onChange={(event) => set("opening_hours", { ...selected.opening_hours, [day]: { ...hours, open: event.target.value } })} /><span>to</span><input type="time" disabled={hours.closed} value={hours.close} onChange={(event) => set("opening_hours", { ...selected.opening_hours, [day]: { ...hours, close: event.target.value } })} /></div>; })}</fieldset>}<fieldset className="subscriber-images field-wide" disabled={busy}><legend>Images</legend><label>{selected.logo_url ? <img src={selected.logo_url} alt="Current logo" /> : <span>Logo</span>}<b>{selected.logo_url ? "Replace logo" : "Add logo"}</b><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadImage(event, "logo")} /></label><label>{selected.image_url ? <img src={selected.image_url} alt="Current main" /> : <span>Main image</span>}<b>{selected.image_url ? "Replace image" : "Add main image"}</b><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadImage(event, "hero")} /></label></fieldset></div>
          <article className="listing-preview"><div className="account-kicker">Preview</div>{selected.logo_url && <img className="listing-preview__logo" src={selected.logo_url} alt="" />}<h3>{selected.name}</h3><strong>{selected.tagline || "Your tagline will appear here"}</strong>{selected.image_url && <img className="listing-preview__hero" src={selected.image_url} alt="" />}<p>{selected.description || "Your short description will appear here."}</p><small>{selected.town} · {selected.category}</small></article>
          <div className="onboarding-actions"><button className="secondary" onClick={() => setStep(2)}>Back</button><button className="secondary" onClick={() => void saveCurrent()} disabled={busy}>Save preview</button>{!isActive && <button className="account-primary" onClick={() => void saveAndCheckout()} disabled={busy}>Subscribe · £10/month</button>}{isActive && <a className="account-primary" href={`/map/?business=${selected.id}`}>View live listing</a>}</div></div>}
        {message && <p className="account-message customer-message" role="status">{message}</p>}
        {subscription?.current_period_end && <p className="billing-note">Current billing period ends {new Date(subscription.current_period_end).toLocaleDateString("en-GB")}.</p>}
      </section>
    </div>
  </main>;
}
