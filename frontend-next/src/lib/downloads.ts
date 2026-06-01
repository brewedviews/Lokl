/**
 * Binary file-stream downloads.
 *
 * These endpoints return CSV / XLSX bodies, NOT JSON. They intentionally
 * bypass `lib/api-client.ts` (the axios singleton) — see the CARVE-OUTS
 * comment in that file. Do NOT migrate these to axios.
 *
 * Auth token is passed in explicitly rather than read from the Zustand store
 * so callers (React Query hooks, server-rendered admin pages, etc.) stay in
 * control of which scope's token they're sending.
 */

async function streamDownload(
  path: string,
  filename: string,
  token: string | null,
): Promise<void> {
  const baseURL = process.env.NEXT_PUBLIC_API_URL ?? "";
  const headers: HeadersInit = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${baseURL}${path}`, {
    headers,
    credentials: "include",   // refresh cookie travels for 401-rescue scenarios
  });

  if (!response.ok) {
    // Try to surface a useful message — these endpoints occasionally return
    // a small JSON error body even though success bodies are binary.
    let detail = "";
    try {
      const text = await response.text();
      detail = text.slice(0, 200);
    } catch {
      /* swallow */
    }
    throw new Error(`Download failed: ${response.status}${detail ? " — " + detail : ""}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 4_000);
}

export const downloads = {
  /** Merchant analytics report for a given window (7d / 30d / 90d / all). */
  merchantAnalyticsCsv: (period: string, token: string | null): Promise<void> =>
    streamDownload(
      `/api/merchant/analytics/report.csv?period=${encodeURIComponent(period)}`,
      `lokl-analytics-${period}.csv`,
      token,
    ),

  /** Empty XLSX template the merchant fills in for bulk product upload. */
  merchantProductsTemplate: (token: string | null): Promise<void> =>
    streamDownload(
      "/api/merchant/products/template.xlsx",
      "lokl-products-template.xlsx",
      token,
    ),

  /** Admin-only export of pending KYC approvals. */
  adminApprovalsCsv: (token: string | null): Promise<void> =>
    streamDownload(
      "/api/admin/export/approvals.csv",
      "lokl-approvals.csv",
      token,
    ),
};
