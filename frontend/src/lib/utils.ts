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

/**
 * Store availability SOP (one consistent customer-facing model) — the
 * single place every "is this store open" store-CARD label is composed,
 * so StoresNearYouSection/L1PageClient/StoreSectionModule/Store page
 * can't drift into showing different text for the same underlying
 * `badge` the backend's `_store_availability()` already computed. Reads
 * only `badge` (present on every store-listing endpoint response) plus
 * the real `next_open_label` the backend formats for the Closed case —
 * never a client-side reimplementation of the hours/weekly-off math.
 *
 * Store availability controls ORDERABILITY, not product discovery: this
 * only decides card TEXT. It never gates Add to Bag (ProductCard/PdpCtaRow
 * gate on the badge string directly, independently) or checkout (the
 * backend's `can_order` + checkout's own `isOrderableNow` do that).
 */
export function storeStatusLabel(
  badge: string | null | undefined,
  nextOpenLabel?: string | null,
): { openNow: boolean; label: string } {
  switch (badge) {
    case "LIVE":
      return { openNow: true, label: "Open now" };
    case "Away":
      return { openNow: false, label: "Back soon" };
    case "Store Offline":
      return { openNow: false, label: "Temporarily unavailable" };
    case "Closed":
      return { openNow: false, label: nextOpenLabel ? `Closed · ${nextOpenLabel}` : "Closed" };
    default:
      // Unknown/missing badge — never assume open with no data to back it.
      return { openNow: false, label: "Closed" };
  }
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
  reserved:         "Reserved for Pickup",
  pending_pickup:   "Awaiting store confirmation",
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

/**
 * Injects a size/quality/format transform into a Cloudinary delivery URL
 * (e.g. `.../upload/w_300,q_auto,f_auto/...`) so images don't ship as a
 * full-resolution original. No-op for any other host — we don't control
 * those images' transform syntax, so we never risk corrupting them.
 * Moved here from HomeClient.tsx (its original, only caller) once
 * SellerCard needed it too — a plain string-transform helper like this
 * has no reason to live inside one specific page's component file.
 */
export function cloudinaryOptimize(url: string | undefined | null, transform = "w_300,q_auto,f_auto"): string {
  if (!url) return "";
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  return url.replace("/upload/", `/upload/${transform}/`);
}
