/**
 * Compatibility shim for AdminPanel.jsx's raw-fetch usage.
 * AdminPanel is intentionally NOT ported to TypeScript during the migration
 * (per Session A constraint). When it is eventually ported, replace these
 * helpers with the typed `api.admin.*` modules — this shim is the bridge,
 * not the destination.
 *
 * DO NOT extend this file with new endpoints. New code must use `api-client.ts`.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "";

function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("bf_admin_token");
}

function authHeaders(): HeadersInit {
  const token = getAdminToken();
  const base: Record<string, string> = { "Content-Type": "application/json" };
  if (token) base["Authorization"] = `Bearer ${token}`;
  return base;
}

/** Typed JSON `fetch` wrapper. Throws on non-2xx with the body text appended. */
export async function adminFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers ?? {}) },
    credentials: "include",
  });
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.text()).slice(0, 200); } catch { /* swallow */ }
    throw new Error(`Admin API error ${response.status}${detail ? " — " + detail : ""}`);
  }
  const ct = response.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return response.json() as Promise<T>;
  return response.text() as unknown as Promise<T>;
}

/** Binary download — bypasses JSON parsing (CSV/XLSX exports). */
export async function adminStreamDownload(path: string, filename: string): Promise<void> {
  const response = await fetch(`${API}${path}`, { headers: authHeaders(), credentials: "include" });
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4_000);
}
