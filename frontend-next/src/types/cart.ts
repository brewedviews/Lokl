// Cart, search, feed, and ancillary types.

import type { RupeeAmount } from "./common";
import type { ProductCard } from "./product";
import type { StoreCard } from "./store";

// ============================================================================
// Cart (client-only state — never round-trips to the backend)
// ============================================================================

/** A single line in the local cart. `key` lets us treat same-product-different-
 *  size as separate lines without colliding on `product.id`. */
export interface CartItem {
  key: string;          // e.g. "<product_id>-<size>"
  id: string;           // product id
  name: string;
  price: RupeeAmount;
  qty: number;
  size?: string;
  image?: string;
  store_id: string;
  store_name?: string;
  return_eligible?: boolean;
}

/** Iter-32 — single-store enforcement. If the new item's store_id differs
 *  from the cart's current store, the addItem call surfaces this conflict
 *  so the UI can offer a "replace cart?" prompt. */
export interface CartConflict {
  existing_store_id: string;
  existing_store_name: string;
  new_store_id: string;
  new_store_name: string;
}

// ============================================================================
// Search & feed responses
// ============================================================================

export interface SearchResults {
  products: ProductCard[];
  stores: StoreCard[];
}

export interface CategoryCount {
  id: string;          // l1_id
  name: string;
  count: number;
  image?: string;
}

export interface CategoryNode {
  id: string;          // l1_id
  name: string;
  slug: string;
  l2: Array<{ id: string; name: string; slug: string }>;
}

export interface Offer {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  cta_label?: string;
  cta_href?: string;
  bg?: string;
  fg?: string;
}

export interface Testimonial {
  id: string;
  name: string;
  city: string;
  rating: number;
  message: string;
  avatar?: string;
}

export interface HomeStats {
  stores_count: number;
  products_count: number;
  cities_count: number;
  orders_today?: number;
}

// ============================================================================
// Site config (admin-editable homepage)
// ============================================================================

export interface HeroSlide {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  cta_label?: string;
  cta_href?: string;
}

export interface HomepageConfig {
  hero: HeroSlide[];
  sections: Array<{
    id: string;
    title: string;
    kind: string;
    payload?: unknown;
    enabled: boolean;
  }>;
}

// Re-exports so consumers can `import { Product, Store } from "@/types"`.
export type { Product, ProductCard } from "./product";
export type { Store, StoreCard } from "./store";
