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
export const MERCHANT_TOKEN_KEY = "lokl_merchant_auth";
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

/**
 * Read a JWT from localStorage, transparently unwrapping the
 * `zustand/persist` envelope shape `{"state":{"token":"eyJ..."},"version":0}`
 * (and tolerating up to 4 levels of accidental nesting — see the
 * `bf_token` Sentry incident, Feb 2026). Returns the raw JWT or null.
 *
 * Keeping the unwrap here means none of the consuming stores need to know
 * about the envelope, and a malformed legacy value never reaches the
 * Authorization header where it would silently fail every request.
 */
function unwrapPersistEnvelope(raw: string | null): string | null {
  if (!raw) return null;
  let value = raw;
  for (let i = 0; i < 5; i++) {
    if (!value.startsWith("{")) break;
    try {
      const parsed = JSON.parse(value) as { state?: { token?: string } };
      const next = parsed?.state?.token;
      if (typeof next !== "string") return null;
      value = next;
    } catch {
      return null;
    }
  }
  return value.startsWith("ey") ? value : null;  // looks like a JWT
}

export function getToken(scope: Scope): string | null {
  if (!isBrowser()) return null;
  const key = tokenKeyFor(scope);
  if (!key) return null;
  return unwrapPersistEnvelope(localStorage.getItem(key));
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

/**
 * Browser axios calls go through the Next.js `/api/:path*` rewrite (see
 * next.config.ts), which proxies same-origin → FastAPI. Using an absolute
 * NEXT_PUBLIC_API_URL would (a) defeat the rewrite, and (b) trip CORS
 * because the preview ingress returns `Access-Control-Allow-Origin: *`
 * together with `Access-Control-Allow-Credentials: true`, a combo the
 * browser rejects on credentialed requests. Empty baseURL = relative `/api/*`.
 *
 * On the rare chance this module is imported during SSR (it shouldn't —
 * server data fetching uses `lib/server-fetch.ts`), we still need an
 * absolute URL because Node has no notion of "same origin".
 */
const baseURL =
  typeof window === "undefined"
    ? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001"
    : "";

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

        // Verify the refreshed token carries the right role for this scope.
        // A merchant refresh cookie can accidentally satisfy a customer-scope
        // 401 retry, which would then get a 403 on the backend. Reject early.
        try {
          const parts = newToken.split(".");
          if (parts.length < 3 || !parts[1]) { clearToken(scope); return Promise.reject(new Error("Invalid token")); }
          const payload = JSON.parse(atob(parts[1])) as { role?: string };
          const expectedRole = scope === "admin" ? "admin" : scope === "merchant" ? "merchant" : "customer";
          if (payload.role !== expectedRole) {
            clearToken(scope);
            return Promise.reject(error);
          }
        } catch {
          clearToken(scope);
          return Promise.reject(error);
        }

        setToken(scope, newToken);
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
        }
        return client(originalRequest);
      } catch (refreshErr) {
        refreshInFlight = null;
        // For customers: only clear the token when the server explicitly says
        // it's revoked — not on every 401 (e.g. network blip, server restart).
        // Merchants and admins always get cleared so they're bounced to login.
        if (scope === "customer") {
          const body = (refreshErr as { response?: { data?: { detail?: string } } })?.response?.data;
          const detail = ((body?.detail) ?? "").toLowerCase();
          if (detail.includes("revoked") || detail.includes("invalid_token")) {
            clearToken(scope);
          }
        } else {
          clearToken(scope);
        }
        if (typeof window !== "undefined") {
          const onAdminPath = window.location.pathname.startsWith("/admin");
          const onMerchantPath = window.location.pathname.startsWith("/merchant");
          if (scope === "admin" && onAdminPath && window.location.pathname !== "/admin") {
            window.location.assign("/admin");
          } else if (scope === "merchant" && onMerchantPath && !window.location.pathname.endsWith("/login")) {
            window.location.assign("/merchant/login");
          }
        }
        return Promise.reject(refreshErr);
      }
    },
  );

  return client;
}

export const apiClient = createApiClient();
export type { AxiosInstance };
