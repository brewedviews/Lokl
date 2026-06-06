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
  locality: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;

  // Geo query results
  distance_km: number | null;
  eta_min: number | null;

  // Operating
  timing: string | null;
  opens_at: string | null;
  closes_at: string | null;
  online: boolean;
  paused: boolean;
  published: boolean;
  live_at: IsoDateTime | null;
  kyc_status: KycStatus;

  // Trust signals
  rating: number | null;
  reviews: number;
  product_count: number;
  trusted: boolean;
  specialties: string[];

  created_at: IsoDateTime;
}

/** Lighter projection used for "nearby stores" feed cards and search hits. */
export type StoreCard = Pick<
  Store,
  | "id" | "slug" | "name" | "tagline" | "logo" | "image" | "city" | "locality"
  | "distance_km" | "eta_min" | "rating" | "reviews" | "online" | "paused"
  | "product_count" | "specialties"
>;
