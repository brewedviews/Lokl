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
  { slug: "sector_1", label: "Sector 1", pincode: "490001", lat: 21.2023, lng: 81.4286 },
  { slug: "sector_2", label: "Sector 2", pincode: "490001", lat: 21.1987, lng: 81.4312 },
  { slug: "sector_4", label: "Sector 4", pincode: "490001", lat: 21.1965, lng: 81.4198 },
  { slug: "sector_6", label: "Sector 6", pincode: "490006", lat: 21.2156, lng: 81.4089 },
  { slug: "sector_7", label: "Sector 7", pincode: "490006", lat: 21.2134, lng: 81.4134 },
  { slug: "sector_9", label: "Sector 9", pincode: "490009", lat: 21.1876, lng: 81.3987 },
  { slug: "supela", label: "Supela", pincode: "490020", lat: 21.1756, lng: 81.3823 },
  { slug: "nehru_nagar", label: "Nehru Nagar", pincode: "490023", lat: 21.2234, lng: 81.4312 },
  { slug: "smriti_nagar", label: "Smriti Nagar", pincode: "490020", lat: 21.1923, lng: 81.4056 },
  { slug: "risali", label: "Risali", pincode: "490006", lat: 21.2312, lng: 81.3934 },
  { slug: "kumhari", label: "Kumhari", pincode: "490042", lat: 21.2645, lng: 81.3912 },
  { slug: "jamul", label: "Jamul", pincode: "490024", lat: 21.1534, lng: 81.3712 },
] as const;

export function findBhilaiArea(slug: string | undefined | null): BhilaiArea | null {
  if (!slug) return null;
  return BHILAI_AREAS.find((a) => a.slug === slug) ?? null;
}
