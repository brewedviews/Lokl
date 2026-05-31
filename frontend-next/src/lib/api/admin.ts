/**
 * Admin endpoints — login + homepage CMS.
 *
 * This module covers ONLY the routes the legacy `AdminPanel.jsx` already
 * hits via the api wrapper. AdminPanel's raw `fetch()` paths (every other
 * admin endpoint, including approvals/orders/refunds/exports) will be
 * wrapped by `lib/legacy-admin.ts` in Session C — see the api-client
 * header comment for the rationale.
 */
import { apiClient } from "@/lib/api-client";
import type {
  AdminAuthResponse, AdminLoginPayload, HomepageConfig,
} from "@/types";

export const adminApi = {
  login: async (payload: AdminLoginPayload): Promise<AdminAuthResponse> => {
    const r = await apiClient.post<AdminAuthResponse>("/api/admin/login", payload);
    return r.data;
  },

  getHomepageConfig: async (): Promise<HomepageConfig> => {
    const r = await apiClient.get<HomepageConfig>("/api/admin/site/homepage-config");
    return r.data;
  },

  saveHomepageConfig: async (cfg: HomepageConfig): Promise<HomepageConfig> => {
    const r = await apiClient.put<HomepageConfig>(
      "/api/admin/site/homepage-config",
      cfg,
    );
    return r.data;
  },
};
