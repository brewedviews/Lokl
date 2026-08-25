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
  /** Snapshotted from the product at add-to-cart time, for the strikethrough
   *  MRP display and the bill's MRP-total line. Absent/equal-to-price on
   *  items added before this field existed — no strikethrough renders then. */
  mrp?: RupeeAmount | null;
  qty: number;
  size?: string;
  image?: string;
  store_id: string;
  store_name?: string;
  return_eligible?: boolean;
  /** Snapshotted from the product at add-to-cart time (G13) — whether THIS
   *  product supports Try & Buy at all. Purely eligibility; the customer's
   *  actual checkout choice is `fulfillment_type` below. */
  try_at_doorstep?: boolean;
  /** Customer's fulfillment choice for this line, captured at checkout
   *  (G13 §1). Absent/"standard" is the default. Only ever meaningfully
   *  "try_and_buy" when `try_at_doorstep` is true for this line — ineligible
   *  items are never silently switched. This is INTENT CAPTURE ONLY: no
   *  payment-hold, rider-workflow, trial-timer, or return-to-store logic
   *  exists downstream yet (see create_order's own comment in server.py). */
  fulfillment_type?: "standard" | "try_and_buy";
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

/** Image for each homepage price-bento tile — an admin CMS override if one
 *  is set, else the cheapest visible product's image in that band, else
 *  `null` when the band has neither (sparse catalog — tile falls back to
 *  a neutral tile). Overlapping "Under X" bands (redesign Phase A) — a
 *  product under 499 also matches under_999 and under_1499. */
export interface PriceBentoResponse {
  under_499: string | null;
  under_999: string | null;
  under_1499: string | null;
  /** G8 — 4th "Picks for Every Budget" bento tile (highest-priced visible
   *  products, admin-override-first, never fabricated). */
  premium: string | null;
}

export interface CategoryNode {
  id: string;          // l1_id
  name: string;
  slug: string;
  image?: string;
  /** Cheapest visible product price in this L1, or null/absent if it has none yet. */
  min_price?: number | null;
  l2: Array<{ id: string; name: string; slug: string; image?: string; min_price?: number | null }>;
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
  /** Photo for the homepage "Try & Buy" strip — admin-settable, empty
   *  string when unset (renders a neutral fallback). */
  try_and_buy_image?: string;
  // Forward-compat slots — admins may publish these later without a backend change.
  offers?: unknown[];
  text_overrides?: Record<string, string>;
}

// Re-exports so consumers can `import { Product, Store } from "@/types"`.
export type { Product, ProductCard } from "./product";
export type { Store, StoreCard } from "./store";
