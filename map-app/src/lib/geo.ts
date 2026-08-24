import type { Business, PinLocation } from "../types";

const EARTH_RADIUS_MILES = 3958.8;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceMiles(a: PinLocation, b: PinLocation): number {
  const latDelta = radians(b.latitude - a.latitude);
  const lonDelta = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

export function nearbyBusinesses(pin: PinLocation, businesses: Business[], limit = 3) {
  return businesses
    .map((business) => ({
      business,
      distance: distanceMiles(pin, {
        latitude: business.latitude,
        longitude: business.longitude
      })
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}
