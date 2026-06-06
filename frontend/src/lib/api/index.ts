/**
 * Site-wide public endpoints used by the home page, search, categories, and
 * the public storefront banner CMS.
 */
import { apiClient } from "@/lib/api-client";
import type {
  CategoryCount, CategoryNode, HomeStats, HomepageConfig, Offer,
  SearchResults, Testimonial,
} from "@/types";

export const siteApi = {
  homepageConfig: async (): Promise<HomepageConfig> => {
    const r = await apiClient.get<HomepageConfig>("/api/site/homepage-config");
    return r.data;
  },

  homeStats: async (): Promise<HomeStats> => {
    const r = await apiClient.get<HomeStats>("/api/stats/home");
    return r.data;
  },

  /** GET /api/heartbeat — POST in the legacy app, but used as a simple
   *  "am I online?" health ping. Kept here for reference but the hook
   *  remains POST since that's the actual route signature. */
  heartbeat: async (): Promise<{ ok: boolean; ts: string }> => {
    const r = await apiClient.post<{ ok: boolean; ts: string }>(
      "/api/heartbeat",
      {},
    );
    return r.data;
  },
};

export const catalogApi = {
  categories: async (): Promise<CategoryNode[]> => {
    const r = await apiClient.get<CategoryNode[]>("/api/categories");
    return r.data;
  },

  categoryCounts: async (): Promise<CategoryCount[]> => {
    const r = await apiClient.get<CategoryCount[]>("/api/categories/counts");
    return r.data;
  },

  offers: async (): Promise<Offer[]> => {
    const r = await apiClient.get<Offer[]>("/api/offers");
    return r.data;
  },

  testimonials: async (): Promise<Testimonial[]> => {
    const r = await apiClient.get<Testimonial[]>("/api/testimonials");
    return r.data;
  },
};

export const searchApi = {
  /** GET /api/search?q&limit — returns {products, stores}. Empty `q` => empty. */
  search: async (q: string, limit = 60): Promise<SearchResults> => {
    if (!q.trim()) return { products: [], stores: [] };
    const r = await apiClient.get<SearchResults>("/api/search", {
      params: { q, limit },
    });
    return r.data;
  },

  /** Autocomplete: the consumer header hits /search?q with no limit for sugg. */
  suggest: async (q: string): Promise<SearchResults> => {
    if (!q.trim()) return { products: [], stores: [] };
    const r = await apiClient.get<SearchResults>("/api/search", { params: { q } });
    return r.data;
  },
};

/** Misc cross-cutting endpoint we couldn't put anywhere else. */
export const miscApi = {
  /** POST /api/heartbeat — used by the activity-ping hook. Empty body is fine. */
  heartbeat: async (): Promise<{ ok: boolean }> => {
    const r = await apiClient.post<{ ok: boolean }>("/api/heartbeat", {});
    return r.data;
  },

  /** GET /api/me/recently-viewed?limit — see also productsApi.recentlyViewed
   *  (duplicate ergonomics — exported from products domain). */
};

// Re-export the lower-level fetchers for code organization-friendly imports.
export { storesApi } from "./stores";
export { productsApi } from "./products";
export { customersApi } from "./customers";
export { ordersApi } from "./orders";
export { merchantApi } from "./merchant";
export { adminApi } from "./admin";
export { authApi } from "./auth";

// Aliased imports so consumers can grab a single bundle.
import { storesApi as _storesApi } from "./stores";
import { productsApi as _productsApi } from "./products";
import { customersApi as _customersApi } from "./customers";
import { ordersApi as _ordersApi } from "./orders";
import { merchantApi as _merchantApi } from "./merchant";
import { adminApi as _adminApi } from "./admin";
import { authApi as _authApi } from "./auth";

export const api = {
  auth: _authApi,
  stores: _storesApi,
  products: _productsApi,
  customers: _customersApi,
  orders: _ordersApi,
  merchant: _merchantApi,
  admin: _adminApi,
  site: siteApi,
  catalog: catalogApi,
  search: searchApi,
  misc: miscApi,
};
