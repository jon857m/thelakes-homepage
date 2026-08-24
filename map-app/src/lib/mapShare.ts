import type { CameraState, MapLayerState, PinLocation, SharedMapView } from "../types";

export function encodeMapView(camera: CameraState, layers: MapLayerState, pin?: PinLocation) {
  const payload: SharedMapView = { version: 1, camera, layers, pin };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function decodeMapView(value: string | null): SharedMapView | null {
  if (!value) return null;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as SharedMapView;
    if (payload.version !== 1 || !payload.camera || !payload.layers) return null;
    return payload;
  } catch {
    return null;
  }
}
