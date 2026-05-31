/**
 * Lokl typed API client (Session A, Iter-33).
 *
 * One axios instance for ALL JSON traffic. Components and per-domain modules
 * import the singleton `apiClient` — they never reach for `axios` directly.
 *
 * Responsibilities:
 *   1. Multi-token auth: `customer` JWT for /api/customer/*, /api/orders + the
 *      consumer-mutation order routes; `merchant` JWT for /api/merchant/*;
 *      `admin` JWT for /api/admin/* and (NEW) admin export routes.
 *   2. Refresh-token rotation: a 401 on a customer/merchant-scoped route
 *      triggers a single /api/auth/refresh attempt. The refresh cookie is
 *      sent automatically (`withCredentials: true`). Success → retry the
 *      original request with the new access token. Failure → clear the
 *      relevant token + dispatch the legacy `customer-auth:change` /
 *      `merchant-auth:change` events so cross-tab UI stays in sync.
 *   3. Surface FastAPI's `{detail: "..."}` errors to the rest of the FE in a
 *      single helper (`getErrorMessage`) so toast/banner copy stays uniform.
 *
 * INTENTIONAL CARVE-OUTS — these stay on `fetch()` and bypass this client:
 *   • CSV / XLSX download endpoints
 *       - GET /api/merchant/analytics/report.csv
 *       - GET /api/merchant/products/template.xlsx
 *       - GET /api/admin/export/approvals.csv
 *     Streaming binary downloads don't fit the JSON interceptor pattern.
 *     `lib/downloads.ts` will host their typed wrappers in Session B.
 *
 *   • The legacy AdminPanel.jsx (in /app/frontend) uses raw fetch end-to-end.
 *     During the migration we'll port it via a thin `legacyFetch` compat shim
 *     in `lib/legacy-admin.ts` (Session C) so the panel keeps working without
 *     a full rewrite. Dedicated AdminPanel cleanup is a separate task.
 */

import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";
import type { RefreshResponse } from "@/types";

// ============================================================================
// localStorage key constants — must match the legacy CRA app byte-for-byte so
// open sessions survive the migration day and cross-tab events keep firing.
// ============================================================================
export const CUSTOMER_TOKEN_KEY = "bf_customer_token";
export const CUSTOMER_PHONE_KEY = "bf_customer_phone";
export const MERCHANT_TOKEN_KEY = "bf_token";
export const ADMIN_TOKEN_KEY = "bf_admin_token";

// Cross-tab events the legacy app dispatches. Preserved verbatim — Session B
// will replace the localStorage reads with Zustand selectors, but these events
// remain the public sync mechanism.
export const CUSTOMER_AUTH_EVENT = "customer-auth:change";
export const MERCHANT_AUTH_EVENT = "merchant-auth:change";
export const ADMIN_AUTH_EVENT = "admin-auth:change";

// ============================================================================
// URL classification — which token to attach
// ============================================================================

const CUSTOMER_ROUTE_PATTERNS: RegExp[] = [
  /^\/api\/customer\//,
  /^\/api\/auth\/customer\//,
  /^\/api\/orders$/,
  /^\/api\/orders\/[^/]+\/customer-cancel$/,
  /^\/api\/orders\/[^/]+\/returns$/,
  /^\/api\/orders\/[^/]+\/complaints$/,
  /^\/api\/customer\/upsert$/,
];

const MERCHANT_ROUTE_PATTERNS: RegExp[] = [
  /^\/api\/merchant\//,
  /^\/api\/auth\/me$/,
  /^\/api\/auth\/login$/,
  /^\/api\/auth\/register$/,
];

const ADMIN_ROUTE_PATTERNS: RegExp[] = [/^\/api\/admin\//];

type Scope = "customer" | "merchant" | "admin" | "public";

function classify(url: string): Scope {
  // Strip the base URL prefix so we match on the path portion only.
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0] ?? url;
  if (ADMIN_ROUTE_PATTERNS.some((re) => re.test(path))) return "admin";
  if (CUSTOMER_ROUTE_PATTERNS.some((re) => re.test(path))) return "customer";
  if (MERCHANT_ROUTE_PATTERNS.some((re) => re.test(path))) return "merchant";
  return "public";
}

function tokenKeyFor(scope: Scope): string | null {
  if (scope === "customer") return CUSTOMER_TOKEN_KEY;
  if (scope === "merchant") return MERCHANT_TOKEN_KEY;
  if (scope === "admin") return ADMIN_TOKEN_KEY;
  return null;
}

function authEventFor(scope: Scope): string | null {
  if (scope === "customer") return CUSTOMER_AUTH_EVENT;
  if (scope === "merchant") return MERCHANT_AUTH_EVENT;
  if (scope === "admin") return ADMIN_AUTH_EVENT;
  return null;
}

// ============================================================================
// Token helpers (exported — Zustand stores in Session B will wrap these)
// ============================================================================

const isBrowser = (): boolean => typeof window !== "undefined";

export function getToken(scope: Scope): string | null {
  if (!isBrowser()) return null;
  const key = tokenKeyFor(scope);
  return key ? localStorage.getItem(key) : null;
}

export function setToken(scope: Scope, token: string): void {
  if (!isBrowser()) return;
  const key = tokenKeyFor(scope);
  if (!key) return;
  localStorage.setItem(key, token);
  const evt = authEventFor(scope);
  if (evt) window.dispatchEvent(new Event(evt));
}

export function clearToken(scope: Scope): void {
  if (!isBrowser()) return;
  const key = tokenKeyFor(scope);
  if (!key) return;
  localStorage.removeItem(key);
  if (scope === "customer") localStorage.removeItem(CUSTOMER_PHONE_KEY);
  const evt = authEventFor(scope);
  if (evt) window.dispatchEvent(new Event(evt));
}

// ============================================================================
// Axios singleton
// ============================================================================

const baseURL = process.env.NEXT_PUBLIC_API_URL ?? "";

function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL,
    timeout: 15_000,
    headers: { "Content-Type": "application/json" },
    withCredentials: true, // refresh cookie travels with every request
  });

  // ---------------- request: attach scope-correct Bearer ----------------
  client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const url = config.url ?? "";
    // Caller can opt out by setting Authorization explicitly (e.g. an admin
    // export that needs a non-default token, or a public route that wants
    // to force-omit any bearer).
    if (config.headers?.Authorization) return config;

    const scope = classify(url);
    const token = scope !== "public" ? getToken(scope) : null;
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  // ---------------- response: 401 → refresh-once-and-retry ----------------
  let refreshInFlight: Promise<string> | null = null;

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as
        | (InternalAxiosRequestConfig & { _retry?: boolean })
        | undefined;
      const status = error.response?.status;

      // Only retry once, and only for non-public scopes with a 401.
      if (!originalRequest || originalRequest._retry || status !== 401) {
        return Promise.reject(error);
      }
      const scope = classify(originalRequest.url ?? "");
      if (scope === "public") return Promise.reject(error);

      originalRequest._retry = true;

      try {
        // Coalesce parallel 401s into a single refresh request.
        refreshInFlight ??= (async () => {
          const r = await axios.post<RefreshResponse>(
            `${baseURL}/api/auth/refresh`,
            {},
            { withCredentials: true },
          );
          return r.data.token;
        })();
        const newToken = await refreshInFlight;
        refreshInFlight = null;

        setToken(scope, newToken);
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
        }
        return client(originalRequest);
      } catch (refreshErr) {
        refreshInFlight = null;
        // Refresh failed — the session is gone. Clear our copy of the access
        // token + emit the legacy `*-auth:change` event so guards across the
        // app react (legacy CustomerAccount listens to it today).
        clearToken(scope);
        return Promise.reject(refreshErr);
      }
    },
  );

  return client;
}

export const apiClient = createApiClient();
export type { AxiosInstance };
