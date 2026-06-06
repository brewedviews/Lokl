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

  // Store join (denormalized at write time for fast feed lookups)
  merchant_id: Id;
  store_id: Id;
  store_name: string;
  store_city: string;
  store_distance_km: number | null;
  store_eta_min: number | null;

  // Flags
  ai_enhanced: boolean;
  try_at_doorstep: boolean;
  return_eligible: boolean;
  paused: boolean;

  // Trust
  rating: number | null;
  reviews?: number;

  created_at: IsoDateTime;
}

/** Lightweight projection returned in feed lists / search hits. */
export type ProductCard = Pick<
  Product,
  | "id" | "name" | "price" | "mrp" | "image" | "images" | "rating"
  | "store_id" | "store_name" | "store_city" | "store_distance_km"
  | "try_at_doorstep" | "return_eligible" | "paused"
>;

/** Query params accepted by GET /api/products and the various /feed/* feeds. */
export interface ProductFilters {
  l1?: string;
  l2?: string;
  gender?: Gender;
  min_price?: number;
  max_price?: number;
  sort?: "popular" | "newest" | "price_asc" | "price_desc";
  limit?: number;
  lat?: number;
  lng?: number;
}
