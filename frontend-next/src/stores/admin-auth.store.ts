/**
 * Admin-auth Zustand store. Same persistence key the legacy AdminPanel.jsx
 * reads (`bf_admin_token`). No user-doc field — admin is just a JWT-holder
 * server-side; the email lives in the token.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface AdminAuthState {
  isAuthenticated: boolean;
  token: string | null;
}

interface AdminAuthActions {
  setAuth: (token: string) => void;
  clearAuth: () => void;
  _syncFromStorage: () => void;
}

type AdminAuthStore = AdminAuthState & AdminAuthActions;

export const ADMIN_TOKEN_KEY = "bf_admin_token";
export const ADMIN_AUTH_EVENT = "admin-auth:change";

export const useAdminAuthStore = create<AdminAuthStore>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      token: null,

      setAuth: (token) => {
        set({ isAuthenticated: true, token });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(ADMIN_AUTH_EVENT));
        }
      },

      clearAuth: () => {
        set({ isAuthenticated: false, token: null });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(ADMIN_AUTH_EVENT));
        }
      },

      _syncFromStorage: () => {
        if (typeof window === "undefined") return;
        const token = localStorage.getItem(ADMIN_TOKEN_KEY);
        set({ isAuthenticated: !!token, token: token ?? null });
      },
    }),
    {
      name: ADMIN_TOKEN_KEY,
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
  window.addEventListener(ADMIN_AUTH_EVENT, () => {
    useAdminAuthStore.getState()._syncFromStorage();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === ADMIN_TOKEN_KEY) {
      useAdminAuthStore.getState()._syncFromStorage();
    }
  });
}
