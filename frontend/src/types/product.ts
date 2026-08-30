// Product types — mirror the real Mongo `products` collection.
// Audit-captured keyset:
//   ai_enhanced, created_at, description, gender, id, image, is_deleted,
//   l1_id, l2_id, merchant_id, mrp, name, paused, price, rating, sizes,
//   stock, store_city, store_distance_km, store_eta_min, store_id, store_name,
//   try_at_doorstep
// (`images: string[]` and `return_eligible: boolean` are present on newer
//  products created via the multi-image upload flow.)

import type { Id, IsoDateTime, RupeeAmount } from "./common";

export type Gender = "men" | "women" | "unisex" | "kids" | "" | string;

/** Per-size stock map. Backend stores stock as `{ "S": 10, "M": 8, "L": 0 }`
 *  — NOT a single `stock_quantity` scalar. */
export type StockMap = Record<string, number>;

export interface Product {
  id: Id;
  name: string;
  description: string;
  price: RupeeAmount;
  mrp: RupeeAmount | null;
  /** Server-computed, floored — ((mrp - price) / mrp) * 100, 0 whenever
   *  mrp is absent or does not exceed price. The single source of truth
   *  for discount display AND for min_discount/max_discount campaign
   *  filtering — never recompute this client-side with a different
   *  rounding rule (see server.py's `_calculate_discount_percent`). */
  discount_percent?: number;

  // Taxonomy
  l1_id: string;
  l2_id: string;
  gender: Gender;

  // Inventory
  sizes: string[];
  stock: StockMap | null;

  // Visual
  image: string;
  images: string[];
  // Cloudinary public_ids paired with `image` / `images` for lifecycle mgmt.
  image_public_id?: string;
  image_public_ids?: string[];

  // Store join (denormalized at write time for fast feed lookups)
  merchant_id: Id;
  store_id: Id;
  store_name: string;
  store_city: string;
  store_distance_km: number | null;
  store_eta_min: number | null;

  // Brand (Phase 1) — optional; absent on every product created before
  // the Brand entity existed, and not every merchant sets one.
  brand_id?: string | null;
  /** Lightweight embedded join, attached server-side by GET /api/products/{id}
   *  only when brand_id resolves to a real (still-existing) brand — never a
   *  broken/partial object for a stale or absent brand_id. */
  brand?: { id: string; name: string; slug: string; logo: string } | null;

  // Flags
  ai_enhanced: boolean;
  try_at_doorstep: boolean;
  return_eligible: boolean;
  /** Per-product return window in hours, merchant-set (1-24), null on
   *  products predating this field or when return_eligible is false — the
   *  return flow falls back to the historical 24h default. See G12 P1-8. */
  return_window_hours?: number | null;
  paused: boolean;

  /** Merchant-authored fit guidance ("runs slightly large, size down").
   *  No merchant/admin UI writes this yet, so it's null/absent for every
   *  product today — wired ahead of that UI existing, same pattern as the
   *  dormant `colors` field on ProductDetailPanel. Render only when present. */
  fit_note?: string | null;

  // Provenance (Admin Product Creation feature) — additive/optional, absent
  // on every product created before this feature shipped. Never backfilled.
  creation_source?: "merchant_manual" | "whatsapp" | "admin_manual" | "merchant_bulk" | "admin_bulk" | string;
  created_by?: string | null;
  bulk_import_id?: string | null;

  // Trust
  rating: number | null;
  reviews?: number;

  // Store availability (stamped by backend at query time)
  store_badge?: string;
  store_badge_color?: string;
  store_can_order?: boolean;
  store_eta_message?: string;
  store_opens_at_label?: string | null;
  store_availability_rank?: number;

  created_at: IsoDateTime;
}

/** Lightweight projection returned in feed lists / search hits. */
export type ProductCard = Pick<
  Product,
  | "id" | "name" | "price" | "mrp" | "discount_percent" | "image" | "images" | "rating"
  | "store_id" | "store_name" | "store_city" | "store_distance_km"
  | "try_at_doorstep" | "return_eligible" | "paused"
> & {
  store_badge?: string;
  store_badge_color?: string;
  store_can_order?: boolean;
  store_eta_message?: string;
  store_opens_at_label?: string | null;
  store_availability_rank?: number;
  /** Present on every raw product doc (GET /api/stores/{id}'s own
   *  products array included) even though most feed projections don't
   *  explicitly list it — optional here since not every endpoint's
   *  projection is guaranteed to keep it. G21 P1-10's store-page L2
   *  category chip filter reads this client-side. */
  l2_id?: string;
  /** Stamped by /feed/popular-in-city only — real 7-day order quantity
   *  for this product, 0 when the endpoint had no recent-order signal at
   *  all and fell back to a plain rating sort. G22 §7 reads this to
   *  decide whether "Popular near you"/"Popular in [L1]" has genuine
   *  signal behind it or is merely the honest-but-undifferentiated
   *  fallback, in which case the module hides rather than rendering. */
  orders_7d?: number;
};

/** Query params accepted by GET /api/products and the various /feed/* feeds. */
export interface ProductFilters {
  l1?: string;
  l2?: string;
  gender?: Gender;
  brand_id?: string;
  min_price?: number;
  max_price?: number;
  /** Campaign filtering — GET /products?min_discount=50 etc. Both are
   *  integers 0-100; the backend rejects an inverted range (min > max). */
  min_discount?: number;
  max_discount?: number;
  sort?: "popular" | "newest" | "price_asc" | "price_desc" | "discount";
  limit?: number;
  lat?: number;
  lng?: number;
}
