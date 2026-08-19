/**
 * Site-wide public endpoints used by the home page, search, categories, and
 * the public storefront banner CMS.
 */
import { apiClient } from "@/lib/api-client";
import type {
  AreaTile, CategoryCount, CategoryNode, HomeStats, HomepageConfig, Offer,
  PriceBentoResponse, SearchResults, Testimonial,
} from "@/types";

export interface ActiveCoupon {
  id: string;
  code: string;
  discount_type: "percent" | "flat";
  discount_value: number;
  min_order_value: number;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
}

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

  /** GET /api/areas — featured "Shop by Area" tiles, image + live store count. */
  areas: async (): Promise<AreaTile[]> => {
    const r = await apiClient.get<AreaTile[]>("/api/areas");
    return r.data;
  },

  /** GET /api/feed/price-bento — one representative (cheapest visible)
   *  product per homepage price-bento band. A band is `null` when the
   *  catalog has nothing in that range yet. */
  priceBento: async (): Promise<PriceBentoResponse> => {
    const r = await apiClient.get<PriceBentoResponse>("/api/feed/price-bento");
    return r.data;
  },

  /** GET /api/coupons/active — public, read-only listing of currently
   *  redeemable coupons (no code needed in advance). Used by the PDP
   *  offers card. Order-level, not product-specific — the backend has no
   *  per-product/category coupon targeting today. */
  activeCoupons: async (limit = 5): Promise<ActiveCoupon[]> => {
    const r = await apiClient.get<ActiveCoupon[]>("/api/coupons/active", { params: { limit } });
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

  /** GET /api/search/trending — last 30 days, falls back to a hand-picked
   *  list when the search_queries collection is empty. */
  trending: async (limit = 8): Promise<Array<{ q: string; count?: number }>> => {
    const r = await apiClient.get<Array<{ q: string; count?: number }>>("/api/search/trending", { params: { limit } });
    return r.data;
  },

  /** POST /api/search/track — fire-and-forget for analytics. */
  track: async (q: string): Promise<{ ok: boolean }> => {
    const r = await apiClient.post<{ ok: boolean }>("/api/search/track", { q });
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
export { brandsApi } from "./brands";
export { productsApi } from "./products";
export { customersApi } from "./customers";
export { ordersApi } from "./orders";
export { merchantApi } from "./merchant";
export { adminApi } from "./admin";
export { authApi } from "./auth";
export { deliveryApi } from "./delivery";
export { riderApi } from "./rider";

// Aliased imports so consumers can grab a single bundle.
import { storesApi as _storesApi } from "./stores";
import { brandsApi as _brandsApi } from "./brands";
import { productsApi as _productsApi } from "./products";
import { customersApi as _customersApi } from "./customers";
import { ordersApi as _ordersApi } from "./orders";
import { merchantApi as _merchantApi } from "./merchant";
import { adminApi as _adminApi } from "./admin";
import { authApi as _authApi } from "./auth";
import { deliveryApi as _deliveryApi } from "./delivery";
import { riderApi as _riderApi } from "./rider";
import { paymentsApi as _paymentsApi } from "./payments";

export const api = {
  auth: _authApi,
  stores: _storesApi,
  brands: _brandsApi,
  products: _productsApi,
  customers: _customersApi,
  orders: _ordersApi,
  merchant: _merchantApi,
  admin: _adminApi,
  site: siteApi,
  catalog: catalogApi,
  search: searchApi,
  misc: miscApi,
  delivery: _deliveryApi,
  rider: _riderApi,
  payments: _paymentsApi,
};
