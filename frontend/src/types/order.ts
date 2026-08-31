// Order, Return, and Complaint types — mirror real Mongo collections.
// Audited keyset for orders:
//   address, cancel_reason, created_at, customer, id, is_deleted,
//   is_multi_store, items, merchant_ids, merchant_states, otp,
//   payment_method, status, timeline, total
// Razorpay-related fields are NOT yet on the order doc — the live app only
// supports COD/UPI/wallet payment methods. Added as `null`-default optional
// keys so the type is ready for the future razorpay integration without
// the FE having to chase optional chains today.

import type { Id, IsoDateTime, RupeeAmount, CanonicalPhone } from "./common";
import type { CustomerAddress } from "./user";

// ============================================================================
// Status enums (must match server.py FSM exactly)
// ============================================================================

/** Order lifecycle. New states added over time — keep widened via union. */
export type OrderStatus =
  | "awaiting_payment"
  | "pending_merchant"
  | "accepted"
  | "handed_off"
  | "on_the_way"
  | "delivered"
  | "cancelled"
  | "rejected"
  | "returning"
  | "returned"
  | "reserved"
  | "pending_pickup";

export type PaymentMethod = "COD" | "UPI" | "WALLET" | "RAZORPAY";

/** Real transitions only — matches every assignment site in create_order /
 *  the Razorpay webhook handlers (server.py). COD orders are stamped
 *  "cod_pending" at creation and never transition to "paid" (no
 *  cash-collected-on-delivery reconciliation exists in the backend today). */
export type PaymentStatus =
  | "paid" | "cod_pending" | "failed" | "refund_pending" | "refunded";

// ============================================================================
// Items, customer snapshot, and addresses on the order
// ============================================================================

/** Cart line at the moment of order placement. Snapshotted into the order
 *  doc so future price/name changes on the product don't mutate history. */
export interface OrderItem {
  id: Id;             // product id
  key?: string;       // dedupe key on cart (e.g. "<pid>-<size>")
  name: string;
  price: RupeeAmount;
  /** Carried through from the cart line (see CartItem) — the backend
   *  snapshots `dict(it)` verbatim into items_snap, so whatever the cart
   *  line had (including mrp) survives onto the order doc unchanged. */
  mrp?: RupeeAmount | null;
  qty: number;
  size?: string;
  image?: string;
  /** Carried through verbatim from the cart line (see CartItem) — the
   *  color the customer actually bought, snapshotted at order time. */
  color_variant_id?: string;
  color_name?: string;
  store_id?: Id;
  store_name?: string;
  return_eligible?: boolean;
  /** Snapshotted server-side at order time — see create_order in server.py.
   *  Not declared here before G13, though the backend already snapshotted
   *  it (a pre-existing type/reality drift, fixed while adding the two
   *  fields below). */
  return_window_hours?: number | null;
  /** G13 §1 — real product flag, snapshotted at order time (server-verified,
   *  never trusted from the client alone). */
  try_at_doorstep?: boolean;
  /** G13 §1 — customer's captured fulfillment intent for this line. Only
   *  ever "try_and_buy" when `try_at_doorstep` is true. Intent-capture
   *  only — no operational logic reads this yet. */
  fulfillment_type?: "standard" | "try_and_buy";
}

/** Embedded customer snapshot saved on the order. */
export interface OrderCustomer {
  name: string;
  phone: CanonicalPhone;
  age?: number;
}

/** Free-form address used on the order. Matches what the Cart pushes — not
 *  the same shape as CustomerAddress (no `id`, label optional). */
export interface OrderAddress {
  name: string;
  phone: string;
  line1: string;
  landmark?: string;
  city: string;
  pincode: string;
  label?: string;
  /** Group C1/C2 — the delivery pin dropped for this address, if any. Never
   *  the shopper's device GPS (see order.customer_lat/customer_lng, a
   *  separate field entirely). */
  lat?: number | null;
  lng?: number | null;
}

/** Timeline entry — a single FSM transition recorded for audit/UI replay. */
export interface OrderTimelineEntry {
  at: IsoDateTime;
  status: OrderStatus | string;
  by: "system" | "customer" | "merchant" | "admin" | "rider" | "twilio";
  note?: string;
}

/** Per-merchant state in a multi-store order. Single-store orders have
 *  exactly one entry keyed by the merchant id. */
export interface OrderMerchantState {
  status: OrderStatus;
  accepted_at?: IsoDateTime;
  rejected_at?: IsoDateTime;
  handed_off_at?: IsoDateTime;
  delivered_at?: IsoDateTime;
  otp?: string;             // delivery OTP (only present after merchant accept)
  rejection_reason?: string;
}

// ============================================================================
// Order
// ============================================================================

export interface Order {
  id: Id;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status?: PaymentStatus;

  items: OrderItem[];
  total: RupeeAmount;
  /** Server-authoritative delivery fee already folded into `total` — never
   *  charged on pickup orders. See backend/server.py's create_order. */
  delivery_fee?: RupeeAmount;
  /** Persisted on every order doc (create_order) — null/absent when no
   *  coupon was applied. */
  coupon_code?: string | null;
  coupon_discount?: RupeeAmount;

  customer: OrderCustomer;
  address: OrderAddress | CustomerAddress;

  is_multi_store: boolean;
  merchant_ids: Id[];
  merchant_states: Record<Id, OrderMerchantState>;

  /** The customer<->rider DELIVERY code. Rider-flow redesign (Group A1):
   *  the backend only reveals this once the relevant leg is "handed_off"/
   *  delivered — empty/absent before that, NOT at merchant-accept. */
  otp?: string;
  /** Assigned rider's contact, keyed by merchant_id — stamped once that leg
   *  goes "out for delivery" (naturally absent before, so no separate
   *  gating needed on the read side). Single-store orders: one entry. */
  rider_contact?: Record<Id, { name: string; phone: string }>;
  cancel_reason?: string;
  timeline: OrderTimelineEntry[];

  // Iter-23+ — present on delivered orders to drive the 24h return window
  delivered_at?: IsoDateTime;
  delivered_via?: string;
  return_eligible?: boolean;

  // Reserved for the upcoming Razorpay integration (Iter-30+). Today: null.
  razorpay_order_id?: string | null;
  /** Echoed back from POST /api/orders when payment_method=razorpay so the
   * browser can open the Checkout modal without round-tripping more values. */
  razorpay_key_id?: string;
  amount_paise?: number;
  amount_inr?: number;
  razorpay_payment_id?: string | null;

  created_at: IsoDateTime;

  // Pickup order fields
  order_type?: "delivery" | "pickup";
  pickup_code?: string;
  pickup_expires_at?: IsoDateTime;
  store_name?: string;
  store_address?: string;
  maps_link?: string;
}

// ============================================================================
// Return + Complaint
// ============================================================================

export type ReturnStatus =
  | "requested"
  | "pickup_assigned"
  | "rider_arrived"
  | "picked_up"
  | "received"
  | "refunded"
  | "rejected";

export interface ReturnItem {
  id: Id;        // product id of the returned line
  name: string;
  qty: number;
  price: RupeeAmount;
  size?: string;
  /** Carried through from the original order line (see OrderItem). */
  color_name?: string;
  image?: string;
}

export interface Return {
  id: Id;
  order_id: Id;
  customer_phone: CanonicalPhone;
  reason: string;
  status: ReturnStatus;
  items: ReturnItem[];
  merchant_ids: Id[];
  otp?: string;       // reverse-pickup OTP
  timeline: OrderTimelineEntry[];
  created_at: IsoDateTime;
}

export type ComplaintType =
  | "general"
  | "damaged_item"
  | "wrong_item"
  | "missing_item"
  | "late_delivery"
  | "other";

export type ComplaintStatus = "open" | "in_progress" | "resolved" | "rejected";

export interface Complaint {
  id: Id;
  order_id: Id;
  customer_phone: CanonicalPhone;
  type: ComplaintType;
  message: string;
  status: ComplaintStatus;
  merchant_ids: Id[];
  resolution_note: string | null;
  resolved_at: IsoDateTime | null;
  created_at: IsoDateTime;
}
