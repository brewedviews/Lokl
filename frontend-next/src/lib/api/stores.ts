/**
 * Stores + storefront discovery endpoints (public).
 *
 * All routes here are unauthenticated reads. The geo-aware variants take
 * `lat`/`lng` query params; the backend gracefully falls back to a non-geo
 * sort when those are missing.
 */
import { apiClient } from "@/lib/api-client";
import type { Store, StoreCard } from "@/types";

export const storesApi = {
  /** GET /api/stores?limit=&lat=&lng= — non-geo store list / geo-aware feed. */
  list: async (params?: {
    limit?: number;
    lat?: number;
    lng?: number;
  }): Promise<Store[]> => {
    const r = await apiClient.get<Store[]>("/api/stores", { params });
    return r.data;
  },

  /** GET /api/stores/{id} — full store detail (used by /store/:id page). */
  getById: async (id: string): Promise<Store> => {
    const r = await apiClient.get<Store>(`/api/stores/${id}`);
    return r.data;
  },

  /** GET /api/feed/nearby-stores?lat&lng&limit — geo feed (8-12 entries). */
  nearby: async (params: {
    lat: number;
    lng: number;
    limit?: number;
  }): Promise<StoreCard[]> => {
    const r = await apiClient.get<StoreCard[]>("/api/feed/nearby-stores", {
      params: { limit: 8, ...params },
    });
    return r.data;
  },

  /** GET /api/feed/popular-stores?limit — non-geo, city-level popularity. */
  popular: async (limit = 8): Promise<StoreCard[]> => {
    const r = await apiClient.get<StoreCard[]>("/api/feed/popular-stores", {
      params: { limit },
    });
    return r.data;
  },
};
