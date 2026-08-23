"use client";

/**
 * CategoryTileRow — the persistent L1 tab strip shown on Home and every
 * /c/[slug] page. Mounted ONCE in (consumer)/(shop)/layout.tsx — see that
 * file's own doc comment for why (a route group scoped to just Home + /c/
 * [slug], so it never remounts navigating between them or between two
 * different L1s).
 *
 * Redesign Phase B: collapsed from all 9 L1s (+ a prepended "All" tile,
 * circular-avatar style) down to exactly Women / Men / Kids, plain
 * text + underline — no photo, no circle, no "All" tile at all. This is a
 * genuinely new visual treatment for this component, not a filter applied
 * to the old avatar markup (see CategoryTile.tsx's "dense"/"generous"
 * variants for that — this row deliberately doesn't use either). The
 * other 6 L1s (Ethnic Wear, Footwear, Lingerie & Innerwear, Accessories,
 * Beauty, Sports) are no longer reachable from this strip — they're still
 * fully reachable via the bottom nav's Categories tab (/categories), which
 * lists all 9 in its own filled-tab treatment per the redesign plan's own
 * "tab styling is context-dependent" rule (3.8: the dedicated Categories
 * page keeps a more prominent treatment since it IS the primary content
 * there).
 *
 * Women is the default-active tab on Home specifically (there's no "All"
 * state to fall back to anymore) — `activeSlug` defaults to "women" when
 * the path isn't a /c/[slug] page at all (i.e. on Home, "/"), and reads
 * the real slug on every /c/[slug] page as before, including the L2
 * catch-all route (/c/{slug}/{l2}) — the L1 tab stays the active one
 * there too, unchanged from the pre-Phase-B behavior.
 *
 * Still fetches /api/categories (React Query, key ["categories"], the same
 * cached request CategoryClient.tsx's own ["categories"] query reuses) —
 * only what's rendered from that response changed, not how it's fetched —
 * so real admin-configured names (in case "Women"/"Men"/"Kids" ever change
 * upstream) still drive the tab labels rather than a hardcoded string.
 */
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { trackCategoryTileClick, trackCategoryTileImpression, observeImpression } from "@/lib/analytics";

// Fixed order + fallback labels (used only until the real /api/categories
// response resolves) — Women, Men, Kids, in that exact order, per the
// locked decision. Not derived from the backend's own `order` field
// (women=1, men=2, kids=6) since that would put Kids after 3 other L1s
// this strip no longer shows at all.
const PINNED_SLUGS = [
  { slug: "women", fallbackLabel: "Women" },
  { slug: "men", fallbackLabel: "Men" },
  { slug: "kids", fallbackLabel: "Kids" },
];

export function CategoryTileRow() {
  const pathname = usePathname();
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.catalog.categories(),
    staleTime: 5 * 60_000,
  });

  const activeSlug = pathname?.match(/^\/c\/([^/]+)/)?.[1] ?? "women";

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-8 pt-3">
      <div className="w-full flex items-center gap-6 border-b border-[#E5E2DC]" data-testid="category-tile-row">
        {PINNED_SLUGS.map(({ slug, fallbackLabel }, i) => {
          const cat = categories.find((c) => c.slug === slug);
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
              className={`relative pb-2.5 pt-1 text-sm transition-colors ${
                isActive ? "font-bold text-[#0A1F5C]" : "font-medium text-[#94A3B8] hover:text-[#0A1F5C]"
              }`}
            >
              {label}
              {isActive && <span className="absolute left-0 right-0 -bottom-px h-[2.5px] rounded-full bg-[#E68910]" />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
