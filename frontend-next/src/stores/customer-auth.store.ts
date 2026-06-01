/**
 * Customer-auth Zustand store. Drop-in replacement for the legacy
 * localStorage reads + `customer-auth:change` event listeners in the CRA app.
 *
 * Migration day: the same key (`bf_customer_token`) + same event name means
 * an open browser tab on the old app shares a token with the new app.
 *
 * Hydration quirk:
 *   • Persisted state is `{ token, phone }` only — never the full Customer
 *     doc (avoids stale denormalized fields and keeps localStorage small).
 *   • `isAuthenticated` is computed from the presence of `token` after
 *     onRehydrateStorage runs.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CanonicalPhone, Customer } from "@/types";

interface CustomerAuthState {
  isAuthenticated: boolean;
  phone: CanonicalPhone | null;
  token: string | null;
  user: Customer | null;
}

interface CustomerAuthActions {
  setAuth: (token: string, phone: CanonicalPhone, user?: Customer | null) => void;
  clearAuth: () => void;
  updateUser: (partial: Partial<Customer>) => void;
  /** Internal — invoked by the cross-tab event listener. */
  _syncFromStorage: () => void;
}

type CustomerAuthStore = CustomerAuthState & CustomerAuthActions;

export const CUSTOMER_TOKEN_KEY = "bf_customer_token";
export const CUSTOMER_PHONE_KEY = "bf_customer_phone";
export const CUSTOMER_AUTH_EVENT = "customer-auth:change";

const INITIAL: CustomerAuthState = {
  isAuthenticated: false,
  phone: null,
  token: null,
  user: null,
};

export const useCustomerAuthStore = create<CustomerAuthStore>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      setAuth: (token, phone, user = null) => {
        set({ isAuthenticated: true, token, phone, user });
        if (typeof window !== "undefined") {
          // Mirror the legacy companion key (some consumer components still
          // read this raw before the migration is complete).
          localStorage.setItem(CUSTOMER_PHONE_KEY, phone);
          window.dispatchEvent(new Event(CUSTOMER_AUTH_EVENT));
        }
      },

      clearAuth: () => {
        set({ ...INITIAL });
        if (typeof window !== "undefined") {
          localStorage.removeItem(CUSTOMER_PHONE_KEY);
          window.dispatchEvent(new Event(CUSTOMER_AUTH_EVENT));
        }
      },

      updateUser: (partial) => {
        const user = get().user;
        set({ user: user ? { ...user, ...partial } : null });
      },

      _syncFromStorage: () => {
        if (typeof window === "undefined") return;
        const token = localStorage.getItem(CUSTOMER_TOKEN_KEY);
        const phone = localStorage.getItem(CUSTOMER_PHONE_KEY);
        set({
          isAuthenticated: !!token,
          token: token ?? null,
          phone: phone ?? null,
          // Don't blow away `user` — it's a runtime cache the other tab can't share.
        });
      },
    }),
    {
      name: CUSTOMER_TOKEN_KEY,
      storage: createJSONStorage(() => localStorage),
      // The legacy app stores the raw JWT string at `bf_customer_token`.
      // Zustand-persist wraps state in {state, version} JSON; that would
      // break the bare-string reader in the legacy api.js. We work around it
      // with a custom partializer that ONLY persists fields readable on their
      // own + a separate raw mirror set/cleared in setAuth/clearAuth above.
      partialize: (state) => ({ token: state.token, phone: state.phone }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Mark auth based on whether the rehydrated token survived.
        state.isAuthenticated = !!state.token;
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Cross-tab + cross-app (legacy CRA <-> new Next.js) sync.
// We listen to both the legacy `customer-auth:change` event AND the storage
// event so a logout in one tab/app flips the other.
// ---------------------------------------------------------------------------
if (typeof window !== "undefined") {
  window.addEventListener(CUSTOMER_AUTH_EVENT, () => {
    useCustomerAuthStore.getState()._syncFromStorage();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === CUSTOMER_TOKEN_KEY || e.key === CUSTOMER_PHONE_KEY) {
      useCustomerAuthStore.getState()._syncFromStorage();
    }
  });
}
