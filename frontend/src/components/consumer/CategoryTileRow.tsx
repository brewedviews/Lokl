"use client";

/**
 * CategoryTileRow — the single shared L1 category tile strip, used both
 * on Home (as the mobile row of category_pills — the desktop portrait-
 * card grid there is a deliberately different, older treatment and is
 * untouched) and on every /c/[slug] page (CategoryClient, replacing the
 * now-deleted CategoryTabBar.tsx). One component, one place to change the
 * visual style, instead of two implementations styled to look alike.
 *
 * Circular photo + label below, horizontal scroll — the same tile shape
 * the homepage's gender bento and a /c/[slug] page's own "Shop by
 * category" L2 grid already use, extended here to the L1 row too so all
 * three category-tile surfaces in the app finally share one visual
 * language instead of three near-identical ones.
 *
 * "All" is always the first tile and always links to /products — this is
 * the one piece of behavior that does NOT depend on where the component
 * renders (Home vs. a category page). There's no "which page am I on"
 * branching for it the way the old CategoryTabBar had (Home used to
 * scroll-to-top, category pages used to go to "/") — /products is a
 * simpler, single, universal "no category filter" destination, and it's
 * what Home's own original tile row already pointed "All" at before any
 * of this L1-tab-bar work started, so this keeps that exact behavior
 * rather than reintroducing a page-aware branch.
 *
 * `activeSlug` is the one thing that IS page-aware, and it's opt-in: omit
 * it entirely on Home (no tile is ever "selected" there — matches Home's
 * original behavior, which never had a selected state at all) and pass
 * the route's L1 slug on a /c/[slug] page to ring-highlight the matching
 * tile — navy ring, white ring-offset (the gap between the photo and the
 * ring), bold navy label instead of the default gray one.
 */
import Link from "next/link";
import { trackCategoryTileClick, trackCategoryTileImpression, observeImpression } from "@/lib/analytics";

interface TileCategory { id: string; name: string; slug: string; image?: string }

export function CategoryTileRow({
  categories,
  activeSlug,
}: {
  categories: TileCategory[];
  /** The current /c/[slug] route's L1 slug — omit entirely on Home. */
  activeSlug?: string;
}) {
  return (
    <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2" data-testid="category-tile-row">
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
  );
}
