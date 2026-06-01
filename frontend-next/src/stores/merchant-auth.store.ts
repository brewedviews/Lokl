/**
 * Merchant-auth Zustand store. Same persistence key as the legacy CRA app
 * (`bf_token`) so an open merchant tab on the old app stays signed in on
 * the new app and vice versa.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
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
  _syncFromStorage: () => void;
}

type MerchantAuthStore = MerchantAuthState & MerchantAuthActions;

export const MERCHANT_TOKEN_KEY = "bf_token";
export const MERCHANT_AUTH_EVENT = "merchant-auth:change";

const INITIAL: MerchantAuthState = {
  isAuthenticated: false,
  token: null,
  user: null,
  storeState: null,
};

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
          window.dispatchEvent(new Event(MERCHANT_AUTH_EVENT));
        }
      },

      updateUser: (partial) => {
        const user = get().user;
        set({ user: user ? { ...user, ...partial } : null });
      },

      setStoreState: (storeState) => set({ storeState }),

      _syncFromStorage: () => {
        if (typeof window === "undefined") return;
        const token = localStorage.getItem(MERCHANT_TOKEN_KEY);
        set({ isAuthenticated: !!token, token: token ?? null });
      },
    }),
    {
      name: MERCHANT_TOKEN_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ token: state.token }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.isAuthenticated = !!state.token;
      },
    },
  ),
);

if (typeof window !== "undefined") {
  window.addEventListener(MERCHANT_AUTH_EVENT, () => {
    useMerchantAuthStore.getState()._syncFromStorage();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === MERCHANT_TOKEN_KEY) {
      useMerchantAuthStore.getState()._syncFromStorage();
    }
  });
}
