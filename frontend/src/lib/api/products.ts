/**
 * Products + product-feed endpoints (public).
 */
import { apiClient } from "@/lib/api-client";
import type { Product, ProductCard, ProductFilters } from "@/types";

export const productsApi = {
  /** GET /api/products?l1&l2&gender&min_price&max_price&sort&limit&lat&lng */
  list: async (filters?: ProductFilters): Promise<ProductCard[]> => {
    const r = await apiClient.get<ProductCard[]>("/api/products", {
      params: filters,
    });
    return r.data;
  },

  /** GET /api/products/{id} — full product detail with denormalized store join. */
  getById: async (id: string): Promise<Product> => {
    const r = await apiClient.get<Product>(`/api/products/${id}`);
    return r.data;
  },

  // ---------------- feeds ----------------
  popularInCity: async (limit = 10): Promise<ProductCard[]> => {
    const r = await apiClient.get<ProductCard[]>("/api/feed/popular-in-city", {
      params: { limit },
    });
    return r.data;
  },

  sellingFast: async (limit = 10): Promise<ProductCard[]> => {
    const r = await apiClient.get<ProductCard[]>("/api/feed/selling-fast", {
      params: { limit },
    });
    return r.data;
  },

  newArrivals: async (limit = 10): Promise<ProductCard[]> => {
    const r = await apiClient.get<ProductCard[]>("/api/feed/new-arrivals", {
      params: { limit },
    });
    return r.data;
  },

  /** GET /api/me/recently-viewed — server-side recents for logged-in customers
   *  (200 with [] for anonymous, never 401). */
  recentlyViewed: async (limit = 10): Promise<ProductCard[]> => {
    const r = await apiClient.get<ProductCard[]>("/api/me/recently-viewed", {
      params: { limit },
    });
    return r.data;
  },
};
