/**
 * cn — Tailwind class composition (clsx + tailwind-merge).
 * Plus formatting helpers used across the app.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type { OrderStatus } from "@/types";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** "₹1,499" — en-IN locale, whole rupees by default. */
export function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** "850m away" if <1km, "3.2km away" otherwise. Empty string when null. */
export function formatDistance(km: number | null | undefined): string {
  if (km == null) return "";
  if (km < 1) return `${Math.round(km * 1000)}m away`;
  return `${km.toFixed(1)}km away`;
}

/** Map FSM status → user-facing label. Matches the legacy app's copy. */
const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: "Awaiting Payment",
  pending_merchant: "Awaiting Merchant",
  accepted:         "Accepted",
  handed_off:       "Handed to Rider",
  on_the_way:       "On the Way",
  delivered:        "Delivered",
  cancelled:        "Cancelled",
  rejected:         "Rejected",
  returning:        "Returning",
  returned:         "Returned",
};

export function formatOrderStatus(status: OrderStatus | string): string {
  return ORDER_STATUS_LABELS[status as OrderStatus] ?? status;
}

/** "2 hours ago" / "3 days ago" — no external lib. Past dates only. */
export function formatRelativeTime(isoDate: string): string {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, (Date.now() - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (diff < 86_400) {
    const h = Math.floor(diff / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (diff < 30 * 86_400) {
    const d = Math.floor(diff / 86_400);
    return `${d} day${d === 1 ? "" : "s"} ago`;
  }
  if (diff < 365 * 86_400) {
    const mo = Math.floor(diff / (30 * 86_400));
    return `${mo} month${mo === 1 ? "" : "s"} ago`;
  }
  const y = Math.floor(diff / (365 * 86_400));
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

export function truncate(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text ?? "";
  return text.slice(0, Math.max(0, maxLength - 1)).trimEnd() + "…";
}

/** Accept either 10 digits (raw mobile) OR 12 digits starting with "91". */
export function isValidIndianPhone(phone: string): boolean {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return /^[6-9]\d{9}$/.test(digits);
  if (digits.length === 12) return /^91[6-9]\d{9}$/.test(digits);
  return false;
}
