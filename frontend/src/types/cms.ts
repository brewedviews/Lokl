/**
 * Lokl Homepage Asset CMS — type definitions (iter-26).
 *
 * Mirrors the new admin endpoints in server.py:
 *   GET/PUT  /api/admin/categories[/:id]
 *   GET/PUT  /api/admin/subcategories[/:id]
 *   GET/PUT  /api/admin/offers[/:id]
 *   POST     /api/admin/cms/upload          (Cloudinary file → secure_url)
 *   GET      /api/admin/cms/search-destinations
 *   POST     /api/analytics/click
 *   GET      /api/admin/analytics/top-clicks
 */

export interface CmsCategory {
  id: string;
  name: string;
  slug: string;
  image?: string;
  redirect_url?: string;
  order?: number;
  paused?: boolean;
  non_clickable?: boolean;
}

export interface CmsSubcategory {
  id: string;
  name: string;
  slug: string;
  l1_id: string;
  image?: string;
  redirect_url?: string;
  paused?: boolean;
  non_clickable?: boolean;
}

/** Homepage "Shop by Area" tile — GET/PUT /api/admin/areas[/:id]. */
export interface CmsArea {
  id: string;
  slug: string;
  name: string;
  image?: string;
  order?: number;
  featured?: boolean;
}

/** Homepage price-bento tile ("Under ₹499" / "Most Loved" / "Premium") —
 *  GET/PUT /api/admin/price-bands[/:id]. `image` (global) and
 *  `l1_overrides` (G13 §10 — per-surface: "women"/"men"/"kids" keys) are
 *  admin-editable; label/slug/order are fixed by the band definitions. */
export interface CmsPriceBand {
  id: string;
  slug: string;
  label: string;
  image?: string;
  l1_overrides?: Partial<Record<"women" | "men" | "kids", string>>;
  order?: number;
}

export interface CmsOffer {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  cta_label?: string;
  cta_link?: string;
  redirect_url?: string;
  background?: string;
  rank: number;
  published: boolean;
  expires_at?: string | null;
  paused?: boolean;
  non_clickable?: boolean;
  /** G6 — event/campaign name (e.g. "Raksha Bandhan Special"), rendered as
   *  the offer strip's eyebrow. Falls back to "Limited time" when unset —
   *  same additive-optional-field pattern HeroSlide's subheadline/
   *  highlight_text already used. */
  eyebrow?: string;
  /** P0-6/P0-7 (G20 product review) — "strip" = thin text/CTA
   *  communication strip near the hero, no image; "banner" (default, and
   *  every pre-existing offer doc) = the ad-hoc image banner card this
   *  entity already was; "bento" (G21 P1-9) = an asymmetric visual-
   *  prominence layout for a campaign that deserves more than a banner.
   *  Same collection/editor, not a third system. */
  kind?: "strip" | "banner" | "bento";
  /** Only meaningful for kind="banner"/"bento" — a bounded preset, never an
   *  arbitrary CSS height, so an admin can't break the mobile layout. */
  aspect_ratio?: "21:9" | "16:9" | "3:1" | "4:3";
  /** null/absent = every surface; "global" = Marketplace home only; an L1
   *  id (e.g. "l1-women") = that L1 page only. Same sentinel HeroSlide's
   *  own l1_id already uses. */
  placement?: string | null;
  /** Optional scheduling start — paired with the existing expires_at. */
  starts_at?: string | null;
  /** G21 P1-9 — a SEPARATE display axis from `placement`: when set, this
   *  campaign is that one store's own campaign (rendered on the Store
   *  page only, via GET /offers?store_id=), not a replacement for
   *  placement's Marketplace/L1 scoping. */
  store_id?: string | null;
}

/** A single admin-curated display card pinned to a store section. Two
 *  kinds, distinguished by `store_id` (G9 §6):
 *   - Store card: `store_id` set, references a real store entity.
 *     `name`/`image`/`link` are populated FROM that store at save time
 *     (never hand-typed) so the card always reflects real store data.
 *   - Editorial card: `store_id` unset — the original manually-typed
 *     image+title+link, for a promotional destination that isn't a
 *     merchant. See CmsStoreSectionOverride. */
export interface CmsPinnedStoreCard {
  id: string;
  name: string;
  image?: string;
  link?: string;
  /** Set only for a "Store card" — the real store this card represents. */
  store_id?: string;
}

/** Footwear/Ethnic/Lingerie-or-Innerwear "Store" section CMS override —
 *  GET /api/store-section-overrides/:l1_id/:l2_id (public read, always
 *  well-formed even with no override saved yet),
 *  GET/PUT/DELETE /api/admin/store-section-overrides[/:l1_id/:l2_id].
 *  One doc per (l1_id, l2_id) pair. `banner_image` replaces the section's
 *  default L2-image banner when set; `pinned_stores` render alongside
 *  (never instead of) the real stores GET /categories/:l1_id/stores
 *  already returns for that same l2_id. */
export interface CmsStoreSectionOverride {
  id?: string;
  l1_id: string;
  l2_id: string;
  banner_image?: string;
  pinned_stores: CmsPinnedStoreCard[];
  /** G6 — admin-controlled section heading; empty falls back to the
   *  frontend's own default label for this module (unchanged pre-G6
   *  behavior). Decouples what's SHOWN from the L2 slug used as the
   *  storage/aggregation key, which is what lets e.g. Kids' third module
   *  be titled anything (not forced to "Lingerie"). */
  display_title?: string;
  /** G6 — "real_plus_editorial" (default: real stores_in_category()
   *  results first, then pinned cards — the original G4 behavior) or
   *  "editorial_only" (skip real-store aggregation, show only
   *  pinned_stores) — lets an admin make a module purely promotional. */
  mode?: "real_plus_editorial" | "editorial_only";
  created_at?: string;
  updated_at?: string;
}

export type CmsDestinationKind =
  | "stores"
  | "products"
  | "categories"
  | "subcategories"
  | "offers";

export interface CmsDestination {
  label: string;
  url: string;
  kind: string;
  id: string;
}

export interface CmsDestinationSearch {
  stores: CmsDestination[];
  products: CmsDestination[];
  categories: CmsDestination[];
  subcategories: CmsDestination[];
  offers: CmsDestination[];
}

export interface CmsUploadResponse {
  image_url: string;
  public_id: string;
  width?: number;
  height?: number;
  bytes?: number;
  format?: string;
}

export type AnalyticsAssetType = "hero" | "category" | "subcategory" | "offer";

export interface TopClickRow {
  asset_id: string;
  redirect_url: string;
  count: number;
}

export interface TopClicksResponse {
  asset_type: AnalyticsAssetType;
  days: number;
  rows: TopClickRow[];
}
