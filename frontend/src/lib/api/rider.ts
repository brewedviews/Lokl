/**
 * Rider delivery-platform endpoints (Phase 1, Commits 2 + 3; revised Group A2
 * for the A1 backend redesign — simultaneous dispatch + two-OTP model). Auth
 * calls hit /api/auth/rider/*; everything else hits /api/rider/* —
 * api-client.ts classifies both under the "rider" scope and attaches the
 * rider bearer token automatically.
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
  RiderOutForDeliveryPayload,
  RiderOutForDeliveryResponse,
  RiderPaymentCompletedPayload,
  RiderPaymentCompletedResponse,
  RiderDeliverPayload,
  RiderDeliverResponse,
  RiderOrderLegDetail,
  RiderMeActiveResponse,
  RiderPushSubscriptionPayload,
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

  // ---------------- Order endpoints (Commit 3, redesigned Group A1) ----------------
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

  /** REPLACES the old pickedUp() — now requires the merchant-handoff OTP,
   *  validated server-side. */
  outForDelivery: async (oid: string, mid: string, payload: RiderOutForDeliveryPayload): Promise<RiderOutForDeliveryResponse> => {
    const r = await apiClient.post<RiderOutForDeliveryResponse>(`/api/rider/orders/${oid}/${mid}/out-for-delivery`, payload);
    return r.data;
  },

  /** Hard-gates deliver() below; pings the merchant's in-app notifications. */
  paymentCompleted: async (oid: string, mid: string, payload: RiderPaymentCompletedPayload = {}): Promise<RiderPaymentCompletedResponse> => {
    const r = await apiClient.post<RiderPaymentCompletedResponse>(`/api/rider/orders/${oid}/${mid}/payment-completed`, payload);
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

  // ---------------- Web push (Group D2) ----------------
  /** Body is the browser's PushSubscription, as-is (endpoint + keys) —
   *  matches backend/server.py's PushSubscriptionPayload exactly. */
  pushSubscribe: async (payload: RiderPushSubscriptionPayload): Promise<{ ok: boolean }> => {
    const r = await apiClient.post<{ ok: boolean }>("/api/rider/push/subscribe", payload);
    return r.data;
  },

  pushUnsubscribe: async (endpoint: string): Promise<{ ok: boolean }> => {
    const r = await apiClient.post<{ ok: boolean }>("/api/rider/push/unsubscribe", { endpoint });
    return r.data;
  },
};
