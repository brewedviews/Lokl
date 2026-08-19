// Brand type — mirrors the real Mongo `brands` collection shape (Phase 1).
// A store can carry multiple brands; Brand ≠ Store.

import type { Id, IsoDateTime } from "./common";

export interface Brand {
  id: Id;
  name: string;
  slug: string;
  logo: string;
  logo_public_id?: string;
  description?: string;
  product_count: number;
  created_by: string;
  created_at: IsoDateTime;
}

export interface BrandListResponse {
  brands: Brand[];
  total: number;
  skip: number;
  limit: number;
}
