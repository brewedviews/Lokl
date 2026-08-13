// Rider delivery-platform types (Phase 1, Commit 4; revised Group A2 for the
// A1 backend redesign). Mirror the shapes returned by backend/server.py's
// rider auth (Commit 2) and rider order (Commit 3, redesigned Group A1)
// endpoints exactly — see those commits for the source of truth.

import type { Id, IsoDateTime, CanonicalPhone } from "./common";

export type RiderStatus = "active" | "suspended";

export interface Rider {
  id: Id;
  phone: CanonicalPhone;
  name: string;
  status: RiderStatus;
  online: boolean;
  // Group B1: riders can hold MULTIPLE active legs now — there's no more
  // single current_order_leg slot on this doc. Active legs are fetched via
  // GET /rider/me/active (see RiderMeActiveResponse below), derived
  // server-side from db.orders, not stored here.
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

/** POST .../out-for-delivery — REPLACES the old picked-up step. Live-testing
 *  fix: no longer requires the handoff OTP in the body — it's a shared
 *  visual reference (shown on both the rider's and merchant's screens) the
 *  rider reads aloud, not something the rider re-enters (they'd just be
 *  copying a value already on their own screen, which validates nothing). */
export interface RiderOutForDeliveryPayload { merchant_handoff_otp?: string }
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

// ============================================================================
// Multi-order + pickup batching (Group B1 backend, 386b588; this file is the
// Group B2 frontend contract for it). A rider can hold several active legs
// at once — GET /rider/me/active now returns ALL of them, grouped into
// SUGGESTED batches by pickup proximity (haversine, 2km). The batching is a
// pure ordering/presentation overlay: no field here ever gates what action
// is available on a leg — that's still governed entirely by `status` +
// `rider_assignment`, exactly as before. A rider can act on any owned leg
// regardless of its batch position.
// ============================================================================

export interface RiderMeActiveLeg {
  order_id: string;
  merchant_id: string;
  /** "pending" | "accepted" | "handed_off" (never "delivered"/"cancelled" —
   *  those legs simply stop appearing here). */
  status: string;
  store_name: string;
  pickup_area: string;
  drop_area: string;
  pickup: { lat: number; lng: number };
  drop: { lat: number; lng: number };
  rider_assignment: RiderLegAssignment;
  /** Which batch (by pickup proximity) this leg belongs to — join
   *  active_legs with `batches` on this, or just group active_legs
   *  directly by this field (both give the same grouping). */
  batch_id: number;
  /** How many legs share this batch — 1 means "standalone", no grouping
   *  chrome needed. */
  batch_size: number;
  /** 1-indexed position in the batch's suggested pickup sequence
   *  (nearest-neighbor over pickup points). */
  suggested_pickup_order: number;
  /** 1-indexed position in the batch's suggested delivery sequence
   *  (nearest-neighbor continuing from the last pickup point). */
  suggested_delivery_order: number;
  /** Human-readable suggestion for THIS leg's next step, e.g.
   *  "Pickup 1 of 3" or "Deliver 2 of 3" (batch_size 1 -> just "Pickup" /
   *  "Deliver"). Derived from status + the order fields above — SUGGESTION
   *  ONLY, never enforced by any endpoint. */
  suggested_label: string;
}

export interface RiderBatchSummary {
  batch_id: number;
  size: number;
  legs: { order_id: string; merchant_id: string }[];
}

export interface RiderMeActiveResponse {
  active_legs: RiderMeActiveLeg[];
  batches: RiderBatchSummary[];
}

// ============================================================================
// Web push (Group D2 frontend for D1 backend, 8e8d507). Standard W3C
// PushSubscription shape — sent to the backend exactly as the browser
// produces it via pushManager.subscribe().toJSON().
// ============================================================================

export interface RiderPushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
