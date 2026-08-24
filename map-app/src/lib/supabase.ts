import { createClient } from "@supabase/supabase-js";
import type { CameraState, SharedLocation, SharedMapView } from "../types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && publishableKey);
export const supabase = isSupabaseConfigured ? createClient(url!, publishableKey!) : null;

function createShortCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const values = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

export async function createSharedLocation(camera: CameraState): Promise<SharedLocation> {
  if (!supabase) throw new Error("Sharing is not configured yet.");

  const shortCode = createShortCode();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from("shared_locations").insert({
    short_code: shortCode,
    latitude: camera.latitude,
    longitude: camera.longitude,
    zoom: camera.zoom,
    pitch: camera.pitch,
    bearing: camera.bearing,
    expires_at: expiresAt
  });
  if (error) throw error;
  return { ...camera, shortCode, expiresAt };
}

export async function createSharedMapView(view: SharedMapView): Promise<SharedLocation> {
  if (!supabase) throw new Error("Sharing is not configured yet.");
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shortCode = createShortCode();
    const { error } = await supabase.from("shared_locations").insert({
      short_code: shortCode,
      latitude: view.camera.latitude,
      longitude: view.camera.longitude,
      zoom: view.camera.zoom,
      pitch: view.camera.pitch,
      bearing: view.camera.bearing,
      expires_at: expiresAt,
      view_state: view
    });
    if (!error) return { ...view.camera, shortCode, expiresAt, view };
    if (error.code !== "23505") throw error;
  }
  throw new Error("Could not create a unique share link. Please try again.");
}

export async function getSharedLocation(shortCode: string): Promise<SharedLocation | null> {
  if (!supabase) throw new Error("Shared locations are not configured yet.");
  const { data, error } = await supabase.rpc("get_shared_location", { requested_code: shortCode });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    shortCode: row.short_code,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    zoom: Number(row.zoom),
    pitch: Number(row.pitch),
    bearing: Number(row.bearing),
    expiresAt: row.expires_at,
    view: row.view_state ?? undefined
  };
}
