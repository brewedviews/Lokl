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
          // Belt-and-braces: remove the key entirely so any stale, malformed
          // persist envelope (e.g. double-stringified data from a previous
          // iter18 build) is wiped — otherwise `_syncFromStorage` could try to
          // unwrap it on next page load.
          localStorage.removeItem(ADMIN_TOKEN_KEY);
          window.dispatchEvent(new Event(ADMIN_AUTH_EVENT));
        }
      },

      _syncFromStorage: () => {
        if (typeof window === "undefined") return;
        // The localStorage value is a Zustand persist envelope —
        //   {"state":{"token":"<jwt>"},"version":0}
        // Reading the raw envelope and assigning it as `state.token` would
        // cause the next persist save to nest the envelope inside itself
        // (double-stringification, observed by iter18). Unwrap to the JWT.
        const raw = localStorage.getItem(ADMIN_TOKEN_KEY);
        let token: string | null = null;
        if (raw) {
          let value = raw;
          for (let i = 0; i < 5; i++) {
            if (!value.startsWith("{")) break;
            try {
              const parsed = JSON.parse(value) as { state?: { token?: string | null } };
              const next = parsed?.state?.token;
              if (typeof next !== "string") { value = ""; break; }
              value = next;
            } catch { value = ""; break; }
          }
          token = value && value.startsWith("ey") ? value : null;
        }
        set({ isAuthenticated: !!token, token });
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
