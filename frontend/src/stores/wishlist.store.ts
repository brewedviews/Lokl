/**
 * Wishlist store. PORTED from `lib/wishlist.js`:
 *   • localStorage key:  `bf_wishlist_${phone || "guest"}`  — PER-PHONE
 *   • cross-tab event:   `wishlist:change`  (CustomEvent w/ {phone, list})
 *
 * Divergence from the Session B prompt (which asked for `productIds: string[]`):
 * the legacy app persists full ProductCard snapshots so the /wishlist page
 * renders offline / without per-item refetches. We preserve that approach
 * AND expose `productIds` as a computed selector — same surface area as
 * the spec, plus offline-friendly hydration.
 *
 * Wishlist switches buckets whenever the customer signs in/out:
 *   • Guest:    bf_wishlist_guest
 *   • Auth'd:   bf_wishlist_919876543210
 *
 * `setPhone()` triggers a reload from the new bucket so the UI swaps
 * seamlessly during the OTP login flow.
 */
import { create } from "zustand";
import type { ProductCard } from "@/types";

export const WISHLIST_EVENT = "wishlist:change";

interface WishlistDetail {
  phone: string;
  list: ProductCard[];
}

interface WishlistState {
  /** Current bucket — "guest" pre-login, the canonical phone post-login. */
  phone: string;
  products: ProductCard[];
}

interface WishlistActions {
  /** Switch the active wishlist bucket (call this on auth state change). */
  setPhone: (phone: string | null) => void;
  /** Add or remove. Returns the resulting list. */
  toggle: (product: ProductCard) => ProductCard[];
  isWishlisted: (productId: string) => boolean;
  /** Compatibility shim for callers that only know the id (not full card). */
  productIds: () => string[];
  clear: () => void;
  /** Re-read the current bucket from localStorage. */
  _hydrate: () => void;
}

type WishlistStore = WishlistState & WishlistActions;

function bucketKey(phone: string): string {
  return `bf_wishlist_${phone || "guest"}`;
}

function readBucket(phone: string): ProductCard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(bucketKey(phone));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ProductCard[]) : [];
  } catch {
    return [];
  }
}

function writeBucket(phone: string, list: ProductCard[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(bucketKey(phone), JSON.stringify(list));
    const detail: WishlistDetail = { phone, list };
    window.dispatchEvent(new CustomEvent(WISHLIST_EVENT, { detail }));
  } catch {
    // Quota — wishlist becomes session-only. Not worth surfacing.
  }
}

export const useWishlistStore = create<WishlistStore>((set, get) => ({
  phone: "guest",
  products: typeof window === "undefined" ? [] : readBucket("guest"),

  setPhone: (rawPhone) => {
    const phone = rawPhone ?? "guest";
    set({ phone, products: readBucket(phone) });
  },

  toggle: (product) => {
    const { phone, products } = get();
    const exists = products.some((p) => p.id === product.id);
    const next = exists
      ? products.filter((p) => p.id !== product.id)
      : [product, ...products];
    set({ products: next });
    writeBucket(phone, next);
    return next;
  },

  isWishlisted: (productId) =>
    get().products.some((p) => p.id === productId),

  productIds: () => get().products.map((p) => p.id),

  clear: () => {
    const { phone } = get();
    set({ products: [] });
    writeBucket(phone, []);
  },

  _hydrate: () => set({ products: readBucket(get().phone) }),
}));

// Cross-tab sync — listen for the legacy `wishlist:change` event AND the
// browser `storage` event so a toggle in one tab/app updates the other.
if (typeof window !== "undefined") {
  window.addEventListener(WISHLIST_EVENT, (e) => {
    const detail = (e as CustomEvent<WishlistDetail>).detail;
    if (!detail) return;
    const current = useWishlistStore.getState();
    if (detail.phone === current.phone) {
      useWishlistStore.setState({ products: detail.list });
    }
  });
  window.addEventListener("storage", (e) => {
    const { phone } = useWishlistStore.getState();
    if (e.key === bucketKey(phone)) {
      useWishlistStore.getState()._hydrate();
    }
  });
}
