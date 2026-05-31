/**
 * Merchant-side endpoints. Every call here requires the merchant JWT
 * (auto-attached by the api-client based on URL prefix). Most routes also
 * enforce per-merchant ownership server-side — the FE doesn't need to
 * forward the merchant id.
 *
 * The CSV/XLSX download endpoints are NOT in this module:
 *   - GET /api/merchant/analytics/report.csv
 *   - GET /api/merchant/products/template.xlsx
 * Those stay on raw fetch (see api-client.ts header notes) and will be
 * wrapped by `lib/downloads.ts` in Session B.
 */
import { apiClient } from "@/lib/api-client";
import type {
  Merchant, MerchantStorefront, MerchantNotification, KycStatus,
  Order, Return, Complaint, Product,
} from "@/types";

// ============================================================================
// Onboarding / KYC / routing
// ============================================================================

export interface NextRouteResponse { path: string; reason?: string }

export interface KycStatusResponse {
  status: KycStatus;
  reason?: string;
  submitted_at?: string;
  approved_at?: string;
  pan_number?: string;
  business_name?: string;
}

export interface KycSubmitPayload {
  pan_number: string;
  gst_number?: string;
  business_name: string;
  business_category: string;
  business_type: string;
  business_address: string;
  bank_account_number: string;
  bank_ifsc: string;
  account_holder_name: string;
  pan_doc_b64?: string;
  gst_doc_b64?: string;
  cancelled_cheque_b64?: string;
}

export interface ChangeRequestPayload {
  change_type: "bank" | "address";
  new_values: Record<string, string>;
  supporting_doc_b64: string;
  reason?: string;
}

export interface DashboardStats {
  orders_today: number;
  revenue_today: number;
  pending_count: number;
  delivered_count: number;
  rejected_count: number;
  product_count: number;
  storefront_views?: number;
}

export interface AnalyticsResponse {
  period: string;
  series: Array<{ date: string; orders: number; revenue: number }>;
  totals: { orders: number; revenue: number; avg_value: number };
  top_products: Array<{ id: string; name: string; qty: number; revenue: number }>;
}

export interface ReturnsAnalyticsResponse {
  total: number;
  by_status: Record<string, number>;
  refund_total: number;
}

// ============================================================================
// API
// ============================================================================

export const merchantApi = {
  nextRoute: async (): Promise<NextRouteResponse> => {
    const r = await apiClient.get<NextRouteResponse>("/api/merchant/next-route");
    return r.data;
  },

  // ---------------- KYC ----------------
  kycStatus: async (): Promise<KycStatusResponse> => {
    const r = await apiClient.get<KycStatusResponse>("/api/merchant/kyc/status");
    return r.data;
  },

  kycSubmit: async (payload: KycSubmitPayload): Promise<{ ok: boolean }> => {
    const r = await apiClient.post<{ ok: boolean }>("/api/merchant/kyc/submit", payload);
    return r.data;
  },

  kycResubmit: async (): Promise<{ ok: boolean }> => {
    const r = await apiClient.post<{ ok: boolean }>("/api/merchant/kyc/resubmit", {});
    return r.data;
  },

  // ---------------- Notifications ----------------
  notifications: async (): Promise<MerchantNotification[]> => {
    const r = await apiClient.get<MerchantNotification[]>("/api/merchant/notifications");
    return r.data;
  },

  // ---------------- Dashboard / analytics ----------------
  dashboard: async (): Promise<DashboardStats> => {
    const r = await apiClient.get<DashboardStats>("/api/merchant/dashboard");
    return r.data;
  },

  analytics: async (period = "7d"): Promise<AnalyticsResponse> => {
    const r = await apiClient.get<AnalyticsResponse>("/api/merchant/analytics", {
      params: { period },
    });
    return r.data;
  },

  returnsAnalytics: async (): Promise<ReturnsAnalyticsResponse> => {
    const r = await apiClient.get<ReturnsAnalyticsResponse>(
      "/api/merchant/analytics/returns",
    );
    return r.data;
  },

  // ---------------- Storefront ----------------
  saveStorefront: async (payload: MerchantStorefront): Promise<Merchant> => {
    const r = await apiClient.post<Merchant>("/api/merchant/storefront", payload);
    return r.data;
  },

  publish: async (): Promise<{ ok: boolean }> => {
    const r = await apiClient.post<{ ok: boolean }>("/api/merchant/publish", {});
    return r.data;
  },

  storeState: async (): Promise<{ online: boolean; published: boolean }> => {
    const r = await apiClient.get<{ online: boolean; published: boolean }>(
      "/api/merchant/store/state",
    );
    return r.data;
  },

  setOnline: async (online: boolean): Promise<{ online: boolean }> => {
    const r = await apiClient.post<{ online: boolean }>(
      "/api/merchant/store/online",
      { online },
    );
    return r.data;
  },

  // ---------------- Products (CRUD + bulk) ----------------
  listProducts: async (): Promise<Product[]> => {
    const r = await apiClient.get<Product[]>("/api/merchant/products");
    return r.data;
  },

  createProduct: async (payload: Partial<Product>): Promise<Product> => {
    const r = await apiClient.post<Product>("/api/merchant/products", payload);
    return r.data;
  },

  updateProduct: async (
    id: string,
    payload: Partial<Product>,
  ): Promise<Product> => {
    const r = await apiClient.put<Product>(`/api/merchant/products/${id}`, payload);
    return r.data;
  },

  /** Bulk-upload products via XLSX multipart. Caller passes a FormData with
   *  the file under key `file`. */
  bulkCreateProducts: async (
    fd: FormData,
  ): Promise<{ created: number; failed: number; errors: string[] }> => {
    const r = await apiClient.post<{ created: number; failed: number; errors: string[] }>(
      "/api/merchant/products/bulk",
      fd,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return r.data;
  },

  bulkAction: async (
    ids: string[],
    action: "publish" | "pause" | "delete",
  ): Promise<{ updated: number }> => {
    const r = await apiClient.post<{ updated: number }>(
      "/api/merchant/products/bulk-action",
      { ids, action },
    );
    return r.data;
  },

  // ---------------- Orders / returns / complaints ----------------
  listOrders: async (): Promise<Order[]> => {
    const r = await apiClient.get<Order[]>("/api/merchant/orders");
    return r.data;
  },

  acceptOrder: async (id: string): Promise<{ otp: string; ok: boolean }> => {
    const r = await apiClient.post<{ otp: string; ok: boolean }>(
      `/api/merchant/orders/${id}/accept`,
      {},
    );
    return r.data;
  },

  handToRider: async (id: string): Promise<{ ok: boolean }> => {
    const r = await apiClient.post<{ ok: boolean }>(
      `/api/merchant/orders/${id}/handed-to-rider`,
      {},
    );
    return r.data;
  },

  listReturns: async (): Promise<Return[]> => {
    const r = await apiClient.get<Return[]>("/api/merchant/returns");
    return r.data;
  },

  listComplaints: async (): Promise<Complaint[]> => {
    const r = await apiClient.get<Complaint[]>("/api/merchant/complaints");
    return r.data;
  },

  // ---------------- Change requests ----------------
  listChangeRequests: async (): Promise<Array<{
    id: string; change_type: string; status: string;
    new_values: Record<string, string>; reason: string; created_at: string;
  }>> => {
    const r = await apiClient.get<Array<{
      id: string; change_type: string; status: string;
      new_values: Record<string, string>; reason: string; created_at: string;
    }>>("/api/merchant/change-requests");
    return r.data;
  },

  createChangeRequest: async (payload: ChangeRequestPayload): Promise<{ id: string }> => {
    const r = await apiClient.post<{ id: string }>(
      "/api/merchant/change-request",
      payload,
    );
    return r.data;
  },

  // ---------------- AI Studio ----------------
  aiCopy: async (payload: {
    product_name: string;
    category?: string;
    notes?: string;
  }): Promise<{ title: string; description: string; tags: string[] }> => {
    const r = await apiClient.post<{ title: string; description: string; tags: string[] }>(
      "/api/merchant/ai/copy",
      payload,
    );
    return r.data;
  },

  /** Bulk enhance — multipart upload of one base image, returns 4 variants. */
  aiEnhanceImage: async (fd: FormData): Promise<{ images: string[] }> => {
    const r = await apiClient.post<{ images: string[] }>(
      "/api/merchant/ai/enhance-image",
      fd,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return r.data;
  },

  aiEnhanceImageOne: async (
    payload: { image: string; kind: "outdoor" | "studio" },
  ): Promise<{ image: string }> => {
    const r = await apiClient.post<{ image: string }>(
      "/api/merchant/ai/enhance-image/one",
      payload,
    );
    return r.data;
  },
};
