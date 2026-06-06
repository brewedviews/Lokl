/**
 * Server-side fetch helper for SSR pages. Uses the FastAPI URL from env so
 * `next build` can statically pre-render product/store pages when the
 * underlying data is stable, and so RSC fetches don't go through the
 * client-side axios instance (which only ships browser-side).
 *
 * Returns `null` instead of throwing on 404 so SSR pages can call
 * notFound() cleanly.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";

export async function serverFetch<T>(
  path: string,
  init?: RequestInit & { revalidate?: number | false },
): Promise<T | null> {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const { revalidate = 60, ...rest } = init ?? {};
  try {
    const res = await fetch(url, {
      ...rest,
      next: revalidate === false ? undefined : { revalidate },
      cache: revalidate === false ? "no-store" : undefined,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`serverFetch ${path} -> ${res.status}`);
    }
    return (await res.json()) as T;
  } catch {
    // Fail-soft: surface as null so the calling page can decide to 404.
    return null;
  }
}
