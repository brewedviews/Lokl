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
 * `h-24..h-32` image cards read as a second hero, not a nav strip. G6
 * pulls it back to the actual spec: the existing text-tab nav (routes/
 * active-state rule below unchanged, still exactly these three, other 6
 * L1s still reachable via the bottom nav's Categories tab) with a SMALL
 * image thumbnail added per tab, not full-bleed imagery. Each L1's own
 * `image` field (the same field `/api/categories` already returns —
 * reused verbatim, not a new image source) fills a small `rounded-lg`
 * (not circular — deliberately not reusing CategoryTile's "dense" avatar
 * treatment, which is a circle) thumbnail inside a slim pill tab. Active
 * state is still the same functional orange (`bg-[#E68910]`) as a small
 * bar under the active pill.
 *
 * Women is the default-active tab on Home specifically (there's no "All"
 * state to fall back to anymore) — `activeSlug` defaults to "women" when
 * the path isn't a /c/[slug] page at all (i.e. on Home, "/"), and reads
 * the real slug on every /c/[slug] page as before, including the L2
 * catch-all route (/c/{slug}/{l2}) — the L1 tab stays the active one
 * there too, unchanged from the pre-this-pass behavior.
 *
 * Still fetches /api/categories (React Query, key ["categories"], the same
 * cached request CategoryClient.tsx's own ["categories"] query reuses) —
 * only what's rendered from that response changed, not how it's fetched —
 * so real admin-configured names/images (in case "Women"/"Men"/"Kids" ever
 * change upstream) still drive the tabs rather than hardcoded values.
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
      <div className="w-full flex items-center gap-2 h-11 sm:h-12" data-testid="category-tile-row">
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
              className={`relative inline-flex items-center gap-2 pl-1.5 pr-3.5 py-1.5 rounded-full border transition-colors ${
                isActive ? "border-[#0A1F5C] bg-white" : "border-[#E5E2DC] bg-white"
              }`}
            >
              <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg overflow-hidden bg-[#E5E2DC] shrink-0">
                {cat?.image && (
                  <img
                    src={cat.image}
                    alt=""
                    loading="eager"
                    className={`w-full h-full object-cover object-top transition-[filter] duration-300 ${isActive ? "" : "brightness-90"}`}
                  />
                )}
              </span>
              <span className={`font-display text-sm sm:text-base tracking-tight ${isActive ? "font-bold text-[#0A1F5C]" : "font-semibold text-[#0A1F5C]/70"}`}>
                {label}
              </span>
              {isActive && <span className="absolute left-1/2 -translate-x-1/2 -bottom-[3px] w-6 h-[3px] rounded-full bg-[#E68910]" />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
