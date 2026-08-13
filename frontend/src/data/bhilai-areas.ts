/**
 * Bhilai pilot — fixed list of serviceable areas with pincode + default map
 * coordinates. The dropdown on /merchant/storefront writes `area` (slug),
 * `area_label`, and auto-fills `pincode` + `lat/lng` from this table.
 *
 * Coordinates were sourced from Google Maps centroids on 2026-02 and are
 * adequate as a starting pin position — the merchant is required to confirm
 * the exact location after selection, so a small approximation is fine.
 */
export interface BhilaiArea {
  slug: string;        // stored on the store doc (`area_slug`)
  label: string;       // human-facing
  pincode: string;
  lat: number;
  lng: number;
}

export const BHILAI_AREAS: readonly BhilaiArea[] = [
  { slug: "risali", label: "Risali", pincode: "490006", lat: 21.1876, lng: 81.3187 },
  { slug: "ruabandha", label: "Ruabandha", pincode: "490006", lat: 21.2034, lng: 81.3456 },
  { slug: "new-ruabandha", label: "New Ruabandha", pincode: "490006", lat: 21.2067, lng: 81.3512 },
  { slug: "maroda", label: "Maroda", pincode: "490006", lat: 21.1934, lng: 81.3298 },
  { slug: "sector-10", label: "Sector 10", pincode: "490006", lat: 21.1998, lng: 81.3387 },
  { slug: "sector-7", label: "Sector 7", pincode: "490006", lat: 21.1923, lng: 81.3423 },
  { slug: "sector-6", label: "Sector 6", pincode: "490006", lat: 21.1945, lng: 81.3456 },
  { slug: "sector-5", label: "Sector 5", pincode: "490006", lat: 21.1912, lng: 81.3489 },
  { slug: "civic-centre", label: "Civic Centre", pincode: "490006", lat: 21.1887, lng: 81.3521 },
  { slug: "talpuri-b-block", label: "Talpuri B Block", pincode: "490006", lat: 21.1856, lng: 81.3398 },
  { slug: "talpuri-a-block", label: "Talpuri A Block", pincode: "490009", lat: 21.1834, lng: 81.3367 },
  { slug: "sector-9", label: "Sector 9", pincode: "490009", lat: 21.1867, lng: 81.3334 },
  { slug: "sector-8", label: "Sector 8", pincode: "490009", lat: 21.1845, lng: 81.3312 },
  { slug: "hudco", label: "Hudco", pincode: "490009", lat: 21.1812, lng: 81.3289 },
  { slug: "hospital-sector", label: "Hospital Sector", pincode: "490009", lat: 21.1789, lng: 81.3267 },
  { slug: "32-bungalow", label: "32 Bungalow", pincode: "490009", lat: 21.1767, lng: 81.3245 },
  { slug: "sector-1", label: "Sector 1", pincode: "490001", lat: 21.2123, lng: 81.3789 },
  { slug: "sector-2", label: "Sector 2", pincode: "490001", lat: 21.2145, lng: 81.3812 },
  { slug: "sector-3", label: "Sector 3", pincode: "490001", lat: 21.2167, lng: 81.3834 },
  { slug: "sector-4", label: "Sector 4", pincode: "490001", lat: 21.2189, lng: 81.3856 },
  { slug: "sector-11", label: "Sector 11", pincode: "490001", lat: 21.2212, lng: 81.3878 },
  { slug: "powerhouse", label: "Powerhouse", pincode: "490001", lat: 21.2234, lng: 81.3901 },
  { slug: "supela", label: "Supela", pincode: "490023", lat: 21.2312, lng: 81.4012 },
  { slug: "nehru-nagar", label: "Nehru Nagar", pincode: "490020", lat: 21.2189, lng: 81.3923 },
  { slug: "smriti-nagar", label: "Smriti Nagar", pincode: "490020", lat: 21.2156, lng: 81.3945 },
] as const;

export function findBhilaiArea(slug: string | undefined | null): BhilaiArea | null {
  if (!slug) return null;
  return BHILAI_AREAS.find((a) => a.slug === slug) ?? null;
}

/**
 * Group C3 — the customer address form has no area-slug picker (unlike
 * /merchant/storefront, which does), only a typed pincode. Same table,
 * different key: returns the first area whose pincode matches, as an
 * APPROXIMATE seed for the delivery-pin picker — several areas can share a
 * pincode, so this is a starting point for the customer to confirm/adjust
 * via "use current location," never treated as a precise pin on its own.
 */
export function findBhilaiAreaByPincode(pincode: string | undefined | null): BhilaiArea | null {
  const p = (pincode || "").trim();
  if (p.length !== 6) return null;
  return BHILAI_AREAS.find((a) => a.pincode === p) ?? null;
}
