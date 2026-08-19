"use client";

/**
 * Tiny client island for a server-rendered store page: combines the
 * store's own real coordinates (passed down from the server-fetched store
 * doc) with the shopper's browser-granted location (useLocationStore) to
 * show a real distance with no extra network round-trip. GET /api/stores/
 * {id} itself doesn't compute distance — it has no request-scoped user
 * location to compute it against, unlike the list endpoints. Renders
 * nothing when either half of the calculation is unavailable — never a
 * fabricated distance.
 */
import { useLocationStore } from "@/stores";
import { haversineKm } from "@/lib/geo";

export function StoreDistanceText({
  storeLat, storeLng, className,
}: {
  storeLat?: number | null;
  storeLng?: number | null;
  className?: string;
}) {
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  if (lat == null || lng == null || storeLat == null || storeLng == null) return null;
  const km = haversineKm(lat, lng, storeLat, storeLng);
  return <span className={className}>· {km.toFixed(1)} km away</span>;
}
