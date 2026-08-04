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
  getTotal: () => RupeeAmount;
  getItemCount: () => number;
  getLineTotal: (productId: string, size: string) => RupeeAmount;
  getStoreIds: () => string[];
  /** Hydrate from the legacy bare-array `bf_cart` shape if present. */
  _syncFromLegacy: () => void;
}

type CartStore = CartState & CartActions;

const INITIAL: CartState = { items: [] };

const cartKeyFor = (productId: string, size: string) =>
  `${productId}-${size || "free"}`;

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

      addItem: (product, size, qty = 1) => {
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

        set({ items: nextItems });
        mirrorToLegacyBareArray(nextItems);
        return { success: true };
      },

      removeItem: (productId, size) => {
        const key = cartKeyFor(productId, size);
        const nextItems = get().items.filter((i) => i.key !== key);
        set({ items: nextItems });
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

      getTotal: () =>
        get().items.reduce((sum, i) => sum + i.price * i.qty, 0),

      getItemCount: () =>
        get().items.reduce((sum, i) => sum + i.qty, 0),

      getLineTotal: (productId, size) => {
        const key = cartKeyFor(productId, size);
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
