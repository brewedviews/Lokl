/**
 * Merchant integrations — multi-provider inventory pull (VasyERP, Shopify).
 * Connect/import endpoints stay provider-specific (each source has its own
 * auth shape and pull mechanics); status/staged-list/correction/publish
 * are genuinely shared across providers, matching the backend's own
 * provider-parameterized pipeline (server.py's _resolve_category/
 * _resolve_brand/_stage_source_item) rather than one API module per
 * provider the way the original VasyERP-only build had.
 *
 * All merchant-authenticated, under /api/merchant/integrations/*, so
 * MERCHANT_ROUTE_PATTERNS' existing `/^\/api\/merchant\//` entry already
 * attaches the right token — no api-client.ts change needed.
 */
import { apiClient } from "@/lib/api-client";

export type Provider = "vasyerp" | "shopify";

export interface VasyERPBranch {
  id: string;
  name: string;
}

export interface IntegrationStatus {
  id?: string;
  merchant_id?: string;
  provider: Provider;
  branch_id?: string | null;
  branch_name?: string;
  shop_domain?: string;
  shop_name?: string;
  connected_at?: string | null;
  last_synced_at?: string | null;
  sync_status?: string;
}

export type StagedImportStatus = "pending_review" | "pending_photos" | "ready" | "published" | "skipped";

export interface StagedImport {
  id: string;
  merchant_id: string;
  provider: Provider;
  store_id: string;
  source_item_id: string;
  name: string;
  price: number | null;
  mrp: number | null;
  qty: number;
  hsn_code: string;
  measurement_unit: string;
  raw_category: string;
  raw_brand: string;
  l1_id: string | null;
  l2_id: string | null;
  brand_id: string | null;
  category_unmatched: boolean;
  brand_unmatched: boolean;
  image: string;
  image_public_id: string;
  stock?: Record<string, number> | null;
  sizes?: string[];
  status: StagedImportStatus;
  product_id?: string;
  created_at: string;
  updated_at?: string;
}

export interface PublishResult {
  id: string;
  ok: boolean;
  reason?: string;
}

export const integrationsApi = {
  // ---- VasyERP (own auth shape: static api-token + branch selection) ----
  connectVasyErp: async (apiToken: string): Promise<{ branches: VasyERPBranch[] }> => {
    const r = await apiClient.post<{ branches: VasyERPBranch[] }>(
      "/api/merchant/integrations/vasyerp/connect", { api_token: apiToken },
    );
    return r.data;
  },

  selectVasyErpBranch: async (branchId: string, branchName?: string): Promise<{ ok: boolean }> => {
    const r = await apiClient.post<{ ok: boolean }>(
      "/api/merchant/integrations/vasyerp/select-branch", { branch_id: branchId, branch_name: branchName || "" },
    );
    return r.data;
  },

  // ---- Shopify (own auth shape: shop domain + access token, no branch step) ----
  connectShopify: async (shopDomain: string, accessToken: string): Promise<{ ok: boolean; shop_name: string }> => {
    const r = await apiClient.post<{ ok: boolean; shop_name: string }>(
      "/api/merchant/integrations/shopify/connect", { shop_domain: shopDomain, access_token: accessToken },
    );
    return r.data;
  },

  // ---- Shared across every provider ----
  status: async (): Promise<IntegrationStatus[]> => {
    const r = await apiClient.get<IntegrationStatus[]>("/api/merchant/integrations/status");
    return r.data;
  },

  runImport: async (provider: Provider): Promise<{ staged: number; pending_review: number }> => {
    const r = await apiClient.post<{ staged: number; pending_review: number }>(
      `/api/merchant/integrations/${provider}/import`, {},
    );
    return r.data;
  },

  listStaged: async (params?: { provider?: Provider; status?: StagedImportStatus }): Promise<StagedImport[]> => {
    const r = await apiClient.get<StagedImport[]>("/api/merchant/integrations/staged", { params });
    return r.data;
  },

  updateStaged: async (id: string, patch: Partial<Pick<StagedImport, "l1_id" | "l2_id" | "brand_id" | "image" | "image_public_id">>): Promise<StagedImport> => {
    const r = await apiClient.put<StagedImport>(`/api/merchant/integrations/staged/${id}`, patch);
    return r.data;
  },

  publish: async (id: string): Promise<unknown> => {
    const r = await apiClient.post(`/api/merchant/integrations/staged/${id}/publish`, {});
    return r.data;
  },

  publishBulk: async (ids: string[]): Promise<{ results: PublishResult[]; published: number }> => {
    const r = await apiClient.post<{ results: PublishResult[]; published: number }>(
      "/api/merchant/integrations/staged/publish-bulk", { ids },
    );
    return r.data;
  },
};
