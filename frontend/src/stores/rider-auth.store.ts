/**
 * Rider-auth Zustand store (Phase 1 rider delivery platform, Commit 4).
 *
 * Modeled directly on customer-auth.store.ts — same two-key model (raw JWT
 * mirror for api-client + a zustand-persist envelope) since riders, like
 * customers, get a long-lived access token with no refresh-token flow (see
 * auth.py's role in ("customer", "rider") TTL branch and rider_verify_otp).
 *
 * Unlike the customer store, the `rider` profile IS persisted (not just
 * token+phone) — it's small (no PII beyond the rider's own info) and having
 * it available on first paint means the top-bar online toggle and rider name
 * render immediately after a reload instead of waiting on a network round
 * trip.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CanonicalPhone, Rider } from "@/types";

interface RiderAuthState {
  isAuthenticated: boolean;
  phone: CanonicalPhone | null;
  token: string | null;
  rider: Rider | null;
}

interface RiderAuthActions {
  setAuth: (token: string, phone: CanonicalPhone, rider?: Rider | null) => void;
  clearAuth: () => void;
  updateRider: (partial: Partial<Rider>) => void;
  /** Internal — invoked by the cross-tab event listener. */
  _syncFromStorage: () => void;
}

type RiderAuthStore = RiderAuthState & RiderAuthActions;

/** Legacy-style raw-JWT mirror. Read by api-client.ts. */
export const RIDER_TOKEN_KEY = "bf_rider_token";
export const RIDER_PHONE_KEY = "bf_rider_phone";
/** Zustand-persist key (state envelope). MUST differ from RIDER_TOKEN_KEY. */
const RIDER_AUTH_STORE_KEY = "bf_rider_auth_v1";
export const RIDER_AUTH_EVENT = "rider-auth:change";

const INITIAL: RiderAuthState = {
  isAuthenticated: false,
  phone: null,
  token: null,
  rider: null,
};

export const useRiderAuthStore = create<RiderAuthStore>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      setAuth: (token, phone, rider = null) => {
        set({ isAuthenticated: true, token, phone, rider });
        if (typeof window !== "undefined") {
          localStorage.setItem(RIDER_TOKEN_KEY, token);
          localStorage.setItem(RIDER_PHONE_KEY, phone);
          window.dispatchEvent(new Event(RIDER_AUTH_EVENT));
        }
      },

      clearAuth: () => {
        set({ ...INITIAL });
        if (typeof window !== "undefined") {
          localStorage.removeItem(RIDER_TOKEN_KEY);
          localStorage.removeItem(RIDER_PHONE_KEY);
          localStorage.removeItem(RIDER_AUTH_STORE_KEY);
          window.dispatchEvent(new Event(RIDER_AUTH_EVENT));
        }
      },

      updateRider: (partial) => {
        const rider = get().rider;
        set({ rider: rider ? { ...rider, ...partial } : null });
      },

      _syncFromStorage: () => {
        if (typeof window === "undefined") return;
        const raw = localStorage.getItem(RIDER_TOKEN_KEY);
        const token = raw && raw.startsWith("ey") ? raw : null;
        const phone = localStorage.getItem(RIDER_PHONE_KEY);
        set({
          isAuthenticated: !!token,
          token,
          phone: phone ?? null,
        });
      },
    }),
    {
      name: RIDER_AUTH_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ token: state.token, phone: state.phone, rider: state.rider }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (typeof window !== "undefined") {
          const raw = localStorage.getItem(RIDER_TOKEN_KEY);
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

if (typeof window !== "undefined") {
  window.addEventListener(RIDER_AUTH_EVENT, () => {
    useRiderAuthStore.getState()._syncFromStorage();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === RIDER_TOKEN_KEY || e.key === RIDER_PHONE_KEY) {
      useRiderAuthStore.getState()._syncFromStorage();
    }
  });
}
