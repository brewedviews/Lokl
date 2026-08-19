/**
 * Brand endpoints (Phase 1). Read-only from the consumer/merchant side —
 * Brand is a closed, admin-curated vocabulary. Creation/editing lives
 * exclusively in the admin CMS (see adminApi.createBrand/updateBrand and
 * BrandsEditor.tsx); there is no merchant- or public-facing create route.
 */
import { apiClient } from "@/lib/api-client";
import type { Brand, BrandListResponse } from "@/types";

export const brandsApi = {
  /** GET /api/brands?search=&skip=&limit=&sort= — powers the merchant
   *  product form's search-only combobox, the /brands directory
   *  (sort="name", the default), and Home's "Shop by Brand" rail
   *  (sort="popular" = product_count desc). */
  list: async (params?: { search?: string; skip?: number; limit?: number; sort?: "name" | "popular" }): Promise<BrandListResponse> => {
    const r = await apiClient.get<BrandListResponse>("/api/brands", { params });
    return r.data;
  },

  /** GET /api/brands/{slug_or_id} — dual lookup, mirrors stores. Returns
   *  brand metadata only; fetch the product grid separately via
   *  productsApi.list({ brand_id }) — the same shared, availability-aware
   *  endpoint every other product grid in the app uses. */
  getBySlugOrId: async (slugOrId: string): Promise<{ brand: Brand }> => {
    const r = await apiClient.get<{ brand: Brand }>(`/api/brands/${slugOrId}`);
    return r.data;
  },
};
