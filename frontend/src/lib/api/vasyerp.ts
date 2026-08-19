/**
 * VasyERP integration endpoints (Phase A — connect, one-way pull, draft
 * staging, review/publish). All merchant-authenticated, under
 * /api/merchant/integrations/vasyerp/*, so MERCHANT_ROUTE_PATTERNS'
 * existing `/^\/api\/merchant\//` entry already attaches the right token —
 * no api-client.ts change needed.
 */
import { apiClient } from "@/lib/api-client";

export interface VasyERPBranch {
  id: string;
  name: string;
}

export interface VasyERPIntegrationStatus {
  merchant_id?: string;
  provider?: string;
  branch_id?: string | null;
  branch_name?: string;
  connected_at?: string | null;
  last_synced_at?: string | null;
  sync_status?: string;
  connected?: boolean;
}

export type StagedImportStatus = "pending_review" | "pending_photos" | "ready" | "published" | "skipped";

export interface StagedImport {
  id: string;
  merchant_id: string;
  provider: string;
  store_id: string;
  vasyerp_item_id: string;
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

export const vasyerpApi = {
  connect: async (apiToken: string): Promise<{ branches: VasyERPBranch[] }> => {
    const r = await apiClient.post<{ branches: VasyERPBranch[] }>(
      "/api/merchant/integrations/vasyerp/connect", { api_token: apiToken },
    );
    return r.data;
  },

  selectBranch: async (branchId: string, branchName?: string): Promise<{ ok: boolean }> => {
    const r = await apiClient.post<{ ok: boolean }>(
      "/api/merchant/integrations/vasyerp/select-branch", { branch_id: branchId, branch_name: branchName || "" },
    );
    return r.data;
  },

  status: async (): Promise<VasyERPIntegrationStatus> => {
    const r = await apiClient.get<VasyERPIntegrationStatus>("/api/merchant/integrations/vasyerp/status");
    return r.data;
  },

  runImport: async (): Promise<{ staged: number; pending_review: number }> => {
    const r = await apiClient.post<{ staged: number; pending_review: number }>(
      "/api/merchant/integrations/vasyerp/import", {},
    );
    return r.data;
  },

  listStaged: async (status?: StagedImportStatus): Promise<StagedImport[]> => {
    const r = await apiClient.get<StagedImport[]>("/api/merchant/integrations/vasyerp/staged", {
      params: status ? { status } : undefined,
    });
    return r.data;
  },

  updateStaged: async (id: string, patch: Partial<Pick<StagedImport, "l1_id" | "l2_id" | "brand_id" | "image" | "image_public_id">>): Promise<StagedImport> => {
    const r = await apiClient.put<StagedImport>(`/api/merchant/integrations/vasyerp/staged/${id}`, patch);
    return r.data;
  },

  publish: async (id: string): Promise<unknown> => {
    const r = await apiClient.post(`/api/merchant/integrations/vasyerp/staged/${id}/publish`, {});
    return r.data;
  },

  publishBulk: async (ids: string[]): Promise<{ results: PublishResult[]; published: number }> => {
    const r = await apiClient.post<{ results: PublishResult[]; published: number }>(
      "/api/merchant/integrations/vasyerp/staged/publish-bulk", { ids },
    );
    return r.data;
  },
};
