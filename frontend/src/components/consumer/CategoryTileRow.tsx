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
 *   - Fetches its own /api/categories (GET /api/categories via
 *     api.catalog.categories()) — since this component now lives in the
 *     shared layout rather than being handed data from whichever page
 *     happens to render it, and it mounts exactly once per session
 *     (not per navigation), this is a single fetch for the tile strip's
 *     entire lifetime, not a duplicate per-page cost like it would be if
 *     the old per-page prop-passing pattern still applied.
 *   - Derives `activeSlug` from usePathname() rather than a prop — the
 *     one piece of state that genuinely is page-aware. Matches
 *     `/c/{slug}` (including the L2 catch-all route, `/c/{slug}/{l2}` —
 *     the L1 tile stays the active one there too) and anything else
 *     (Home, or any other path under this layout) resolves to undefined,
 *     i.e. no tile highlighted.
 *
 * "All" is always the first tile and always links to /products.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { trackCategoryTileClick, trackCategoryTileImpression, observeImpression } from "@/lib/analytics";

interface TileCategory { id: string; name: string; slug: string; image?: string }

export function CategoryTileRow() {
  const pathname = usePathname();
  const [categories, setCategories] = useState<TileCategory[]>([]);

  useEffect(() => {
    api.catalog.categories().then((r) => setCategories(r)).catch(() => {});
  }, []);

  const activeSlug = pathname?.match(/^\/c\/([^/]+)/)?.[1];

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-8 pt-3">
      <div className="w-full flex gap-4 overflow-x-auto no-scrollbar touch-pan-x pb-2" data-testid="category-tile-row">
        {categories.length === 0 ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 flex flex-col items-center gap-1.5">
              <div className="w-16 h-16 rounded-full bg-[#E5E2DC] animate-pulse" />
              <div className="w-12 h-3 bg-[#E5E2DC] rounded animate-pulse" />
            </div>
          ))
        ) : (
          <>
            <Link
              href="/products"
              data-testid="category-tile-all"
              className="flex-shrink-0 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <div className="w-16 h-16 rounded-full bg-[#0A1F5C] flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                </svg>
              </div>
              <span className="text-[11px] font-semibold text-[#0A1F5C] text-center">All</span>
            </Link>
            {categories.map((cat, catIdx) => {
              const isActive = activeSlug === cat.slug;
              return (
                <Link
                  key={cat.id}
                  href={`/c/${cat.slug}`}
                  onClick={() => { try { trackCategoryTileClick(cat.name, catIdx); } catch {} }}
                  ref={(el) => { if (el) { try { observeImpression(el, () => trackCategoryTileImpression(cat.name, catIdx)); } catch {} } }}
                  data-testid={`category-tile-${cat.slug}`}
                  aria-current={isActive ? "page" : undefined}
                  className="flex-shrink-0 flex flex-col items-center gap-1.5 active:scale-95 transition"
                >
                  <div
                    className={`w-16 h-16 rounded-full overflow-hidden bg-[#FDFBF7] transition ${
                      isActive
                        ? "ring-2 ring-[#0A1F5C] ring-offset-2 ring-offset-white"
                        : "border border-[#E5E2DC]"
                    }`}
                  >
                    {cat.image ? (
                      <img
                        src={cat.image}
                        alt={cat.name}
                        loading={catIdx < 4 ? "eager" : "lazy"}
                        className="w-full h-full object-cover object-top"
                      />
                    ) : (
                      <div className="w-full h-full bg-[#E5E2DC] flex items-center justify-center">
                        <span className="text-2xl">👗</span>
                      </div>
                    )}
                  </div>
                  <span className={`text-[11px] font-semibold text-center w-16 leading-tight line-clamp-2 ${
                    isActive ? "text-[#0A1F5C]" : "text-[#0A1F5C]/80"
                  }`}>
                    {cat.name === "Lingerie & Innerwear" ? "Lingerie" : cat.name}
                  </span>
                </Link>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
