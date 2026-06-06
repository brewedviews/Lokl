/**
 * Auth endpoints — merchant login/register/me/logout/refresh + customer OTP.
 * Admin login lives in `./admin.ts` (admin scope is independent).
 */
import { apiClient } from "@/lib/api-client";
import type {
  Merchant,
  MerchantAuthResponse,
  MerchantLoginPayload,
  MerchantRegisterPayload,
  CustomerOtpRequestPayload,
  CustomerOtpRequestResponse,
  CustomerOtpVerifyPayload,
  CustomerOtpVerifyResponse,
  RefreshResponse,
} from "@/types";

export const authApi = {
  // ---------------- Merchant ----------------
  login: async (payload: MerchantLoginPayload): Promise<MerchantAuthResponse> => {
    const r = await apiClient.post<MerchantAuthResponse>("/api/auth/login", payload);
    return r.data;
  },

  register: async (payload: MerchantRegisterPayload): Promise<MerchantAuthResponse> => {
    const r = await apiClient.post<MerchantAuthResponse>("/api/auth/register", payload);
    return r.data;
  },

  me: async (): Promise<Merchant> => {
    const r = await apiClient.get<Merchant>("/api/auth/me");
    return r.data;
  },

  // ---------------- Refresh / logout (both work for all roles) ----------------
  refresh: async (): Promise<RefreshResponse> => {
    const r = await apiClient.post<RefreshResponse>("/api/auth/refresh", {});
    return r.data;
  },

  logout: async (): Promise<{ ok: boolean }> => {
    const r = await apiClient.post<{ ok: boolean }>("/api/auth/logout", {});
    return r.data;
  },

  // ---------------- Customer OTP (Iter-32) ----------------
  requestCustomerOtp: async (
    payload: CustomerOtpRequestPayload,
  ): Promise<CustomerOtpRequestResponse> => {
    const r = await apiClient.post<CustomerOtpRequestResponse>(
      "/api/auth/customer/request-otp",
      payload,
    );
    return r.data;
  },

  verifyCustomerOtp: async (
    payload: CustomerOtpVerifyPayload,
  ): Promise<CustomerOtpVerifyResponse> => {
    const r = await apiClient.post<CustomerOtpVerifyResponse>(
      "/api/auth/customer/verify-otp",
      payload,
    );
    return r.data;
  },
};
