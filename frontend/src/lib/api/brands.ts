/**
 * Brand endpoints (Phase 1). GET routes are public; POST requires a
 * merchant (or admin) JWT — see the `/^\/api\/brands$/` entry in
 * MERCHANT_ROUTE_PATTERNS (api-client.ts) that attaches it.
 */
import { apiClient } from "@/lib/api-client";
import type { Brand, BrandListResponse, ProductCard } from "@/types";

export const brandsApi = {
  /** GET /api/brands?search=&skip=&limit= — powers the creatable combobox's
   *  typeahead as well as any future brand-browsing UI. */
  list: async (params?: { search?: string; skip?: number; limit?: number }): Promise<BrandListResponse> => {
    const r = await apiClient.get<BrandListResponse>("/api/brands", { params });
    return r.data;
  },

  /** GET /api/brands/{slug_or_id} — dual lookup, mirrors stores. */
  getBySlugOrId: async (slugOrId: string): Promise<{ brand: Brand; products: ProductCard[] }> => {
    const r = await apiClient.get<{ brand: Brand; products: ProductCard[] }>(`/api/brands/${slugOrId}`);
    return r.data;
  },

  /** POST /api/brands — the combobox's "Create '{name}'" option. Returns
   *  the existing brand instead of a duplicate if the name already matches
   *  one case-insensitively. */
  create: async (name: string): Promise<Brand> => {
    const r = await apiClient.post<Brand>("/api/brands", { name });
    return r.data;
  },
};
