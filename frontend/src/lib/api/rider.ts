/**
 * Rider delivery-platform endpoints (Phase 1, Commits 2 + 3). Auth calls hit
 * /api/auth/rider/*; everything else hits /api/rider/* — api-client.ts
 * classifies both under the "rider" scope and attaches the rider bearer
 * token automatically.
 */
import { apiClient } from "@/lib/api-client";
import type {
  RiderOtpRequestPayload,
  RiderOtpRequestResponse,
  RiderOtpVerifyPayload,
  RiderOtpVerifyResponse,
  RiderStatusUpdatePayload,
  RiderStatusUpdateResponse,
  RiderAvailableOrdersResponse,
  RiderAcceptResponse,
  RiderReachedStoreResponse,
  RiderPickedUpResponse,
  RiderDeliverPayload,
  RiderDeliverResponse,
  RiderOrderLegDetail,
  RiderMeActiveResponse,
} from "@/types";

export const riderApi = {
  // ---------------- Auth (Commit 2) ----------------
  requestOtp: async (payload: RiderOtpRequestPayload): Promise<RiderOtpRequestResponse> => {
    const r = await apiClient.post<RiderOtpRequestResponse>("/api/auth/rider/request-otp", payload);
    return r.data;
  },

  verifyOtp: async (payload: RiderOtpVerifyPayload): Promise<RiderOtpVerifyResponse> => {
    const r = await apiClient.post<RiderOtpVerifyResponse>("/api/auth/rider/verify-otp", payload);
    return r.data;
  },

  setStatus: async (payload: RiderStatusUpdatePayload): Promise<RiderStatusUpdateResponse> => {
    const r = await apiClient.patch<RiderStatusUpdateResponse>("/api/rider/status", payload);
    return r.data;
  },

  // ---------------- Order endpoints (Commit 3) ----------------
  available: async (): Promise<RiderAvailableOrdersResponse> => {
    const r = await apiClient.get<RiderAvailableOrdersResponse>("/api/rider/orders/available");
    return r.data;
  },

  accept: async (oid: string, mid: string): Promise<RiderAcceptResponse> => {
    const r = await apiClient.post<RiderAcceptResponse>(`/api/rider/orders/${oid}/${mid}/accept`, {});
    return r.data;
  },

  reachedStore: async (oid: string, mid: string): Promise<RiderReachedStoreResponse> => {
    const r = await apiClient.post<RiderReachedStoreResponse>(`/api/rider/orders/${oid}/${mid}/reached-store`, {});
    return r.data;
  },

  pickedUp: async (oid: string, mid: string): Promise<RiderPickedUpResponse> => {
    const r = await apiClient.post<RiderPickedUpResponse>(`/api/rider/orders/${oid}/${mid}/picked-up`, {});
    return r.data;
  },

  deliver: async (oid: string, mid: string, payload: RiderDeliverPayload): Promise<RiderDeliverResponse> => {
    const r = await apiClient.post<RiderDeliverResponse>(`/api/rider/orders/${oid}/${mid}/deliver`, payload);
    return r.data;
  },

  orderDetail: async (oid: string): Promise<RiderOrderLegDetail> => {
    const r = await apiClient.get<RiderOrderLegDetail>(`/api/rider/orders/${oid}`);
    return r.data;
  },

  meActive: async (): Promise<RiderMeActiveResponse> => {
    const r = await apiClient.get<RiderMeActiveResponse>("/api/rider/me/active");
    return r.data;
  },
};
