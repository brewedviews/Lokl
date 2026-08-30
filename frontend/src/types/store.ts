// Store types — match the real Mongo `stores` collection shape.
// Audit captured the literal keyset on disk:
//   address, area, banner, banners, city, closes_at, created_at, distance_km,
//   eta_min, id, image, is_deleted, kyc_status, lat, live_at, lng, locality,
//   location, logo, merchant_id, name, online, opens_at, paused, product_count,
//   published, rating, reviews, slug, specialties, story, tagline, timing,
//   trusted

import type { Id, IsoDateTime } from "./common";
import type { KycStatus } from "./user";

// Re-export so consumers don't have to know which module hosts it.
export type { KycStatus };

/** A storefront card as it appears in feeds, lists, and store detail.
 *  `distance_km` and `eta_min` are present in geo-aware queries; null elsewhere. */
export interface Store {
  id: Id;
  merchant_id: Id;
  slug: string;
  name: string;
  tagline: string | null;
  story: string | null;

  // Visual
  image: string | null;
  logo: string | null;
  banner: string | null;
  banners: string[];

  // Location (flat lat/lng on stores — NOT GeoJSON Point)
  city: string;
  area: string | null;
  area_label?: string | null;
  locality: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;

  // Real, computed at query time by GET /api/stores/{id} — never fabricated
  // client-side. Omit the metric line entirely when this is 0/absent rather
  // than showing "0 orders this month."
  orders_this_month?: number;

  // Geo query results
  distance_km: number | null;
  eta_min: number | null;

  // Operating
  timing: string | null;
  opens_at: string | null;
  closes_at: string | null;
  online: boolean;
  paused: boolean;
  is_open?: boolean;
  next_open_label?: string;
  badge?: string;
  /** Present on every store-listing endpoint response (list_stores,
   *  feed/nearby-stores, feed/popular-stores, categories/{l1}/stores) —
   *  not yet on GET /stores/{id} itself. 1=LIVE, 2=Away, 3=Closed,
   *  4=Store Offline. Use `storeStatusLabel(badge, next_open_label)`
   *  (lib/utils.ts) rather than reading this or `is_open` directly. */
  availability_rank?: number;
  eta_message?: string;
  published: boolean;
  live_at: IsoDateTime | null;
  kyc_status: KycStatus;

  // Trust signals
  rating: number | null;
  reviews: number;
  product_count: number;
  trusted: boolean;
  specialties: string[];

  // Merchandising rollup — computed fresh at query time from this store's
  // own visible (non-paused, non-deleted) products via one aggregation
  // per listing request (list_stores/feed-nearby/feed-popular), never
  // denormalized/stale. Present on every store-listing endpoint response.
  // `max_discount_percent` is 0 and `starting_price`/`primary_category`
  // are null when the store has no visible products at all — never
  // fabricated when there's nothing real to back the claim.
  max_discount_percent?: number;
  starting_price?: number | null;
  primary_category?: string | null;

  created_at: IsoDateTime;
}

/** Lighter projection used for "nearby stores" feed cards and search hits. */
export type StoreCard = Pick<
  Store,
  | "id" | "slug" | "name" | "tagline" | "logo" | "image" | "banner" | "banners"
  | "city" | "locality" | "area" | "area_label"
  | "distance_km" | "eta_min" | "rating" | "reviews" | "online" | "paused"
  | "product_count" | "specialties" | "trusted"
  | "badge" | "is_open" | "next_open_label" | "availability_rank"
  | "max_discount_percent" | "starting_price" | "primary_category"
>;

/** A featured area tile for the homepage "Shop by Area" section —
 *  GET /api/areas. `image` is null until an admin sets it via CMS. */
export interface AreaTile {
  slug: string;
  name: string;
  image: string | null;
  store_count: number;
}
