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
