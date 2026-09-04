"use client";

/**
 * CategoryTileRow — the persistent L1 tab strip shown on Home and every
 * /c/[slug] page. Mounted ONCE in (consumer)/(shop)/layout.tsx — see that
 * file's own doc comment for why (a route group scoped to just Home + /c/
 * [slug], so it never remounts navigating between them or between two
 * different L1s).
 *
 * Redesign Phase B collapsed this from all 9 L1s down to exactly
 * Women / Men / Kids as plain text + underline tabs. The visual-
 * refinement pass then went too far the other way — full-bleed
 * `h-24..h-32` image cards read as a second hero, not a nav strip; G6
 * pulled it back to a slim bordered-pill treatment (~44-48px) with a
 * small thumbnail. G7 goes one step further per the product brief's own
 * explicit ask — "closer to `Women   Men   Kids / ──`" — dropping the
 * pill background/border chrome entirely so this reads as plain
 * navigation tabs, not buttons: label + small `rounded-lg` (not
 * circular) thumbnail, active state is ONLY the orange underline now
 * (no border box). "Subtle imagery if useful" per the brief — thumbnail
 * kept since it's low-risk/already built, not because it's required.
 *
 * G7 — this strip no longer implies "/" IS Women's page. Before G7, Home
 * literally rendered Women's L1 content, so defaulting the active tab to
 * "women" on "/" was accurate. Now "/" is the gender-neutral Marketplace
 * Home (see MarketplaceHomeClient.tsx) — none of the three L1 tabs are
 * "active" there; `activeSlug` is only ever set on a real /c/[slug] page
 * (including its L2 catch-all, /c/{slug}/{l2}), null on "/" itself.
 *
 * G8 — added a 4th "All" tab (§4), pointing at "/" itself and active
 * exactly when `activeSlug` is null (i.e. the Marketplace Home) — makes
 * "you're on the discovery page, not a specific L1" explicit in the nav
 * itself rather than just "no tab happens to be highlighted." A small
 * grid icon (not a photo) since "All" has no single representative image.
 *
 * G11 §2/§5 — this strip must show on "/" and bare "/c/[slug]" but NOT on
 * an L2 product-listing route ("/c/[slug]/[l2slug]") — a PLP is
 * product-first, not a category-browsing surface. Uses
 * `useSelectedLayoutSegments()` rather than pathname regex-parsing: this
 * component is mounted directly inside (consumer)/(shop)/layout.tsx, so
 * the hook returns exactly the segments THAT LAYOUT'S OWN children
 * resolve to — `[]` on "/", `["c","women"]` on a bare L1, `["c","women",
 * "dresses"]` on an L2 PLP — which is the framework's own purpose-built
 * "how deep below this layout are we" signal, not a string pattern that
 * could drift from the actual route tree. `segments.length > 2` is the
 * one, precise "this is a PLP" check.
 *
 * Still fetches /api/categories (React Query, key ["categories"], the same
 * cached request CategoryClient.tsx's own ["categories"] query reuses) —
 * only what's rendered from that response changed, not how it's fetched —
 * so real admin-configured names (in case "Women"/"Men"/"Kids" ever change
 * upstream) still drive the tab labels rather than hardcoded values.
 *
 * G13 — dropped the per-tab thumbnail entirely (including "All"'s grid
 * icon): primarily typography-led per the redesign brief, no image boxes.
 * `cat.image` is no longer read for rendering; the query itself is kept
 * unchanged since `cat.name` (the label) still comes from it.
 */
import { useQuery } from "@tanstack/react-query";
import { useSelectedLayoutSegments } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { trackCategoryTileClick, trackCategoryTileImpression, observeImpression } from "@/lib/analytics";

// Fixed order + fallback labels (used only until the real /api/categories
// response resolves) — All, Women, Men, Kids, in that exact order, per the
// locked decision. "all" isn't a real L1 slug (no /c/all route, no category
// doc) — it's a synthetic tab pointing at "/" itself; handled separately
// from the other three below since it has no CategoryNode to look up an
// image/name from. Women/Men/Kids order is not derived from the backend's
// own `order` field (women=1, men=2, kids=6) since that would put Kids
// after 3 other L1s this strip no longer shows at all.
//
// Admin category visibility fix (2026-09): this list is a CURATION spec
// (which slugs to feature, in what order) — it is NOT a visibility
// override. Each entry is only ever rendered once the live /api/categories
// response has resolved AND actually contains a matching, non-paused
// category (see the `if (!cat && !isLoading) return null` check in the
// render loop below) — same "resolve against live data, skip if absent"
// pattern L1PageClient.tsx's WOMEN/MEN/KIDS_CATEGORY_TILES and
// MarketplaceHomeClient.tsx's MIXED_CATEGORY_TILES already use correctly.
// Before this fix, a slug missing from the live response still fell back
// to `fallbackLabel` and rendered anyway — the one place in the app that
// kept showing a category an admin had paused.
const PINNED_SLUGS = [
  { slug: "women", fallbackLabel: "Women" },
  { slug: "men", fallbackLabel: "Men" },
  { slug: "kids", fallbackLabel: "Kids" },
];

export function CategoryTileRow() {
  const segments = useSelectedLayoutSegments();
  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.catalog.categories(),
    staleTime: 5 * 60_000,
  });

  // segments: [] on "/", ["c", slug] on a bare L1, ["c", slug, l2, ...] on
  // an L2 PLP — see this file's own top comment for why this hook (not a
  // pathname string check) is the right tool here.
  const isPlpRoute = segments.length > 2;
  const activeSlug = segments[0] === "c" ? (segments[1] ?? null) : null;
  const isAllActive = segments.length === 0;

  if (isPlpRoute) return null;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-8 pt-3">
      <div className="w-full flex items-center gap-5 h-9 sm:h-10" data-testid="category-tile-row">
        <Link
          href="/"
          ref={(el) => { if (el) { try { observeImpression(el, () => trackCategoryTileImpression("All", -1)); } catch {} } }}
          onClick={() => { try { trackCategoryTileClick("All", -1); } catch {} }}
          data-testid="category-tab-all"
          aria-current={isAllActive ? "page" : undefined}
          className="relative inline-flex items-center gap-1.5 h-full"
        >
          <span className={`font-display font-medium text-sm sm:text-base tracking-tight ${isAllActive ? "text-[#0A1F5C]" : "text-[#0A1F5C]/60"}`}>
            All
          </span>
          {isAllActive && <span className="absolute left-0 right-0 -bottom-[1px] h-[2px] rounded-full bg-[#E68910]" />}
        </Link>
        {PINNED_SLUGS.map(({ slug, fallbackLabel }, i) => {
          const cat = categories.find((c) => c.slug === slug);
          // Admin category visibility is the single source of truth
          // (2026-09): /api/categories already excludes anything an admin
          // has paused. Before this fix, a missing `cat` here still fell
          // back to `fallbackLabel` and rendered the tab anyway — the one
          // place in the app that ignored a paused category. While the
          // live query is still loading, `categories` is `[]` and every
          // tab would momentarily vanish; fall back to the label (not a
          // skip) ONLY during that initial load so first paint isn't a gap
          // where "All" is alone, but never fall back once the query has
          // actually resolved and confirmed this slug isn't there.
          if (!cat && !isLoading) return null;
          const label = cat?.name ?? fallbackLabel;
          const isActive = activeSlug === slug;
          return (
            <Link
              key={slug}
              href={`/c/${slug}`}
              ref={(el) => { if (el) { try { observeImpression(el, () => trackCategoryTileImpression(label, i)); } catch {} } }}
              onClick={() => { try { trackCategoryTileClick(label, i); } catch {} }}
              data-testid={`category-tab-${slug}`}
              aria-current={isActive ? "page" : undefined}
              className="relative inline-flex items-center gap-1.5 h-full"
            >
              <span className={`font-display font-medium text-sm sm:text-base tracking-tight ${isActive ? "text-[#0A1F5C]" : "text-[#0A1F5C]/60"}`}>
                {label}
              </span>
              {isActive && <span className="absolute left-0 right-0 -bottom-[1px] h-[2px] rounded-full bg-[#E68910]" />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
