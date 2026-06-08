/**
 * Customer-auth Zustand store.
 *
 * iter-27 (Item 3 fix) — Two-key model to avoid the persist-envelope collision:
 *
 *   1. `bf_customer_token` (RAW JWT mirror, legacy-compatible)
 *      • Written by `setAuth`, removed by `clearAuth`.
 *      • Consumed by `lib/api-client.ts` (Authorization header) AND by the
 *        legacy CRA app on the same origin.
 *      • Value: a bare JWT string. NEVER a JSON envelope.
 *
 *   2. `bf_customer_auth_v1` (zustand-persist envelope)
 *      • Owned exclusively by this store.
 *      • Holds `{ state: { token, phone }, version }` — Zustand's own format.
 *      • The two keys never share a name, so `_syncFromStorage` reading the
 *        raw mirror can never accidentally stuff the envelope back into
 *        `state.token` (the bug that broke logout in iter-27 testing).
 *
 * Migration: any open browser tab with a deeply-nested envelope at
 * `bf_customer_token` is healed on first store init by `_cleanupLegacyEnvelope`,
 * which unwraps to a raw JWT (or removes the key if it's not a real token).
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

/** Legacy raw-JWT mirror. Read by api-client and the old CRA app. */
export const CUSTOMER_TOKEN_KEY = "bf_customer_token";
export const CUSTOMER_PHONE_KEY = "bf_customer_phone";
/** Zustand-persist key (state envelope). MUST differ from CUSTOMER_TOKEN_KEY. */
const CUSTOMER_AUTH_STORE_KEY = "bf_customer_auth_v1";
export const CUSTOMER_AUTH_EVENT = "customer-auth:change";

const INITIAL: CustomerAuthState = {
  isAuthenticated: false,
  phone: null,
  token: null,
  user: null,
};

/**
 * Heal historical localStorage state that pre-dates the two-key split.
 * Earlier builds let zustand-persist write its envelope to `bf_customer_token`,
 * which sometimes nested up to 4 levels deep. Unwrap to a raw JWT here so the
 * api-client never sees JSON and the store's `_syncFromStorage` reads a bare
 * token. Runs exactly once at module init.
 */
function cleanupLegacyEnvelope(): void {
  if (typeof window === "undefined") return;
  const raw = localStorage.getItem(CUSTOMER_TOKEN_KEY);
  if (!raw || !raw.startsWith("{")) return;  // already a raw JWT or absent
  let value = raw;
  for (let i = 0; i < 5; i++) {
    if (!value.startsWith("{")) break;
    try {
      const parsed = JSON.parse(value) as { state?: { token?: string | null } };
      const next = parsed?.state?.token;
      if (typeof next !== "string") {
        // null/missing token deep in the envelope → user is effectively signed out.
        localStorage.removeItem(CUSTOMER_TOKEN_KEY);
        return;
      }
      value = next;
    } catch {
      localStorage.removeItem(CUSTOMER_TOKEN_KEY);
      return;
    }
  }
  if (value.startsWith("ey")) {
    localStorage.setItem(CUSTOMER_TOKEN_KEY, value);
  } else {
    localStorage.removeItem(CUSTOMER_TOKEN_KEY);
  }
}

cleanupLegacyEnvelope();

export const useCustomerAuthStore = create<CustomerAuthStore>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      setAuth: (token, phone, user = null) => {
        set({ isAuthenticated: true, token, phone, user });
        if (typeof window !== "undefined") {
          // Write the legacy RAW-JWT mirror so api-client + the old CRA app
          // both see a usable bearer token. Never write an envelope here.
          localStorage.setItem(CUSTOMER_TOKEN_KEY, token);
          localStorage.setItem(CUSTOMER_PHONE_KEY, phone);
          window.dispatchEvent(new Event(CUSTOMER_AUTH_EVENT));
        }
      },

      clearAuth: () => {
        set({ ...INITIAL });
        if (typeof window !== "undefined") {
          // Hard-clear both the raw mirror AND the persist envelope, so a
          // refresh in the same tab cannot rehydrate the user.
          localStorage.removeItem(CUSTOMER_TOKEN_KEY);
          localStorage.removeItem(CUSTOMER_PHONE_KEY);
          localStorage.removeItem(CUSTOMER_AUTH_STORE_KEY);
          window.dispatchEvent(new Event(CUSTOMER_AUTH_EVENT));
        }
      },

      updateUser: (partial) => {
        const user = get().user;
        set({ user: user ? { ...user, ...partial } : null });
      },

      _syncFromStorage: () => {
        if (typeof window === "undefined") return;
        // Read the RAW-JWT mirror — never the persist envelope. Anything
        // that doesn't look like a JWT is treated as signed-out.
        const raw = localStorage.getItem(CUSTOMER_TOKEN_KEY);
        const token = raw && raw.startsWith("ey") ? raw : null;
        const phone = localStorage.getItem(CUSTOMER_PHONE_KEY);
        set({
          isAuthenticated: !!token,
          token: token,
          phone: phone ?? null,
          // Don't blow away `user` — it's a runtime cache the other tab can't share.
        });
      },
    }),
    {
      name: CUSTOMER_AUTH_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ token: state.token, phone: state.phone }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // After rehydration trust the RAW-JWT mirror as the source of truth.
        // This way a legacy CRA logout (which cleared the mirror but not the
        // envelope) still propagates as a sign-out in this app.
        if (typeof window !== "undefined") {
          const raw = localStorage.getItem(CUSTOMER_TOKEN_KEY);
          const token = raw && raw.startsWith("ey") ? raw : null;
          state.token = token;
          state.isAuthenticated = !!token;
        } else {
          state.isAuthenticated = !!state.token;
        }
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
