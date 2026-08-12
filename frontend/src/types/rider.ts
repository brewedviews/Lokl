// Rider delivery-platform types (Phase 1, Commit 4; revised Group A2 for the
// A1 backend redesign). Mirror the shapes returned by backend/server.py's
// rider auth (Commit 2) and rider order (Commit 3, redesigned Group A1)
// endpoints exactly — see those commits for the source of truth.

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
// Order endpoints (Commit 3; redesigned Group A1 — simultaneous dispatch +
// two-OTP model)
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
  /** False = the merchant hasn't accepted this leg yet — still claimable
   *  (simultaneous dispatch) but out-for-delivery will be blocked until
   *  this flips true. */
  merchant_accepted: boolean;
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
  /** Set by POST .../payment-completed — a HARD GATE: /deliver 400s until
   *  this is set. */
  payment_completed_at?: IsoDateTime | null;
  payment_method?: string | null;
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

/** POST .../out-for-delivery — REPLACES the old picked-up step. Requires the
 *  merchant-handoff OTP (shown to the rider, read out to the merchant). */
export interface RiderOutForDeliveryPayload { merchant_handoff_otp: string }
export interface RiderOutForDeliveryResponse { ok: boolean; all_handed: boolean; my_state: string }

/** POST .../payment-completed — hard-gates /deliver; pings the merchant's
 *  in-app notification inbox. Does not change merchant_states/global status. */
export interface RiderPaymentCompletedPayload { payment_method?: string }
export interface RiderPaymentCompletedResponse { ok: boolean; payment_completed_at: IsoDateTime }

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
 *  scopes this to exactly one owned merchant leg (see rider_order_detail).
 *  `status` can now legitimately be "pending" (rider claimed the leg before
 *  the merchant accepted it — simultaneous dispatch) as well as "accepted" |
 *  "handed_off" | "delivered". */
export interface RiderOrderLegDetail {
  order_id: string;
  merchant_id: string;
  status: string;
  pickup: { store_name: string; address: string; lat: number; lng: number };
  drop: { customer_name: string; customer_phone: string; address: string; lat: number; lng: number };
  items: RiderOrderItem[];
  /** The MERCHANT-HANDOFF code — tell this to the store at pickup. Distinct
   *  from `otp` (the customer's delivery-confirmation code) below. */
  handoff_otp: string;
  handoff_otp_note: string;
  /** The customer's DELIVERY OTP — ask the customer for this at drop-off. */
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
