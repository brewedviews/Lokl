/**
 * Admin endpoints — login, homepage CMS + asset CMS + analytics (iter-26).
 *
 * Older legacy AdminPanel raw `fetch()` paths are wrapped progressively;
 * everything new in iter-26 uses this typed client.
 */
import { apiClient } from "@/lib/api-client";
import type {
  AdminAuthResponse, AdminLoginPayload, HomepageConfig,
  CmsCategory, CmsSubcategory, CmsArea, CmsOffer, CmsPriceBand, CmsDestinationSearch,
  CmsUploadResponse, AnalyticsAssetType, TopClicksResponse,
  Rider, RiderStatus, Brand, BrandListResponse,
  HeroSlide, HeroSlideCreatePayload,
  CmsStoreSectionOverride,
} from "@/types";

export interface AdminCreateRiderPayload {
  phone: string;
  name: string;
  zone?: string;
}

export interface AdminUpdateRiderPayload {
  status?: RiderStatus;
  name?: string;
  zone?: string;
}

/** GET /admin/stores/search result row — see that endpoint's own doc
 *  comment in server.py for why this is a separate, narrower shape than
 *  the full merchant-management store record. */
export interface AdminStoreSearchResult {
  id: string;
  name: string;
  image: string | null;
  category: string | null;
  area: string | null;
}

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

  // ── Areas ("Shop by Area") ──────────────────────────────────
  listAreas: async (): Promise<CmsArea[]> => {
    const r = await apiClient.get<CmsArea[]>("/api/admin/areas");
    return r.data;
  },

  updateArea: async (id: string, patch: Partial<CmsArea>): Promise<CmsArea> => {
    const r = await apiClient.put<CmsArea>(`/api/admin/areas/${id}`, patch);
    return r.data;
  },

  // ── Price bands (homepage price-bento tiles) ────────────────
  listPriceBands: async (): Promise<CmsPriceBand[]> => {
    const r = await apiClient.get<CmsPriceBand[]>("/api/admin/price-bands");
    return r.data;
  },

  updatePriceBand: async (id: string, patch: Partial<CmsPriceBand>): Promise<CmsPriceBand> => {
    const r = await apiClient.put<CmsPriceBand>(`/api/admin/price-bands/${id}`, patch);
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

  // ── Store section overrides (Footwear/Ethnic/Lingerie-or-Innerwear
  // Store CMS layer, Phase G4) — one whole-doc upsert per (l1_id, l2_id),
  // same shape as saveHomepageConfig, rather than separate pinned-card
  // CRUD endpoints (see server.py's own admin_put_store_section_override
  // doc comment for why). ─────────────────────────────────────
  listStoreSectionOverrides: async (): Promise<CmsStoreSectionOverride[]> => {
    const r = await apiClient.get<CmsStoreSectionOverride[]>("/api/admin/store-section-overrides");
    return r.data;
  },

  saveStoreSectionOverride: async (
    l1Id: string, l2Id: string,
    patch: Pick<CmsStoreSectionOverride, "banner_image" | "pinned_stores"> & Partial<Pick<CmsStoreSectionOverride, "display_title" | "mode">>,
  ): Promise<CmsStoreSectionOverride> => {
    const r = await apiClient.put<CmsStoreSectionOverride>(
      `/api/admin/store-section-overrides/${l1Id}/${l2Id}`, patch,
    );
    return r.data;
  },

  deleteStoreSectionOverride: async (l1Id: string, l2Id: string): Promise<void> => {
    await apiClient.delete(`/api/admin/store-section-overrides/${l1Id}/${l2Id}`);
  },

  /** G9 §6 — thin store search for a "Select Store" CMS picker. Backed by
   *  GET /admin/stores/search (projection-only: id/name/image/category/
   *  area, bypasses consumer visibility so an admin can find any real
   *  store), NOT the PII-laden /admin/stores merchant-management
   *  endpoint. */
  searchStores: async (q: string): Promise<AdminStoreSearchResult[]> => {
    const r = await apiClient.get<AdminStoreSearchResult[]>("/api/admin/stores/search", { params: { q } });
    return r.data;
  },

  // ── CMS shared helpers ──────────────────────────────────────
  /** `assetType` defaults to "cms" (shared homepage-asset folder); pass
   *  "brand_logo" from the Brand admin surface to route into lokl/brands
   *  instead. */
  uploadCmsImage: async (file: File, assetType: "cms" | "brand_logo" = "cms"): Promise<CmsUploadResponse> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("asset_type", assetType);
    // The shared axios instance defaults Content-Type to application/json;
    // for a multipart upload we must blank it so the browser sets the
    // correct multipart boundary itself. Without this FastAPI's File(...)
    // dependency fails to parse the body and returns 422.
    const r = await apiClient.post<CmsUploadResponse>("/api/admin/cms/upload", fd, {
      headers: { "Content-Type": undefined as unknown as string },
    });
    return r.data;
  },

  /** G10 §10 — re-hosts a pasted external image URL into Cloudinary
   *  (GET /admin/cms/upload-from-url) rather than the raw URL ever being
   *  stored directly — same policy already established for merchant
   *  product-image sync, extended to the CMS's own URL-paste path. */
  uploadCmsImageFromUrl: async (url: string, assetType: "cms" | "brand_logo" = "cms"): Promise<CmsUploadResponse> => {
    const r = await apiClient.post<CmsUploadResponse>("/api/admin/cms/upload-from-url", { url, asset_type: assetType });
    return r.data;
  },

  searchDestinations: async (q: string): Promise<CmsDestinationSearch> => {
    const r = await apiClient.get<CmsDestinationSearch>(
      `/api/admin/cms/search-destinations?q=${encodeURIComponent(q)}`,
    );
    return r.data;
  },

  // ── Riders (Phase 1 rider delivery platform, Commit 2 backend / 5 UI) ──
  listRiders: async (): Promise<Rider[]> => {
    const r = await apiClient.get<Rider[]>("/api/admin/riders");
    return r.data;
  },

  createRider: async (payload: AdminCreateRiderPayload): Promise<Rider> => {
    const r = await apiClient.post<Rider>("/api/admin/riders", payload);
    return r.data;
  },

  updateRider: async (id: string, patch: AdminUpdateRiderPayload): Promise<Rider> => {
    const r = await apiClient.patch<Rider>(`/api/admin/riders/${id}`, patch);
    return r.data;
  },

  // ── Brands (Phase 1) — full CRUD, unlike categories' edit-only list ──
  listBrands: async (params?: { search?: string; skip?: number; limit?: number }): Promise<BrandListResponse> => {
    const r = await apiClient.get<BrandListResponse>("/api/admin/brands", { params });
    return r.data;
  },

  createBrand: async (name: string): Promise<Brand> => {
    const r = await apiClient.post<Brand>("/api/admin/brands", { name });
    return r.data;
  },

  updateBrand: async (id: string, patch: Partial<Brand>): Promise<Brand> => {
    const r = await apiClient.put<Brand>(`/api/admin/brands/${id}`, patch);
    return r.data;
  },

  /** Soft-unlink, not cascade-delete — the backend clears `brand_id` on any
   *  tagged products rather than deleting them. */
  deleteBrand: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/admin/brands/${id}`);
  },

  // ── Hero slides (redesign Phase A) — per-L1 multi-slide hero carousel,
  // a separate system from the single site-wide Hero banner above ──
  listHeroSlides: async (l1_id?: string): Promise<HeroSlide[]> => {
    const r = await apiClient.get<HeroSlide[]>("/api/admin/hero-slides", { params: l1_id ? { l1_id } : undefined });
    return r.data;
  },

  createHeroSlide: async (payload: HeroSlideCreatePayload): Promise<HeroSlide> => {
    const r = await apiClient.post<HeroSlide>("/api/admin/hero-slides", payload);
    return r.data;
  },

  updateHeroSlide: async (id: string, patch: Partial<HeroSlide>): Promise<HeroSlide> => {
    const r = await apiClient.put<HeroSlide>(`/api/admin/hero-slides/${id}`, patch);
    return r.data;
  },

  deleteHeroSlide: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/admin/hero-slides/${id}`);
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
  } catch (e) {
    // Analytics must never block a navigation — swallow silently in prod,
    // but surface in dev so we can diagnose a broken endpoint.
    if (process.env.NODE_ENV !== "production") console.warn("[analytics] trackAssetClick failed", e);
  }
}
