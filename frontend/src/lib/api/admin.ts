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
  Product,
} from "@/types";
import type { StorefrontFormBody } from "@/components/storefront/StorefrontForm";
import type { ProductFormColorVariant } from "@/components/products/ProductForm";

// ── Admin Product Creation (manual + bulk) ─────────────────────────────
// Mirrors server.py's AdminProductCreateRequest / bulk detect+import+
// rollback response shapes exactly — see backend/server.py's own
// `admin_create_product`/`admin_bulk_products_detect`/
// `admin_bulk_products_import`/`admin_rollback_bulk_import`.
export interface AdminProductCreatePayload {
  product: {
    name: string; price: number; mrp?: number; l1_id: string; l2_id?: string; gender?: string;
    description?: string; sizes?: string[]; stock?: Record<string, number>; size_type?: string;
    image?: string; images?: string[]; image_public_id?: string; image_public_ids?: string[];
    brand_id?: string; return_eligible?: boolean; return_window_hours?: number; try_at_doorstep?: boolean;
    color_variants?: ProductFormColorVariant[];
  };
  admin_override?: boolean;
  bypass_plan_limit?: boolean;
  publish_immediately?: boolean;
}

/** The response is the full created Product document. */
export type AdminProduct = Product;

export interface AdminBulkPreviewRow {
  row: number;
  name: string | null;
  status: "valid" | "warning" | "error";
  messages: string[];
  category: string | null;
  price: number | null;
  mrp?: number | null;
  stock_summary: Record<string, number> | null;
}

export interface AdminBulkDetectResult {
  import_id: string;
  rows: AdminBulkPreviewRow[];
  total_rows: number;
  valid_count: number;
  warning_count: number;
  error_count: number;
}

export interface AdminBulkRowError {
  row: number;
  message: string;
}

export interface AdminBulkImportResult {
  import_id: string;
  status: "completed" | "completed_with_errors";
  successful_rows: number;
  failed_rows: number;
  created_product_ids: string[];
  row_errors: AdminBulkRowError[];
}

export interface AdminBulkImport {
  id: string;
  merchant_id: string;
  store_id: string;
  uploaded_by: string;
  filename: string;
  creation_source: string;
  total_rows: number;
  successful_rows: number;
  failed_rows: number;
  status: "pending_review" | "processing" | "completed" | "completed_with_errors" | "rolled_back";
  row_errors: AdminBulkRowError[];
  created_product_ids: string[];
  created_at: string;
  completed_at: string | null;
}

export interface AdminBulkRollbackResult {
  import_id: string;
  status: "rolled_back";
  products_soft_deleted: number;
  total_products_in_import: number;
}

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

  /** `l1` (G13 §10) writes `l1_overrides.<l1>` server-side instead of the
   *  top-level global `image` — omit it to edit the global/Marketplace image
   *  exactly as before. */
  updatePriceBand: async (id: string, patch: { image?: string; l1?: "women" | "men" | "kids" }): Promise<CmsPriceBand> => {
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

  // ── Admin Storefront Setup ────────────────────────────────────
  // Reuses the exact same StorefrontForm field shape/validation the
  // merchant's own POST /merchant/storefront uses — see
  // components/storefront/StorefrontForm.tsx and server.py's
  // `_create_or_setup_storefront_for_merchant`. Create-only: rejects
  // (409) if the merchant already has a storefront — editing an existing
  // one stays on PUT /admin/stores/{id} (adminUpdateStore).
  createStorefront: async (merchantId: string, payload: StorefrontFormBody): Promise<{ ok: boolean; store: Record<string, unknown> }> => {
    const r = await apiClient.post<{ ok: boolean; store: Record<string, unknown> }>(`/api/admin/merchants/${merchantId}/storefront`, payload);
    return r.data;
  },

  // ── Admin Product Creation (manual + bulk) ───────────────────
  // Template download is `downloads.adminProductsTemplate()` (binary
  // stream, bypasses axios like every other CSV/XLSX export — see
  // lib/downloads.ts's own doc comment), not a method here.

  createProduct: async (merchantId: string, payload: AdminProductCreatePayload): Promise<AdminProduct> => {
    const r = await apiClient.post<AdminProduct>(`/api/admin/merchants/${merchantId}/products`, payload);
    return r.data;
  },

  bulkDetectProducts: async (merchantId: string, file: File): Promise<AdminBulkDetectResult> => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await apiClient.post<AdminBulkDetectResult>(
      `/api/admin/merchants/${merchantId}/products/bulk/detect`, fd,
      { headers: { "Content-Type": undefined as unknown as string } },
    );
    return r.data;
  },

  bulkImportProducts: async (
    merchantId: string, importId: string, rowNumbers?: number[],
  ): Promise<AdminBulkImportResult> => {
    const r = await apiClient.post<AdminBulkImportResult>(
      `/api/admin/merchants/${merchantId}/products/bulk/import`,
      { import_id: importId, row_numbers: rowNumbers ?? null },
    );
    return r.data;
  },

  getBulkImport: async (importId: string): Promise<AdminBulkImport> => {
    const r = await apiClient.get<AdminBulkImport>(`/api/admin/bulk-imports/${importId}`);
    return r.data;
  },

  rollbackBulkImport: async (importId: string): Promise<AdminBulkRollbackResult> => {
    const r = await apiClient.post<AdminBulkRollbackResult>(`/api/admin/bulk-imports/${importId}/rollback`);
    return r.data;
  },

  // ── Social content agent (Lokl x Claude social-agent blueprint) ────────
  // Business Intelligence opportunities (read-only) + the human-approval
  // content queue. Backend: routes/social_content.py.
  listDiscountOpportunities: async (minDelta = 15): Promise<SocialDiscountOpportunity[]> => {
    const r = await apiClient.get<SocialDiscountOpportunity[]>(
      `/api/admin/social/opportunities/discounts?min_delta=${minDelta}`,
    );
    return r.data;
  },

  listNewStoreOpportunities: async (): Promise<SocialNewStoreOpportunity[]> => {
    const r = await apiClient.get<SocialNewStoreOpportunity[]>("/api/admin/social/opportunities/new-stores");
    return r.data;
  },

  createSocialQueueItem: async (payload: SocialQueueItemCreate): Promise<SocialQueueItem> => {
    const r = await apiClient.post<SocialQueueItem>("/api/admin/social/queue", payload);
    return r.data;
  },

  listSocialQueue: async (status?: SocialQueueStatus): Promise<SocialQueueItem[]> => {
    const r = await apiClient.get<SocialQueueItem[]>(
      `/api/admin/social/queue${status ? `?status=${status}` : ""}`,
    );
    return r.data;
  },

  approveSocialQueueItem: async (id: string, note?: string): Promise<SocialQueueItem> => {
    const r = await apiClient.post<SocialQueueItem>(`/api/admin/social/queue/${id}/approve`, { note });
    return r.data;
  },

  rejectSocialQueueItem: async (id: string, note?: string): Promise<SocialQueueItem> => {
    const r = await apiClient.post<SocialQueueItem>(`/api/admin/social/queue/${id}/reject`, { note });
    return r.data;
  },

  requestSocialQueueChanges: async (id: string, note?: string): Promise<SocialQueueItem> => {
    const r = await apiClient.post<SocialQueueItem>(`/api/admin/social/queue/${id}/request-changes`, { note });
    return r.data;
  },

  // Fires the WhatsApp review ping for an existing queue item and reports
  // exactly what happened (sent/channel, or the failure reason) — useful
  // for testing SOCIAL_AGENT_ADMIN_PHONE without drafting a new post.
  notifySocialQueueItem: async (id: string): Promise<SocialNotifyResult> => {
    const r = await apiClient.post<SocialNotifyResult>(`/api/admin/social/queue/${id}/notify`);
    return r.data;
  },

  // Clears an opportunity WITHOUT drafting a post from it (e.g. "not worth posting about").
  dismissDiscountOpportunity: async (productId: string, discountPercent: number): Promise<void> => {
    await apiClient.post(`/api/admin/social/opportunities/discounts/${productId}/dismiss`, {
      discount_percent: discountPercent,
    });
  },

  dismissNewStoreOpportunity: async (storeId: string): Promise<void> => {
    await apiClient.post(`/api/admin/social/opportunities/new-stores/${storeId}/dismiss`);
  },
};

// ── Social content agent types ────────────────────────────────────────
export type SocialContentPillar =
  | "brand" | "entertainment" | "education" | "community" | "culture"
  | "product" | "offer" | "merchant_story";
export type SocialPostType = "post" | "carousel" | "reel";
export type SocialQueueStatus = "pending_review" | "approved" | "rejected" | "changes_requested" | "published";

export interface SocialDiscountOpportunity {
  event: "discount";
  product_id: string;
  product_name?: string;
  store_id?: string;
  price?: number;
  mrp?: number;
  discount_percent: number;
  previous_discount_percent: number;
  image?: string;
}

export interface SocialNewStoreOpportunity {
  event: "new_store";
  store_id: string;
  store_name?: string;
  category?: string;
  locality?: string;
  live_since?: string;
  product_count: number;
}

export interface SocialQueueItemCreate {
  pillar?: SocialContentPillar;
  post_type?: SocialPostType;
  source_event?: string;
  data_source?: string;
  caption?: string;
  creative_brief?: string;
  image_url?: string;
  hashtags?: string[];
  scheduled_time?: string;
  notify?: boolean;
  /** Present when drafted FROM a live opportunity — consumes just that
   *  one opportunity so it stops showing in the list. */
  product_id?: string;
  discount_percent?: number;
  store_id?: string;
}

export interface SocialQueueItem {
  id: string;
  pillar: SocialContentPillar;
  post_type: SocialPostType;
  source_event?: string;
  data_source?: string;
  caption: string;
  creative_brief: string;
  image_url?: string;
  hashtags: string[];
  scheduled_time?: string;
  status: SocialQueueStatus;
  review_note?: string;
  created_at: string;
  reviewed_at?: string;
}

export interface SocialNotifyResult {
  sent: boolean;
  channel?: string;
  reason?: string;
}

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
