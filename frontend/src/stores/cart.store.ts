/**
 * Cart store. localStorage key + line-item shape are PORTED VERBATIM from
 * `contexts/CartContext.jsx` so a customer with `bf_cart` data from the
 * legacy app sees their cart on day one of the new app.
 *
 * Legacy line shape:
 *   { key, id, name, price, image, size, store_name, store_eta_min, qty }
 *
 * Iter-32 added a per-customer ownership rule on /api/orders, but the cart
 * itself stayed multi-store. Per the Session B spec we now enforce single
 * store on add. Backward-compat: legacy lines without `store_id` are
 * grandfathered in — the conflict check only triggers when both sides have
 * a store_id (which all NEW lines will).
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

// ---------------------------------------------------------------------------
// State + actions
// ---------------------------------------------------------------------------

interface CartState {
  items: CartItem[];
  storeId: string | null;
  storeName: string | null;
}

interface CartActions {
  addItem: (
    product: ProductCard,
    size: string,
    qty?: number,
  ) => { success: boolean; conflict?: CartConflict };
  removeItem: (productId: string, size: string) => void;
  updateQty: (productId: string, size: string, qty: number) => void;
  clearCart: () => void;
  replaceCart: (storeId: string, storeName: string, items: CartItem[]) => void;
  getTotal: () => RupeeAmount;
  getItemCount: () => number;
  getLineTotal: (productId: string, size: string) => RupeeAmount;
  /** Hydrate from the legacy bare-array `bf_cart` shape if present. */
  _syncFromLegacy: () => void;
}

type CartStore = CartState & CartActions;

const INITIAL: CartState = { items: [], storeId: null, storeName: null };

const cartKeyFor = (productId: string, size: string) =>
  `${productId}-${size || "free"}`;

// ---------------------------------------------------------------------------
// Legacy bare-array writer — keeps `bf_cart` readable by the legacy CRA app
// for the duration of the cutover. Called on every state change below.
// ---------------------------------------------------------------------------
function mirrorToLegacyBareArray(items: CartItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {
    // Quota exceeded etc. — non-fatal; the Zustand-persist copy still works.
  }
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      addItem: (product, size, qty = 1) => {
        const state = get();
        const itemStoreId = product.store_id;
        // Single-store rule — only applied when both sides know the store id.
        if (
          state.storeId &&
          itemStoreId &&
          state.storeId !== itemStoreId
        ) {
          return {
            success: false,
            conflict: {
              existing_store_id: state.storeId,
              existing_store_name: state.storeName ?? "another store",
              new_store_id: itemStoreId,
              new_store_name: product.store_name ?? "the new store",
            },
          };
        }

        const key = cartKeyFor(product.id, size);
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
            qty,
            size: size || undefined,
            image: product.image,
            store_id: itemStoreId,
            store_name: product.store_name,
            return_eligible: product.return_eligible,
          };
          nextItems = [...state.items, line];
        }

        set({
          items: nextItems,
          // Lock the cart's store identity on first add (or carry forward if
          // it was already set).
          storeId: state.storeId ?? itemStoreId ?? null,
          storeName: state.storeName ?? product.store_name ?? null,
        });
        mirrorToLegacyBareArray(nextItems);
        return { success: true };
      },

      removeItem: (productId, size) => {
        const key = cartKeyFor(productId, size);
        const nextItems = get().items.filter((i) => i.key !== key);
        // When the cart empties, release the store lock so the next product
        // can come from anywhere.
        const isEmpty = nextItems.length === 0;
        set({
          items: nextItems,
          storeId: isEmpty ? null : get().storeId,
          storeName: isEmpty ? null : get().storeName,
        });
        mirrorToLegacyBareArray(nextItems);
      },

      updateQty: (productId, size, qty) => {
        if (qty <= 0) {
          get().removeItem(productId, size);
          return;
        }
        const key = cartKeyFor(productId, size);
        const nextItems = get().items.map((i) => (i.key === key ? { ...i, qty } : i));
        set({ items: nextItems });
        mirrorToLegacyBareArray(nextItems);
      },

      clearCart: () => {
        set({ ...INITIAL });
        mirrorToLegacyBareArray([]);
      },

      replaceCart: (storeId, storeName, items) => {
        set({ storeId, storeName, items });
        mirrorToLegacyBareArray(items);
      },

      getTotal: () =>
        get().items.reduce((sum, i) => sum + i.price * i.qty, 0),

      getItemCount: () =>
        get().items.reduce((sum, i) => sum + i.qty, 0),

      getLineTotal: (productId, size) => {
        const key = cartKeyFor(productId, size);
        const line = get().items.find((i) => i.key === key);
        return line ? line.price * line.qty : 0;
      },

      _syncFromLegacy: () => {
        if (typeof window === "undefined") return;
        try {
          const raw = localStorage.getItem(CART_KEY);
          if (!raw) return;
          const parsed = JSON.parse(raw) as unknown;
          // The legacy app writes a bare ARRAY. Zustand-persist writes an
          // OBJECT. Only adopt the legacy shape — let persist hydrate its own.
          if (Array.isArray(parsed)) {
            const items = parsed as CartItem[];
            const firstWithStore = items.find((i) => !!i.store_id);
            set({
              items,
              storeId: firstWithStore?.store_id ?? null,
              storeName: firstWithStore?.store_name ?? null,
            });
          }
        } catch {
          // Malformed legacy cart — leave the store untouched.
        }
      },
    }),
    {
      // Persist under a sibling key so we don't fight the legacy app's
      // bare-array writer at `bf_cart`. `mirrorToLegacyBareArray` keeps
      // the legacy key in sync for cross-app reads.
      name: "bf_cart:next",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

// One-time legacy bare-array adoption — runs on module load in the browser.
if (typeof window !== "undefined") {
  useCartStore.getState()._syncFromLegacy();
}
