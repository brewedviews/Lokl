/**
 * Admin endpoints — login, homepage CMS + asset CMS + analytics (iter-26).
 *
 * Older legacy AdminPanel raw `fetch()` paths are wrapped progressively;
 * everything new in iter-26 uses this typed client.
 */
import { apiClient } from "@/lib/api-client";
import type {
  AdminAuthResponse, AdminLoginPayload, HomepageConfig,
  CmsCategory, CmsSubcategory, CmsOffer, CmsDestinationSearch,
  CmsUploadResponse, AnalyticsAssetType, TopClicksResponse,
} from "@/types";

export const adminApi = {
  login: async (payload: AdminLoginPayload): Promise<AdminAuthResponse> => {
    const r = await apiClient.post<AdminAuthResponse>("/api/admin/login", payload);
    return r.data;
  },

  // ── Homepage Config (hero + sections) ────────────────────────
  getHomepageConfig: async (): Promise<HomepageConfig> => {
    const r = await apiClient.get<HomepageConfig>("/api/admin/site/homepage-config");
    return r.data;
  },

  saveHomepageConfig: async (cfg: HomepageConfig): Promise<HomepageConfig> => {
    const r = await apiClient.put<HomepageConfig>("/api/admin/site/homepage-config", cfg);
    return r.data;
  },

  // ── L1 Categories ───────────────────────────────────────────
  listCategories: async (): Promise<CmsCategory[]> => {
    const r = await apiClient.get<CmsCategory[]>("/api/admin/categories");
    return r.data;
  },

  updateCategory: async (id: string, patch: Partial<CmsCategory>): Promise<CmsCategory> => {
    const r = await apiClient.put<CmsCategory>(`/api/admin/categories/${id}`, patch);
    return r.data;
  },

  // ── L2 Subcategories ────────────────────────────────────────
  listSubcategories: async (l1Id?: string): Promise<CmsSubcategory[]> => {
    const q = l1Id ? `?l1_id=${encodeURIComponent(l1Id)}` : "";
    const r = await apiClient.get<CmsSubcategory[]>(`/api/admin/subcategories${q}`);
    return r.data;
  },

  updateSubcategory: async (id: string, patch: Partial<CmsSubcategory>): Promise<CmsSubcategory> => {
    const r = await apiClient.put<CmsSubcategory>(`/api/admin/subcategories/${id}`, patch);
    return r.data;
  },

  // ── Offers ──────────────────────────────────────────────────
  listOffers: async (): Promise<CmsOffer[]> => {
    const r = await apiClient.get<CmsOffer[]>("/api/admin/offers");
    return r.data;
  },

  createOffer: async (offer: Partial<CmsOffer>): Promise<CmsOffer> => {
    const r = await apiClient.post<CmsOffer>("/api/admin/offers", offer);
    return r.data;
  },

  updateOffer: async (id: string, patch: Partial<CmsOffer>): Promise<CmsOffer> => {
    const r = await apiClient.put<CmsOffer>(`/api/admin/offers/${id}`, patch);
    return r.data;
  },

  deleteOffer: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/admin/offers/${id}`);
  },

  // ── CMS shared helpers ──────────────────────────────────────
  uploadCmsImage: async (file: File): Promise<CmsUploadResponse> => {
    const fd = new FormData();
    fd.append("file", file);
    // The shared axios instance defaults Content-Type to application/json;
    // for a multipart upload we must blank it so the browser sets the
    // correct multipart boundary itself. Without this FastAPI's File(...)
    // dependency fails to parse the body and returns 422.
    const r = await apiClient.post<CmsUploadResponse>("/api/admin/cms/upload", fd, {
      headers: { "Content-Type": undefined as unknown as string },
    });
    return r.data;
  },

  searchDestinations: async (q: string): Promise<CmsDestinationSearch> => {
    const r = await apiClient.get<CmsDestinationSearch>(
      `/api/admin/cms/search-destinations?q=${encodeURIComponent(q)}`,
    );
    return r.data;
  },

  // ── Analytics ───────────────────────────────────────────────
  topClicks: async (
    assetType: AnalyticsAssetType,
    days = 7,
    limit = 10,
  ): Promise<TopClicksResponse> => {
    const r = await apiClient.get<TopClicksResponse>(
      `/api/admin/analytics/top-clicks?asset_type=${assetType}&days=${days}&limit=${limit}`,
    );
    return r.data;
  },
};

// Public helper — called from consumer homepage to log a click. Fire-and-forget.
export async function trackAssetClick(
  asset_type: AnalyticsAssetType,
  asset_id: string,
  redirect_url: string,
): Promise<void> {
  try {
    await apiClient.post("/api/analytics/click", { asset_type, asset_id, redirect_url });
  } catch {
    // Analytics must never block a navigation — swallow silently.
  }
}
