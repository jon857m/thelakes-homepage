import { useEffect, useMemo, useState, type ChangeEvent, type ClipboardEvent, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { BusinessAccount } from "./BusinessAccount";

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
  owner_user_id: string | null;
  owner_email?: string | null;
};

type BusinessImage = { id: string; image_url: string; storage_path: string; sort_order: number };

type PurgePreview = {
  user: { id: string; email: string };
  businesses: { id: string; name: string }[];
  databaseImageRows: number;
  storageObjects: number;
  stripeCustomerIds: string[];
  stripeSubscriptionIds: string[];
};

async function edgeFunctionErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const body = await context.clone().json() as { error?: string };
        if (body.error) return body.error;
      } catch {
        // Fall through to the SDK message when the response is not JSON.
      }
    }
  }
  return error instanceof Error ? error.message : fallback;
}

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
  const signedSecond = cleaned.match(/^(.+?)[,;\s]+(?=[+-]\s*\d)([+-]\s*\d.*)$/);
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
  const [mode, setMode] = useState<"signup" | "signin">(() => window.location.pathname.startsWith("/map/business") ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
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
      redirectTo: `${window.location.origin}/map/login/?recovery=1`
    });
    setMessage(error ? error.message : "Password reset email sent.");
  }

  async function createAccount() {
    if (!supabase || !email || !password) return setMessage("Enter an email address and password first.");
    if (password.length < 10) return setMessage("Use at least ten characters for your password.");
    if (password !== confirmation) return setMessage("The passwords do not match.");
    if (!acceptedTerms) return setMessage("Please agree to the terms and privacy notice.");
    setBusy(true);
    const customerSignup = window.location.pathname.startsWith("/map/business");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}${customerSignup ? "/map/business/" : "/map/login/"}` }
    });
    setBusy(false);
    if (error) setMessage(error.message);
    else if (data.session) onSession(data.session);
    else setMessage("Account created. Check your email to confirm it, then sign in.");
  }

  return <main className="account-shell">
    <a className="account-brand account-brand--full" href="/map/">
      <img src="/map/brand/hero.jpg" alt="" />
      <span><strong>The Lake District</strong><small>3D Explorer · Business listings</small></span>
    </a>
    <section className={`login-card login-card--${mode}`}>
      <div className="account-kicker">Lake District business listings</div>
      <h1>{mode === "signup" ? "Put your business on the map" : "Welcome back"}</h1>
      <p>{mode === "signup" ? "Create your account, add your listing and choose its exact map location. Payment comes at the final step." : "Sign in to manage your listing, subscription or map administration."}</p>
      {!isSupabaseConfigured && <div className="account-alert">Add the Supabase environment variables to enable login.</div>}
      <form onSubmit={mode === "signup" ? (event) => { event.preventDefault(); void createAccount(); } : submit}>
        <label>Work email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@yourbusiness.co.uk" required /></label>
        <label>Password<input type="password" minLength={mode === "signup" ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} required /></label>
        {mode === "signup" && <>
          <label>Confirm password<input type="password" minLength={10} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="new-password" required /></label>
          <small className="password-help">Use at least 10 characters.</small>
          <label className="terms-check"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} required /><span>I agree to the <strong>business listing terms</strong> and acknowledge the <strong>privacy notice</strong>.</span></label>
        </>}
        <button className="account-primary" disabled={busy || !isSupabaseConfigured}>{busy ? (mode === "signup" ? "Creating account…" : "Signing in…") : (mode === "signup" ? "Create my business account" : "Sign in")}</button>
      </form>
      <div className="login-switch">
        <span>{mode === "signup" ? "Already have an account?" : "New to our business map?"}</span>
        <button className="account-link" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setMessage(""); }}>{mode === "signup" ? "Sign in" : "Create an account"}</button>
      </div>
      {mode === "signin" && <button className="account-link forgot-link" onClick={resetPassword}>Forgotten your password?</button>}
      {message && <p className="account-message" role="status">{message}</p>}
    </section>
  </main>;
}

function PasswordRecovery({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (password.length < 8) return setMessage("Use at least eight characters.");
    if (password !== confirmation) return setMessage("The passwords do not match.");
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setMessage(error.message);
    window.history.replaceState({}, "", "/map/login/");
    onComplete();
  }

  return <main className="account-shell">
    <a className="account-brand" href="/map/">← The Lake District map</a>
    <section className="login-card">
      <div className="account-kicker">Business accounts</div>
      <h1>Choose a new password</h1>
      <p>Enter a new password for your Lake District business account.</p>
      <form onSubmit={updatePassword}>
        <label>New password<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required autoFocus /></label>
        <label>Confirm new password<input type="password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required /></label>
        <button className="account-primary" disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
      </form>
      {message && <p className="account-message" role="status">{message}</p>}
    </section>
  </main>;
}

function TestAccountReset({ business, onPurged }: { business: AdminBusiness; onPurged: (ownerUserId: string) => void }) {
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [purgeStripe, setPurgeStripe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setPreview(null);
    setConfirmation("");
    setMessage("");
  }, [business.owner_user_id]);

  async function invokePurge(action: "preview" | "purge") {
    if (!supabase || !business.owner_user_id) return;
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.functions.invoke("purge-test-account", {
      body: { action, targetUserId: business.owner_user_id, confirmation, purgeStripe }
    });
    setBusy(false);
    const responseError = (data as { error?: string } | null)?.error;
    if (error || responseError) {
      setMessage(responseError || await edgeFunctionErrorMessage(error, "Unable to contact the purge service."));
      return;
    }
    if (action === "preview") {
      setPreview(data as PurgePreview);
      return;
    }
    const result = data as { email: string; businesses: number; storageObjects: number; stripeCustomers: number };
    window.alert(`Purged ${result.email}: ${result.businesses} business record(s), ${result.storageObjects} stored file(s) and ${result.stripeCustomers} Stripe test customer(s).`);
    onPurged(business.owner_user_id);
  }

  if (!business.owner_user_id) return null;
  return <section className="admin-account-reset field-wide" aria-label="Test account reset">
    <div className="admin-account-reset__heading">
      <div><strong>Developer test-account reset</strong><p>Remove this account’s Auth user, owned listings, subscriptions and uploaded files so the signup journey can be run again.</p></div>
      {!preview && <button type="button" className="danger" disabled={busy} onClick={() => void invokePurge("preview")}>{busy ? "Checking…" : "Prepare account purge"}</button>}
    </div>
    {preview && <div className="admin-account-reset__confirm">
      <div className="admin-account-reset__summary">
        <span><b>{preview.businesses.length}</b> businesses</span>
        <span><b>{preview.databaseImageRows}</b> image records</span>
        <span><b>{preview.storageObjects}</b> stored files</span>
        <span><b>{preview.stripeCustomerIds.length}</b> Stripe customers</span>
      </div>
      <p><strong>This cannot be undone.</strong> Type <code>{preview.user.email}</code> to confirm.</p>
      <input type="email" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={preview.user.email} autoComplete="off" />
      {preview.stripeCustomerIds.length > 0 && <label className="admin-account-reset__stripe"><input type="checkbox" checked={purgeStripe} onChange={(event) => setPurgeStripe(event.target.checked)} /><span>Also delete the linked Stripe test customer and subscriptions</span></label>}
      <div className="admin-account-reset__actions">
        <button type="button" onClick={() => { setPreview(null); setConfirmation(""); setMessage(""); }} disabled={busy}>Cancel</button>
        <button type="button" className="danger" disabled={busy || confirmation.trim().toLowerCase() !== preview.user.email.toLowerCase()} onClick={() => void invokePurge("purge")}>{busy ? "Purging account…" : "Permanently purge test account"}</button>
      </div>
    </div>}
    {message && <p className="account-message" role="status">{message}</p>}
  </section>;
}

function BusinessEditor({ business, onSaved, onDeleted, onAccountPurged }: { business: AdminBusiness; onSaved: (business: AdminBusiness) => void; onDeleted: (id: string) => void; onAccountPurged: (ownerUserId: string) => void }) {
  const [draft, setDraft] = useState(business);
  const [latitudeInput, setLatitudeInput] = useState(String(business.latitude));
  const [longitudeInput, setLongitudeInput] = useState(String(business.longitude));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const set = (field: keyof AdminBusiness, value: string | boolean | number) => setDraft((current) => ({ ...current, [field]: value }));

  function commitCoordinate(field: "latitude" | "longitude", value: string) {
    const coordinate = parseCoordinatePart(value);
    if (coordinate === null) {
      setMessage(`Enter a valid ${field}, for example ${field === "latitude" ? "54.60351370678621" : "-3.1616886612027884"}.`);
      return false;
    }
    set(field, coordinate);
    if (field === "latitude") setLatitudeInput(String(coordinate));
    else setLongitudeInput(String(coordinate));
    return true;
  }

  function pasteCoordinates(event: ClipboardEvent<HTMLInputElement>, field: "latitude" | "longitude") {
    const pasted = event.clipboardData.getData("text");
    const coordinate = parseCoordinatePart(pasted);
    if (coordinate !== null) {
      event.preventDefault();
      set(field, coordinate);
      if (field === "latitude") setLatitudeInput(String(coordinate));
      else setLongitudeInput(String(coordinate));
      return;
    }
    const pair = parseCoordinatePaste(pasted);
    if (pair) {
      event.preventDefault();
      setDraft((current) => ({ ...current, latitude: pair[0], longitude: pair[1] }));
      setLatitudeInput(String(pair[0]));
      setLongitudeInput(String(pair[1]));
      setMessage("Latitude and longitude pasted.");
      return;
    }
  }

  useEffect(() => {
    setDraft(business);
    setLatitudeInput(String(business.latitude));
    setLongitudeInput(String(business.longitude));
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

  async function removePrimaryImage(kind: "logo" | "hero") {
    if (!supabase) return;
    const field = kind === "logo" ? "logo_url" : "image_url";
    const imageUrl = draft[field];
    if (!imageUrl) return;
    setImageBusy(true);
    const { error } = await supabase.from("businesses").update({ [field]: null, updated_at: new Date().toISOString() }).eq("id", draft.id);
    if (!error) {
      const marker = "/storage/v1/object/public/business-images/";
      const markerIndex = imageUrl.indexOf(marker);
      if (markerIndex >= 0) {
        const storagePath = decodeURIComponent(imageUrl.slice(markerIndex + marker.length));
        await supabase.storage.from("business-images").remove([storagePath]);
      }
      const updated = { ...draft, [field]: null };
      setDraft(updated);
      onSaved(updated);
      setMessage(`${kind === "logo" ? "Logo" : "Main image"} removed.`);
    } else setMessage(error.message);
    setImageBusy(false);
  }

  async function archiveEditorialListing() {
    if (!supabase || draft.listing_type !== "editorial") return;
    if (!window.confirm(`Archive ${draft.name}? It will disappear from the public map but remain available here.`)) return;
    setBusy(true);
    const { error } = await supabase.from("businesses").update({ listing_status: "suspended", updated_at: new Date().toISOString() }).eq("id", draft.id);
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      const updated = { ...draft, listing_status: "suspended" as const };
      setDraft(updated);
      onSaved(updated);
      setMessage("Listing archived and removed from the public map.");
    }
  }

  async function deleteDraftListing() {
    if (!supabase || draft.listing_status !== "draft") return;
    if (!window.confirm(`Permanently delete ${draft.name}? This will also remove its uploaded images and cannot be undone.`)) return;
    setBusy(true);
    const storagePaths = (draft.business_images ?? []).map((image) => image.storage_path);
    const marker = "/storage/v1/object/public/business-images/";
    for (const imageUrl of [draft.logo_url, draft.image_url]) {
      const markerIndex = imageUrl?.indexOf(marker) ?? -1;
      if (imageUrl && markerIndex >= 0) storagePaths.push(decodeURIComponent(imageUrl.slice(markerIndex + marker.length)));
    }
    const { error } = await supabase.from("businesses").delete().eq("id", draft.id);
    if (!error && storagePaths.length) await supabase.storage.from("business-images").remove(storagePaths);
    setBusy(false);
    if (error) setMessage(error.message);
    else onDeleted(draft.id);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const latitude = parseCoordinatePart(latitudeInput);
    const longitude = parseCoordinatePart(longitudeInput);
    if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      setMessage("Check the coordinates. Latitude must be −90 to 90 and longitude −180 to 180.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.from("businesses").update({
      name: draft.name, slug: draft.slug, tagline: draft.tagline, description: draft.description,
      category: draft.category, latitude, longitude,
      address: draft.address || null, town: draft.town || null, postcode: draft.postcode || null,
      website_url: draft.website_url || null, phone: draft.phone || null,
      listing_type: draft.listing_type, listing_status: draft.listing_status, featured: draft.featured,
      updated_at: new Date().toISOString()
    }).eq("id", draft.id).select().single();
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      const saved = { ...draft, ...(data as AdminBusiness), latitude, longitude, business_images: draft.business_images };
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
      <label className="field-wide">Customer account email<input className="admin-readonly" type="email" value={draft.owner_email ?? "No customer account — editorial listing"} readOnly /></label>
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
      <label>Latitude<input type="text" inputMode="decimal" value={latitudeInput} onChange={(e) => setLatitudeInput(e.target.value)} onBlur={(e) => commitCoordinate("latitude", e.target.value)} onPaste={(e) => pasteCoordinates(e, "latitude")} placeholder="54.60351370678621" title="Paste one coordinate or a latitude, longitude pair" /></label>
      <label>Longitude<input type="text" inputMode="decimal" value={longitudeInput} onChange={(e) => setLongitudeInput(e.target.value)} onBlur={(e) => commitCoordinate("longitude", e.target.value)} onPaste={(e) => pasteCoordinates(e, "longitude")} placeholder="-3.1616886612027884" title="Paste one coordinate or a latitude, longitude pair" /></label>
      <label className="check-field"><input type="checkbox" checked={draft.featured} onChange={(e) => set("featured", e.target.checked)} /> Featured listing</label>
      <fieldset className="admin-images field-wide" disabled={imageBusy}>
        <legend>Business images</legend>
        <p>Images are resized and compressed before upload. Add one logo, one main image and up to five gallery images.</p>
        <div className="admin-image-slots">
          <div className="admin-image-primary"><label className="admin-image-upload">{draft.logo_url ? <img src={draft.logo_url} alt="Current logo" /> : <span>Logo</span>}<b>{draft.logo_url ? "Replace logo" : "Add logo"}</b><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadImage(event, "logo")} /></label>{draft.logo_url && <button type="button" className="admin-image-remove" onClick={() => void removePrimaryImage("logo")} aria-label="Remove logo">×</button>}</div>
          <div className="admin-image-primary admin-image-upload--hero"><label className="admin-image-upload">{draft.image_url ? <img src={draft.image_url} alt="Current main" /> : <span>Main image</span>}<b>{draft.image_url ? "Replace main image" : "Add main image"}</b><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadImage(event, "hero")} /></label>{draft.image_url && <button type="button" className="admin-image-remove" onClick={() => void removePrimaryImage("hero")} aria-label="Remove main image">×</button>}</div>
          {(draft.business_images ?? []).map((image, index) => <div className="admin-image-preview" key={image.id}><img src={image.image_url} alt={`Gallery ${index + 1}`} /><button type="button" onClick={() => void removeGalleryImage(image)} aria-label={`Remove gallery image ${index + 1}`}>×</button></div>)}
          {(draft.business_images?.length ?? 0) < 5 && <label className="admin-image-upload"><span>＋</span><b>Add gallery image</b><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadImage(event, "gallery")} /></label>}
        </div>
      </fieldset>
      <section className="admin-lifecycle field-wide" aria-label="Listing lifecycle">
        <div><strong>Listing lifecycle</strong>{draft.listing_type === "subscriber" ? <p>Paid subscriber cancellation will be connected to the payment provider. It cannot be deleted here.</p> : draft.listing_status === "draft" ? <p>This unpaid draft can be permanently deleted.</p> : <p>Archiving removes this editorial listing from the public map without deleting its record.</p>}</div>
        {draft.listing_type === "subscriber" ? <button type="button" disabled>Cancel through payments</button> : draft.listing_status === "draft" ? <button type="button" className="danger" disabled={busy} onClick={() => void deleteDraftListing()}>Delete draft</button> : draft.listing_status !== "suspended" ? <button type="button" disabled={busy} onClick={() => void archiveEditorialListing()}>Archive listing</button> : <span>Archived</span>}
      </section>
      {draft.listing_type === "subscriber" && <TestAccountReset business={draft} onPurged={onAccountPurged} />}
    </div>
    <div className="admin-save"><button className="account-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>{message && <span role="status">{message}</span>}</div>
  </form>;
}

function AdminDashboard({ session }: { session: Session }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [accessError, setAccessError] = useState("");
  const [businesses, setBusinesses] = useState<AdminBusiness[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AdminBusiness | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.rpc("is_admin").then(({ data, error }) => {
      if (error) {
        setAccessError("We could not check your account permissions. Please refresh and try again.");
        setAllowed(false);
        return;
      }
      setAllowed(Boolean(data));
    });
  }, []);
  useEffect(() => {
    if (allowed === null) return;
    const canonicalPath = allowed ? "/map/admin/" : "/map/business/";
    if (!window.location.pathname.startsWith(canonicalPath)) {
      window.history.replaceState({}, "", canonicalPath);
    }
  }, [allowed]);
  useEffect(() => {
    if (!supabase || !allowed) return;
    void Promise.all([
      supabase.from("businesses").select("*,business_images(*)").order("name"),
      supabase.rpc("admin_business_owner_emails")
    ]).then(([businessResult, ownerResult]) => {
      const ownerEmails = new Map<string, string | null>(
        ((ownerResult.data ?? []) as { business_id: string; owner_email: string | null }[])
          .map((item) => [item.business_id, item.owner_email])
      );
      const loaded = ((businessResult.data ?? []) as AdminBusiness[])
        .map((business) => ({ ...business, owner_email: ownerEmails.get(business.id) ?? null }));
      setBusinesses(loaded);
      const requestedId = new URLSearchParams(window.location.search).get("business");
      if (requestedId) setSelected(loaded.find((item) => item.id === requestedId) ?? null);
    });
  }, [allowed]);
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return businesses.filter((item) => !term || `${item.name} ${item.town ?? ""} ${item.postcode ?? ""} ${item.owner_email ?? ""}`.toLowerCase().includes(term));
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
  if (!allowed) return <BusinessAccount session={session} initialMessage={accessError} />;
  return <main className="admin-shell">
    <header className="admin-header">
      <a className="dashboard-brand dashboard-brand--admin" href="/map/">
        <img src="/map/brand/hero.jpg" alt="" />
        <span><strong>The Lake District</strong><small>Business administration</small></span>
      </a>
      <nav><a href="/map/?admin=1">Edit from map</a><button onClick={() => void supabase?.auth.signOut().then(() => location.assign("/map/login/"))}>Sign out</button></nav>
    </header>
    <div className="admin-layout">
      <aside className="admin-list"><button className="admin-create" onClick={createBusiness}>＋ Add business</button><input type="search" placeholder="Search business, email, town or postcode" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus /><p>{visible.length} businesses</p>{visible.map((item) => <button className={selected?.id === item.id ? "is-selected" : ""} key={item.id} onClick={() => setSelected(item)}><strong>{item.name}</strong><span>{item.town || "No town"} · {item.listing_status.replace("_", " ")}</span>{item.owner_email && <small>{item.owner_email}</small>}</button>)}</aside>
      <section className="admin-workspace">{selected ? <BusinessEditor business={selected} onSaved={(saved) => { setSelected(saved); setBusinesses((all) => all.map((item) => item.id === saved.id ? saved : item)); }} onDeleted={(id) => { setBusinesses((all) => all.filter((item) => item.id !== id)); setSelected(null); }} onAccountPurged={(ownerUserId) => { setBusinesses((all) => all.filter((item) => item.owner_user_id !== ownerUserId)); setSelected(null); }} /> : <div className="admin-empty"><h2>Select a business</h2><p>Search the list, or use “Edit from map” to find it geographically.</p></div>}</section>
    </div>
  </main>;
}

export function AdminApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovering, setRecovering] = useState(() => new URLSearchParams(window.location.search).get("recovery") === "1");
  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <main className="account-shell"><div className="login-card">Loading…</div></main>;
  if (!session) return <Login onSession={setSession} />;
  if (recovering) return <PasswordRecovery onComplete={() => setRecovering(false)} />;
  // Always resolve the user's role before choosing an account experience.
  // Previously /map/business/ bypassed this check, so administrators could be
  // shown the subscriber onboarding screen despite having admin access.
  return <AdminDashboard session={session} />;
}
