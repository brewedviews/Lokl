import type { RiderLegAssignment } from "@/types";

/**
 * Shared "what's happening with this leg right now" label — used on both
 * the rider feed's "My active orders" list (Group B2) and the order-detail
 * screen, so the wording stays consistent regardless of where a rider
 * reads it. Pure presentation; has no bearing on which actions are
 * actually available (that's governed server-side by status/assignment
 * fields directly, same as before).
 */
export function riderLegStatusLabel(
  status: string,
  assignment: RiderLegAssignment | null | undefined,
): string {
  const reached = !!assignment?.reached_store_at;
  const paymentDone = !!assignment?.payment_completed_at;
  if (status === "pending" && !reached) return "Heading to store · waiting for store to accept";
  if (status === "pending" && reached) return "At the store · waiting for store to accept";
  if (status === "accepted" && !reached) return "Heading to store";
  if (status === "accepted" && reached) return "At the store · ready for handoff";
  if (status === "handed_off" && !paymentDone) return "Out for delivery · collect payment";
  if (status === "handed_off" && paymentDone) return "Out for delivery · ready to complete";
  if (status === "delivered") return "Delivered";
  return "In progress";
}

/** Compact human-readable order reference — same last-6-uppercase
 *  convention backend/notifications.py already uses for SMS/WhatsApp text
 *  (order_id[-6:].upper()), reused here since the rider active-legs list
 *  has no customer name to display. */
export function shortOrderRef(orderId: string): string {
  return `#${orderId.slice(-6).toUpperCase()}`;
}
