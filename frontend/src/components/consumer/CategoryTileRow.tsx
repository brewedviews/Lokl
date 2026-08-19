"use client";

/**
 * CategoryTileRow — the persistent L1 category tile strip shown on Home
 * and every /c/[slug] page. Mounted ONCE in (consumer)/(shop)/layout.tsx
 * — a route group scoped to just those two route trees (deliberately
 * narrower than (consumer)/layout.tsx, which wraps every consumer page
 * including cart/checkout/PDP/account, where a category-browsing strip
 * doesn't belong) — so it never remounts when navigating between them or
 * between two different L1s. Circular photo + label below, horizontal
 * scroll — the same tile shape the homepage's gender bento and a
 * /c/[slug] page's own "Shop by category" L2 grid already use.
 *
 * Fully self-contained by design, specifically so it can mount directly
 * in a server-component layout with zero props to wire up:
 *   - Fetches /api/categories via useQuery, key ["categories"] — React
 *     Query (already installed + provider-wrapped app-wide in
 *     providers.tsx, just never actually used anywhere until now) means
 *     this is automatically the SAME cached request CategoryClient.tsx's
 *     own ["categories"] query reuses, instead of two independent
 *     fetches of data that "only admin uploads change" (per the earlier
 *     structural audit) — a 5-minute staleTime reflects that low change
 *     frequency, well past the QueryClient's global 60s default.
 *   - Derives `activeSlug` from usePathname() rather than a prop — the
 *     one piece of state that genuinely is page-aware. Matches
 *     `/c/{slug}` (including the L2 catch-all route, `/c/{slug}/{l2}` —
 *     the L1 tile stays the active one there too) and anything else
 *     (Home, or any other path under this layout) resolves to undefined,
 *     i.e. no tile highlighted.
 *
 * "All" is always the first tile and always links to "/" (Home) — NOT
 * /products. An earlier version pointed it at /products (matching
 * Home's pre-unification tile row); user testing on the unified strip
 * called that wrong — tapping "All" from a category page should return
 * to Home, not drop you on a generic, differently-laid-out product list.
 *
 * pt-2 on the scroll container (not just the outer wrapper) matters more
 * than it looks: setting overflow-x to a non-visible value while
 * overflow-y is left at its default "visible" doesn't actually keep
 * overflow-y visible — per the CSS overflow spec, the browser computes
 * the other axis to "auto" too in that case. So this row was ALSO
 * clipping vertically, cutting off the selected tile's ring (ring-2 +
 * ring-offset-2 = 4px extending past the tile's own border-box) against
 * the scroll container's own top edge — not a z-index/stacking issue
 * with the header above it, just this row's own missing top padding
 * inside the very box that (as an unavoidable side effect of
 * overflow-x-auto) was already clipping on both axes.
 */
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { trackCategoryTileClick, trackCategoryTileImpression, observeImpression } from "@/lib/analytics";
import { CategoryTile } from "./CategoryTile";

export function CategoryTileRow() {
  const pathname = usePathname();
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.catalog.categories(),
    staleTime: 5 * 60_000,
  });

  const activeSlug = pathname?.match(/^\/c\/([^/]+)/)?.[1];

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-8 pt-3">
      <div className="w-full flex gap-4 overflow-x-auto no-scrollbar touch-pan-x pt-2 pb-2" data-testid="category-tile-row">
        {categories.length === 0 ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 flex flex-col items-center gap-1.5">
              <div className="w-16 h-16 rounded-full bg-[#E5E2DC] animate-pulse" />
              <div className="w-12 h-3 bg-[#E5E2DC] rounded animate-pulse" />
            </div>
          ))
        ) : (
          <>
            <CategoryTile
              href="/"
              label="All"
              testId="category-tile-all"
              circleClassName="bg-[#0A1F5C] border-0"
              fallback={
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                </svg>
              }
            />
            {categories.map((cat, catIdx) => {
              const isActive = activeSlug === cat.slug;
              return (
                <CategoryTile
                  key={cat.id}
                  href={`/c/${cat.slug}`}
                  onClick={() => { try { trackCategoryTileClick(cat.name, catIdx); } catch {} }}
                  tileRef={(el) => { if (el) { try { observeImpression(el, () => trackCategoryTileImpression(cat.name, catIdx)); } catch {} } }}
                  testId={`category-tile-${cat.slug}`}
                  active={isActive}
                  activeStyle="ring"
                  image={cat.image}
                  imageLoading={catIdx < 4 ? "eager" : "lazy"}
                  label={cat.name === "Lingerie & Innerwear" ? "Lingerie" : cat.name}
                  fallback={<span className="text-2xl">👗</span>}
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
