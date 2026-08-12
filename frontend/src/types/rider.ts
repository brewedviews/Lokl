// Rider delivery-platform types (Phase 1, Commit 4). Mirror the shapes
// returned by backend/server.py's rider auth (Commit 2) and rider order
// (Commit 3) endpoints exactly — see those commits for the source of truth.

import type { Id, IsoDateTime, CanonicalPhone } from "./common";

export type RiderStatus = "active" | "suspended";

export interface RiderCurrentLeg {
  order_id: string;
  merchant_id: string;
}

export interface Rider {
  id: Id;
  phone: CanonicalPhone;
  name: string;
  status: RiderStatus;
  online: boolean;
  current_order_leg: RiderCurrentLeg | null;
  zone?: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  last_seen_at?: IsoDateTime | null;
}

// ============================================================================
// Auth (Commit 2)
// ============================================================================

export interface RiderOtpRequestPayload { phone: string }
export interface RiderOtpRequestResponse {
  ok: boolean;
  message: string;
  expires_in: number; // seconds
}

export interface RiderOtpVerifyPayload { phone: string; otp: string }
export interface RiderOtpVerifyResponse {
  token: string;
  phone: CanonicalPhone;
  role: "rider";
  rider: Rider;
}

export interface RiderStatusUpdatePayload { online: boolean }
export interface RiderStatusUpdateResponse { ok: boolean; online: boolean }

// ============================================================================
// Order endpoints (Commit 3)
// ============================================================================

export interface RiderAvailableLeg {
  order_id: string;
  merchant_id: string;
  store_name: string;
  pickup_area: string;
  drop_area: string;
  drop_pincode: string;
  item_count: number;
  placed_at: IsoDateTime;
}

export interface RiderAvailableOrdersResponse {
  online: boolean;
  legs: RiderAvailableLeg[];
}

export interface RiderLegAssignment {
  rider_id: string;
  accepted_at: IsoDateTime;
  reached_store_at?: IsoDateTime | null;
  picked_up_at?: IsoDateTime | null;
  delivered_at?: IsoDateTime | null;
  cash_collected?: boolean;
  cash_collected_at?: IsoDateTime | null;
}

export interface RiderAcceptResponse {
  ok: boolean;
  order_id: string;
  merchant_id: string;
  rider_assignment: RiderLegAssignment;
}

export interface RiderReachedStoreResponse { ok: boolean; reached_store_at: IsoDateTime }
export interface RiderPickedUpResponse { ok: boolean; all_handed: boolean; my_state: string }

export interface RiderDeliverPayload { otp: string; cash_collected?: boolean }
export interface RiderDeliverResponse { ok: boolean; status: string }

export interface RiderOrderItem {
  id: Id;
  merchant_id: string;
  name: string;
  qty: number;
  price: number;
  size?: string;
  store_name?: string;
}

/** Per-leg detail — deliberately NOT the full `Order` shape; the backend
 *  scopes this to exactly one owned merchant leg (see rider_order_detail). */
export interface RiderOrderLegDetail {
  order_id: string;
  merchant_id: string;
  status: string; // this leg's merchant_states value: accepted | handed_off | delivered
  pickup: { store_name: string; address: string; lat: number; lng: number };
  drop: { customer_name: string; customer_phone: string; address: string; lat: number; lng: number };
  items: RiderOrderItem[];
  otp: string;
  otp_note: string;
  payment: { method: string; upi_qr_url: string; note: string };
  rider_assignment: RiderLegAssignment;
}

export interface RiderActiveLeg {
  order_id: string;
  merchant_id: string;
  status: string | null;
  rider_assignment: RiderLegAssignment | null;
}

export interface RiderMeActiveResponse { active: RiderActiveLeg | null }
