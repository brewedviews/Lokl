// User & address types — mirror the actual /api/auth/me and /api/customer/{phone}
// response bodies. The audit (Task 1) confirmed real shape on disk.

import type { Id, IsoDateTime, CanonicalPhone } from "./common";

// ============================================================================
// Roles & JWT
// ============================================================================

/** Three roles supported by the FastAPI auth layer. */
export type UserRole = "customer" | "merchant" | "admin";

/** JWT payload mirrored on the frontend (decoded client-side from `bf_*_token`).
 *  `sub` = canonical phone (customers) or merchant id (merchants/admins). */
export interface JwtPayload {
  sub: string;
  role: UserRole;
  type: "access" | "refresh";
  exp: number;
}

// ============================================================================
// Customer
// ============================================================================

/** A persisted delivery address on a customer's account. Backend stores these
 *  inside `customers.addresses[]`; each entry has a generated `id` (NOT
 *  `address_id` — diverges from the user-prompt template). */
export interface CustomerAddress {
  id: string;
  name: string;
  phone: CanonicalPhone | string;
  line1: string;
  landmark: string;
  city: string;
  pincode: string;
  label: "Home" | "Work" | string;
  created_at: IsoDateTime;
}

/** A customer record as returned by GET /api/customer/{phone}.
 *  The backend stores ONLY: phone, name (optional), last_address (optional),
 *  addresses[] (populated as the customer saves them), updated_at, created_at.
 *  Fields that the user-prompt template assumed (`email`, `role`, etc.) are
 *  NOT present and intentionally omitted here. */
export interface Customer {
  phone: CanonicalPhone;
  name: string | null;
  last_address: CustomerAddress | null;
  addresses: CustomerAddress[];
  created_at?: IsoDateTime;
  updated_at?: IsoDateTime;
}

// ============================================================================
// Merchant
// ============================================================================

export type KycStatus =
  | "not_submitted"
  | "submitted"
  | "approved"
  | "rejected"
  | "on_hold";

/** Subset of the merchant doc that the UI actually consumes. Sensitive fields
 *  (`password_hash`, `bank_account_number`, KYC docs) NEVER leave the server. */
export interface Merchant {
  id: Id;
  email: string;
  phone: string;
  role: "merchant" | "admin";
  store_name: string;
  owner_name: string;
  city: string;
  kyc_status: KycStatus;
  kyc_submitted_at?: IsoDateTime;
  approved_at?: IsoDateTime;
  business_address?: string;
  business_category?: string;
  business_type?: string;
  storefront?: MerchantStorefront;
  notifications?: MerchantNotification[];
  paused?: boolean;
  published?: boolean;
  created_at: IsoDateTime;
}

/** Embedded storefront record on a merchant doc (and mirrored to stores). */
export interface MerchantStorefront {
  tagline: string;
  story: string;
  banner: string;
  banners: string[];
  specialties: string[];
  locality: string;
  timing: string;
  opens_at: string;
  closes_at: string;
  lat: number | null;
  lng: number | null;
  online?: boolean;
}

export interface MerchantNotification {
  id: string;
  type: string;
  message: string;
  read: boolean;
  created_at: IsoDateTime;
}
