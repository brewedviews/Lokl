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

/** One store per bag. Adding an item from a different store than what's
 *  already in the bag surfaces a conflict so the UI can warn the customer
 *  and offer to clear the bag and start over. `existing_store_name` carries
 *  the store already in the bag; `existing_store_names` lists the same
 *  (kept as an array for backward-compat with callers built for the old
 *  multi-store limit). */
export interface CartConflict {
  existing_store_id: string;
  existing_store_name: string;
  existing_store_names: string[];
  new_store_id: string;
  new_store_name: string;
  max_stores: number;
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
  image?: string;
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

/** Iter-26 — CMS-driven homepage shape. Matches the backend
 *  GET /api/site/homepage-config response: a single doc with editable
 *  hero, sections, plus optional offers/text-override extensions. */
export interface HeroConfig {
  image?: string;
  mobile_image?: string;
  eyebrow?: string;
  title_line1?: string;
  title_line2?: string;
  subtitle?: string;
  cta_primary_label?: string;
  cta_primary_link?: string;
  cta_secondary_label?: string;
  cta_secondary_link?: string;
  redirect_url?: string;
  show_stats?: boolean;
  show_usp_chips?: boolean;
  paused?: boolean;
  non_clickable?: boolean;
}

export interface HomepageSection {
  id: string;
  label: string;
  enabled: boolean;
  rank: number;
}

export interface HomepageConfig {
  id?: string;
  hero?: HeroConfig;
  sections?: HomepageSection[];
  // Forward-compat slots — admins may publish these later without a backend change.
  offers?: unknown[];
  text_overrides?: Record<string, string>;
}

// Re-exports so consumers can `import { Product, Store } from "@/types"`.
export type { Product, ProductCard } from "./product";
export type { Store, StoreCard } from "./store";
