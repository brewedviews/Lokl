"use client";

/**
 * CategoryTabBar — slim horizontal L1 pill strip, always visible at the
 * very top of Home (mounted above the CMS-ranked sections in HomeClient,
 * not one of them — see HomeClient's own comment on why). Supersedes two
 * things:
 *
 *  - ShopByCategory.tsx (deleted): a full tile-grid "Shop by category"
 *    section that was written but never imported anywhere — dead code.
 *    Same underlying L1 data, but that was a heavy content section
 *    (large square photo tiles); this is navigation chrome, so the
 *    treatment here is a compact pill strip instead.
 *  - category_pills (removed from HomeClient's CMS section list): the old
 *    large 64px-avatar horizontal-scroll strip used to render as an
 *    ordinary CMS section (position: rank 10, i.e. already above the
 *    hero). Keeping both would have stacked two near-identical "pick a
 *    category" strips back to back — this replaces it outright rather
 *    than sitting alongside it.
 *
 * "All" is the first pill. Its meaning and click behavior depend on
 * whether this component is rendered on Home or on a /c/[slug] category
 * page — the `activeSlug` prop (omitted on Home) is what tells it which:
 *
 *  - Home (activeSlug omitted): "All" IS the active pill (there's no
 *    other page state it could represent), not a Link — tapping it just
 *    scrolls back to the top, a cheap escape hatch if the user has
 *    scrolled deep into the page.
 *  - A /c/[slug] page (activeSlug = the route's L1 slug, wired up by
 *    CategoryClient): the L1 pill matching activeSlug renders as active
 *    instead, "All" reverts to its plain inactive style, and tapping it
 *    navigates to Home (`router.push("/")`) — "All" always means "every
 *    category," which off Home means leaving this filtered page.
 *
 * Every other pill is real L1 category data (categories prop — the exact
 * same category list both Home (HomeClient's own /api/categories fetch)
 * and /c/[slug] (CategoryClient's own /api/categories fetch, already
 * needed there for other reasons) already have in hand; no fetch lives in
 * this component itself) navigating to /c/{slug}, the existing category
 * landing route used everywhere else in the app (product PDP related-
 * category links, the gender bento, etc.).
 *
 * Small circular avatar (24px) + label inline in a rounded-full pill —
 * keeps the old category_pills section's circular-photo visual language
 * (so this doesn't read as an unrelated new pattern) at a scale and shape
 * that actually reads as a tab/filter strip rather than a content grid.
 */
import { useRouter } from "next/navigation";
import { trackCategoryTileClick, trackCategoryTileImpression, observeImpression } from "@/lib/analytics";

// Deliberately looser than the full CategoryNode type (which requires an
// `l2` array) — this component only ever reads id/name/slug/image, and
// CategoryClient's own category fetch (a slightly different shape, `l2`
// optional there) needs to pass its state straight through without an
// unsafe cast.
interface TabCategory { id: string; name: string; slug: string; image?: string }

export function CategoryTabBar({
  categories,
  activeSlug,
}: {
  categories: TabCategory[];
  /** The current /c/[slug] route's L1 slug — omit entirely on Home. */
  activeSlug?: string;
}) {
  const router = useRouter();
  const onCategoryPage = !!activeSlug;

  const scrollToTop = () => {
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div
      data-testid="l1-tab-strip"
      className="bg-[#FDFBF7] border-b border-[#F0EFED]"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-2.5">
          <button
            type="button"
            onClick={onCategoryPage ? () => router.push("/") : scrollToTop}
            data-testid="category-tab-all"
            aria-current={onCategoryPage ? undefined : "page"}
            className={`flex-shrink-0 inline-flex items-center px-3.5 py-1.5 rounded-full text-[12px] font-bold whitespace-nowrap transition ${
              onCategoryPage
                ? "bg-white border border-[#E5E2DC] text-[#0A1F5C]"
                : "bg-[#0A1F5C] text-white"
            }`}
          >
            All
          </button>

          {categories.length === 0 ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 w-20 h-8 rounded-full bg-[#E5E2DC] animate-pulse" />
            ))
          ) : (
            categories.map((cat, catIdx) => {
              const isActive = activeSlug === cat.slug;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    try { trackCategoryTileClick(cat.name, catIdx); } catch {}
                    router.push(`/c/${cat.slug}`);
                  }}
                  ref={(el) => { if (el) { try { observeImpression(el, () => trackCategoryTileImpression(cat.name, catIdx)); } catch {} } }}
                  data-testid={`category-tab-${cat.slug}`}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 pl-1.5 pr-3 py-1.5 rounded-full border active:scale-95 transition ${
                    isActive
                      ? "bg-[#0A1F5C] border-[#0A1F5C] text-white"
                      : "bg-white border-[#E5E2DC] text-[#0A1F5C]"
                  }`}
                >
                  <span className="w-6 h-6 rounded-full overflow-hidden bg-[#FDFBF7] shrink-0">
                    {cat.image ? (
                      <img
                        src={cat.image}
                        alt=""
                        loading={catIdx < 4 ? "eager" : "lazy"}
                        className="w-full h-full object-cover object-top"
                      />
                    ) : (
                      <span className="w-full h-full block bg-[#E5E2DC]" />
                    )}
                  </span>
                  <span className="text-[12px] font-semibold whitespace-nowrap">
                    {cat.name === "Lingerie & Innerwear" ? "Lingerie" : cat.name}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
