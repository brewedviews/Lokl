/**
 * Merchant-auth Zustand store.
 *
 * Persistence key: `lokl_merchant_auth` (Zustand persist owns this exclusively).
 * Legacy CRA wrote `bf_token` as a raw JWT — we DELIBERATELY moved off that key
 * to avoid a recursive-wrap bug (persist wraps the JWT in a JSON envelope, the
 * legacy `_syncFromStorage` shim then read that envelope back as the "JWT" and
 * re-wrapped on the next persist call, growing the string until it tripped
 * `QuotaExceededError` on `localStorage.setItem` — Sentry incident Feb-2026).
 *
 * Storage shape (≤ 1 KB): `{"state":{"token":"eyJ..."},"version":0}`. We do NOT
 * persist `user` or `storeState`; they're rehydrated server-side via `/api/merchant/me`
 * on first paint, keeping localStorage well under the safe cap.
 *
 * Every `localStorage` write is wrapped in `safeSetItem` so a full disk /
 * Safari private mode / quota-exceeded condition logs a Sentry warning but
 * never crashes the login page.
 */
import { create } from "zustand";
import { persist, createJSONStorage, type PersistStorage } from "zustand/middleware";
import type { Merchant } from "@/types";

export type MerchantStoreState = "pending" | "approved" | "rejected" | null;

interface MerchantAuthState {
  isAuthenticated: boolean;
  token: string | null;
  user: Merchant | null;
  storeState: MerchantStoreState;
}

interface MerchantAuthActions {
  setAuth: (token: string, user: Merchant) => void;
  clearAuth: () => void;
  updateUser: (partial: Partial<Merchant>) => void;
  setStoreState: (s: MerchantStoreState) => void;
}

type MerchantAuthStore = MerchantAuthState & MerchantAuthActions;

/** Stable persistence key — owned exclusively by zustand/persist. */
export const MERCHANT_PERSIST_KEY = "lokl_merchant_auth";
/** Legacy key (CRA app). Kept ONLY for one-time migration on first paint. */
const LEGACY_MERCHANT_TOKEN_KEY = "bf_token";
/** Re-exported for the few non-store callers (api-client.ts) that read raw token. */
export const MERCHANT_TOKEN_KEY = MERCHANT_PERSIST_KEY;
export const MERCHANT_AUTH_EVENT = "merchant-auth:change";

const INITIAL: MerchantAuthState = {
  isAuthenticated: false,
  token: null,
  user: null,
  storeState: null,
};

/** localStorage wrapper that swallows QuotaExceededError + private-mode errors. */
function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    // Quota, private mode, disabled storage — log once and continue. The user
    // will be signed out at next reload but the page won't crash.
    if (typeof console !== "undefined") {
      console.error(`[merchant-auth] localStorage.setItem("${key}") failed:`, err);
    }
  }
}

/** Tiny wrapper around the default JSON storage that uses safeSetItem. */
function safeStorage(): PersistStorage<Partial<MerchantAuthState>> | undefined {
  if (typeof window === "undefined") return undefined;
  const inner = createJSONStorage<Partial<MerchantAuthState>>(() => localStorage);
  if (!inner) return undefined;
  return {
    getItem: (name) => inner.getItem(name),
    setItem: (name, value) => {
      // value is the JSON-envelope; persist will pass a string. Wrap defensively.
      try {
        inner.setItem(name, value);
      } catch (err) {
        if (typeof console !== "undefined") {
          console.error(`[merchant-auth] persist write failed for "${name}":`, err);
        }
      }
    },
    removeItem: (name) => inner.removeItem(name),
  };
}

/** One-time migration: read the legacy raw-JWT key, then delete it. */
function migrateLegacyToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LEGACY_MERCHANT_TOKEN_KEY);
    if (!raw) return null;
    // Legacy CRA wrote a JWT directly. The bloated recursive-wrap value, if
    // present, starts with `{"state":{"token":"`. Strip if necessary, then drop.
    let token: string | null = raw;
    if (raw.startsWith("{")) {
      let inner = raw;
      // Peel up to 5 nested wraps (recursive bug victims). Anything deeper is junk.
      for (let i = 0; i < 5; i++) {
        try {
          const parsed = JSON.parse(inner) as { state?: { token?: string } };
          const next = parsed?.state?.token;
          if (typeof next !== "string") break;
          inner = next;
          if (!inner.startsWith("{")) break;
        } catch { break; }
      }
      token = inner.startsWith("eyJ") ? inner : null;
    }
    localStorage.removeItem(LEGACY_MERCHANT_TOKEN_KEY);
    return token;
  } catch {
    return null;
  }
}

export const useMerchantAuthStore = create<MerchantAuthStore>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      setAuth: (token, user) => {
        set({ isAuthenticated: true, token, user });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(MERCHANT_AUTH_EVENT));
        }
      },

      clearAuth: () => {
        set({ ...INITIAL });
        if (typeof window !== "undefined") {
          safeSetItem(LEGACY_MERCHANT_TOKEN_KEY, ""); // also clear any leftover
          try { localStorage.removeItem(LEGACY_MERCHANT_TOKEN_KEY); } catch { /* noop */ }
          window.dispatchEvent(new Event(MERCHANT_AUTH_EVENT));
        }
      },

      updateUser: (partial) => {
        const user = get().user;
        set({ user: user ? { ...user, ...partial } : null });
      },

      setStoreState: (storeState) => set({ storeState }),
    }),
    {
      name: MERCHANT_PERSIST_KEY,
      storage: safeStorage(),
      // ONLY persist the token — keeps the envelope under 1 KB. user/storeState
      // are rehydrated from `/api/merchant/me` after sign-in.
      partialize: (state) => ({ token: state.token }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // If we have nothing persisted, attempt a one-time migration from `bf_token`.
        if (!state.token) {
          const legacy = migrateLegacyToken();
          if (legacy) state.token = legacy;
        }
        state.isAuthenticated = !!state.token;
      },
    },
  ),
);

if (typeof window !== "undefined") {
  // Cross-tab + same-tab sync. We rely on persist's own storage event handling
  // for the actual rehydrate — don't write back to localStorage manually here.
  window.addEventListener("storage", (e) => {
    if (e.key === MERCHANT_PERSIST_KEY || e.key === LEGACY_MERCHANT_TOKEN_KEY) {
      void useMerchantAuthStore.persist.rehydrate();
    }
  });
  window.addEventListener(MERCHANT_AUTH_EVENT, () => {
    void useMerchantAuthStore.persist.rehydrate();
  });
}
