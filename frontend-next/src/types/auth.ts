// Auth-flow request/response shapes — typed to match each endpoint's
// FastAPI handler and the existing React app's actual usage.

import type { CanonicalPhone } from "./common";
import type { Merchant, Customer } from "./user";

// ============================================================================
// Merchant
// ============================================================================

export interface MerchantLoginPayload { email: string; password: string }

export interface MerchantRegisterPayload {
  email: string;
  password: string;
  store_name: string;
  owner_name: string;
  phone: string;
  city?: string;
}

export interface MerchantAuthResponse {
  token: string;
  merchant: Merchant;
}

// ============================================================================
// Admin
// ============================================================================

export interface AdminLoginPayload { email: string; password: string }

export interface AdminAuthResponse {
  token: string;
  admin: { email: string; role: "admin" };
}

// ============================================================================
// Customer (OTP, Iter-32)
// ============================================================================

export interface CustomerOtpRequestPayload { phone: string }
export interface CustomerOtpRequestResponse {
  ok: boolean;
  message: string;
  expires_in: number;     // seconds
}

export interface CustomerOtpVerifyPayload { phone: string; otp: string }
export interface CustomerOtpVerifyResponse {
  token: string;
  phone: CanonicalPhone;
  role: "customer";
}

// ============================================================================
// Refresh / logout
// ============================================================================

export interface RefreshResponse { token: string }

// ============================================================================
// Per-role state (used by the client-side auth stores in Session B)
// ============================================================================

export interface CustomerAuthState {
  isAuthenticated: boolean;
  user: Customer | null;
  token: string | null;
  phone: CanonicalPhone | null;
}

export interface MerchantAuthState {
  isAuthenticated: boolean;
  user: Merchant | null;
  token: string | null;
}

export interface AdminAuthState {
  isAuthenticated: boolean;
  token: string | null;
  email: string | null;
}
