/**
 * Cart store. localStorage key + line-item shape are PORTED VERBATIM from
 * `contexts/CartContext.jsx` so a customer with `bf_cart` data from the
 * legacy app sees their cart on day one of the new app.
 *
 * Legacy line shape:
 *   { key, id, name, price, image, size, store_name, store_eta_min, qty }
 *
 * One store per bag. MAX_STORES_PER_CART (=1) means adding an item from a
 * second distinct store returns `{success:false, conflict}` instead of
 * mixing stores — the call site warns the customer and offers to clear the
 * bag and start fresh with the new store. Backward-compat: legacy lines
 * without `store_id` are grandfathered — the uniqueness check counts only
 * items with a real `store_id`.
 *
 * Persistence shape: zustand/persist wraps state in `{state, version}`. The
 * legacy app reads `localStorage.bf_cart` as a bare JSON array. We solve the
 * impedance mismatch by maintaining a raw mirror at `bf_cart` (writable from
 * either app), and a versioned mirror at `bf_cart:next` for our internal
 * hydration. `_syncFromLegacy` reads the bare array on boot.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CartConflict, CartItem, ProductCard, RupeeAmount } from "@/types";

export const CART_KEY = "bf_cart";
export const MAX_STORES_PER_CART = 1;

// ---------------------------------------------------------------------------
// State + actions
// ---------------------------------------------------------------------------

interface CartState {
  items: CartItem[];
  /** False until zustand-persist has restored `items` from localStorage.
   *  Always false on the very first render (SSR + first client paint), even
   *  when the cart actually has items — consumers MUST gate on this before
   *  treating an empty `items` array as a genuine empty cart, otherwise a
   *  populated cart flashes "empty" for one frame while persist catches up. */
  _hasHydrated: boolean;
}

interface CartActions {
  addItem: (
    product: ProductCard,
    size: string,
    qty?: number,
    colorVariant?: { id: string; name: string; image?: string },
  ) => { success: boolean; conflict?: CartConflict };
  removeItem: (productId: string, size: string, colorVariantId?: string) => void;
  updateQty: (productId: string, size: string, qty: number, colorVariantId?: string) => void;
  /** G13 §1 — set this line's checkout fulfillment choice. Silently no-ops
   *  if the line isn't try_at_doorstep-eligible, so a caller can never
   *  accidentally flip an ineligible item to "try_and_buy". */
  setFulfillmentType: (key: string, type: "standard" | "try_and_buy") => void;
  clearCart: () => void;
  getTotal: () => RupeeAmount;
  getItemCount: () => number;
  getLineTotal: (productId: string, size: string, colorVariantId?: string) => RupeeAmount;
  getStoreIds: () => string[];
  /** Hydrate from the legacy bare-array `bf_cart` shape if present. */
  _syncFromLegacy: () => void;
  _setHasHydrated: (v: boolean) => void;
}

type CartStore = CartState & CartActions;

const INITIAL: CartState = { items: [], _hasHydrated: false };

// Exported so callers that need to read live cart state for a specific
// product+size (e.g. the PDP's Add-to-bag-becomes-a-stepper button) can
// derive the exact same key this store uses internally, instead of
// re-deriving their own "id + size" matching logic that could drift from
// this store's actual key format.
// `colorVariantId` folds into the key so two colors of the same product+
// size never collide into one line — omitted (undefined) for every plain
// product, which keeps the key format BYTE-IDENTICAL to before this field
// existed for every existing call site that doesn't pass it.
export const cartKeyFor = (productId: string, size: string, colorVariantId?: string) =>
  `${productId}-${size || "free"}${colorVariantId ? `-${colorVariantId}` : ""}`;

// Returns the [id, name] pairs of every distinct store currently in the bag.
function distinctStores(items: CartItem[]): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  for (const i of items) {
    if (i.store_id && !seen.has(i.store_id)) {
      seen.set(i.store_id, i.store_name ?? "another store");
    }
  }
  return Array.from(seen, ([id, name]) => ({ id, name }));
}

// ---------------------------------------------------------------------------
// Legacy bare-array writer — keeps `bf_cart` readable by the legacy CRA app
// for the duration of the cutover. Called on every state change below.
// ---------------------------------------------------------------------------
function mirrorToLegacyBareArray(items: CartItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch (e) {
    // Quota exceeded etc. — non-fatal; the Zustand-persist copy still works.
    if (process.env.NODE_ENV !== "production") console.warn("[cart] mirrorToLegacyBareArray failed", e);
  }
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      addItem: (product, size, qty = 1, colorVariant) => {
        const state = get();
        const itemStoreId = product.store_id;
        const stores = distinctStores(state.items);

        // One-store-per-bag rule — only applies when the new line has a real
        // store_id AND it's a store we haven't seen yet in the bag.
        if (
          itemStoreId &&
          !stores.some((s) => s.id === itemStoreId) &&
          stores.length >= MAX_STORES_PER_CART
        ) {
          const first = stores[0] ?? { id: "", name: "another store" };
          return {
            success: false,
            conflict: {
              existing_store_id: first.id,
              existing_store_name: first.name,
              existing_store_names: stores.map((s) => s.name),
              new_store_id: itemStoreId,
              new_store_name: product.store_name ?? "the new store",
              max_stores: MAX_STORES_PER_CART,
            },
          };
        }

        const key = cartKeyFor(product.id, size, colorVariant?.id);
        const existingIdx = state.items.findIndex((i) => i.key === key);
        let nextItems: CartItem[];

        if (existingIdx >= 0) {
          nextItems = state.items.map((i, idx) =>
            idx === existingIdx ? { ...i, qty: i.qty + qty } : i,
          );
        } else {
          const line: CartItem = {
            key,
            id: product.id,
            name: product.name,
            price: product.price,
            mrp: product.mrp ?? undefined,
            qty,
            size: size || undefined,
            image: colorVariant?.image || product.image,
            color_variant_id: colorVariant?.id,
            color_name: colorVariant?.name,
            store_id: itemStoreId,
            store_name: product.store_name,
            return_eligible: product.return_eligible,
            try_at_doorstep: product.try_at_doorstep,
            fulfillment_type: "standard",
          };
          nextItems = [...state.items, line];
        }

        set({ items: nextItems });
        mirrorToLegacyBareArray(nextItems);
        return { success: true };
      },

      removeItem: (productId, size, colorVariantId) => {
        const key = cartKeyFor(productId, size, colorVariantId);
        const nextItems = get().items.filter((i) => i.key !== key);
        set({ items: nextItems });
        mirrorToLegacyBareArray(nextItems);
      },

      updateQty: (productId, size, qty, colorVariantId) => {
        if (qty <= 0) {
          get().removeItem(productId, size, colorVariantId);
          return;
        }
        const key = cartKeyFor(productId, size, colorVariantId);
        const nextItems = get().items.map((i) => (i.key === key ? { ...i, qty } : i));
        set({ items: nextItems });
        mirrorToLegacyBareArray(nextItems);
      },

      setFulfillmentType: (key, type) => {
        const nextItems = get().items.map((i) =>
          i.key === key && (type === "standard" || i.try_at_doorstep) ? { ...i, fulfillment_type: type } : i,
        );
        set({ items: nextItems });
        mirrorToLegacyBareArray(nextItems);
      },

      clearCart: () => {
        set({ ...INITIAL });
        mirrorToLegacyBareArray([]);
      },

      getTotal: () =>
        get().items.reduce((sum, i) => sum + i.price * i.qty, 0),

      getItemCount: () =>
        get().items.reduce((sum, i) => sum + i.qty, 0),

      getLineTotal: (productId, size, colorVariantId) => {
        const key = cartKeyFor(productId, size, colorVariantId);
        const line = get().items.find((i) => i.key === key);
        return line ? line.price * line.qty : 0;
      },

      getStoreIds: () => distinctStores(get().items).map((s) => s.id),

      _syncFromLegacy: () => {
        if (typeof window === "undefined") return;
        try {
          const raw = localStorage.getItem(CART_KEY);
          if (!raw) return;
          const parsed = JSON.parse(raw) as unknown;
          // The legacy app writes a bare ARRAY. Zustand-persist writes an
          // OBJECT. Only adopt the legacy shape — let persist hydrate its own.
          if (Array.isArray(parsed)) {
            set({ items: parsed as CartItem[] });
          }
        } catch (e) {
          // Malformed legacy cart — leave the store untouched.
          if (process.env.NODE_ENV !== "production") console.warn("[cart] legacy bare-array adoption failed", e);
        }
      },

      _setHasHydrated: (v) => set({ _hasHydrated: v }),
    }),
    {
      // Persist under a sibling key so we don't fight the legacy app's
      // bare-array writer at `bf_cart`. `mirrorToLegacyBareArray` keeps
      // the legacy key in sync for cross-app reads.
      name: "bf_cart:next",
      storage: createJSONStorage(() => localStorage),
      // Never persist _hasHydrated itself — it must always start `false` on
      // a fresh load and only flip via onRehydrateStorage below, otherwise
      // a stale `true` written to storage in a prior session could make a
      // brand-new page load think it's already hydrated before this
      // session's own rehydration has actually run.
      partialize: (state) => ({ items: state.items }),
      onRehydrateStorage: () => (state) => {
        state?._setHasHydrated(true);
      },
    },
  ),
);

// One-time legacy bare-array adoption — runs on module load in the browser.
if (typeof window !== "undefined") {
  useCartStore.getState()._syncFromLegacy();
}
