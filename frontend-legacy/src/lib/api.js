import axios from "axios";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// localStorage keys — kept in one place so any code path that mutates
// auth state goes through `setCustomerToken` / `clearCustomerToken` below.
const CUSTOMER_TOKEN_KEY = "bf_customer_token";
const CUSTOMER_PHONE_KEY = "bf_customer_phone";
const MERCHANT_TOKEN_KEY = "bf_token";

// Routes that MUST use the customer JWT (never the merchant one). Anything
// not in this list and not under /merchant or /admin falls back to the
// merchant token if present, otherwise no auth.
const CUSTOMER_ROUTE_PATTERNS = [
  /^\/customer\//,
  /^\/auth\/customer\//,
  /^\/orders$/,                     // POST /api/orders (create)
  /^\/orders\/[^/]+\/customer-cancel$/,
  /^\/orders\/[^/]+\/returns$/,
  /^\/orders\/[^/]+\/complaints$/,
  /^\/customer\/upsert$/,
];

function isCustomerRoute(url = "") {
  // Strip query string + leading API base for matching.
  const path = url.replace(API, "").split("?")[0];
  return CUSTOMER_ROUTE_PATTERNS.some((re) => re.test(path));
}

export function getCustomerToken() {
  return localStorage.getItem(CUSTOMER_TOKEN_KEY) || "";
}
export function getCustomerPhone() {
  return localStorage.getItem(CUSTOMER_PHONE_KEY) || "";
}
export function setCustomerSession(token, phone) {
  if (token) localStorage.setItem(CUSTOMER_TOKEN_KEY, token);
  if (phone) localStorage.setItem(CUSTOMER_PHONE_KEY, phone);
  window.dispatchEvent(new Event("customer-auth:change"));
}
export function clearCustomerSession() {
  localStorage.removeItem(CUSTOMER_TOKEN_KEY);
  localStorage.removeItem(CUSTOMER_PHONE_KEY);
  window.dispatchEvent(new Event("customer-auth:change"));
}
export function isCustomerSignedIn() {
  return !!getCustomerToken();
}

const client = axios.create({ baseURL: API, withCredentials: true });

client.interceptors.request.use((cfg) => {
  // Customer routes get the customer token; merchant/admin routes get the
  // merchant token. Explicitly-supplied Authorization headers (e.g. the
  // admin panel that manages its own bf_admin_token) are never overwritten.
  if (cfg.headers && cfg.headers.Authorization) return cfg;
  if (isCustomerRoute(cfg.url || "")) {
    const t = getCustomerToken();
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
  } else {
    const t = localStorage.getItem(MERCHANT_TOKEN_KEY);
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
  }
  return cfg;
});

// Global 401 handler for customer-scoped routes: clear stale session so the
// UI can re-prompt for login instead of looping with an expired token.
client.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    const url = err?.config?.url || "";
    if (status === 401 && isCustomerRoute(url) && getCustomerToken()) {
      clearCustomerSession();
    }
    return Promise.reject(err);
  },
);

export default client;
