"use client";

/**
 * CategoryTileRow — the persistent L1 tab strip shown on Home and every
 * /c/[slug] page. Mounted ONCE in (consumer)/(shop)/layout.tsx — see that
 * file's own doc comment for why (a route group scoped to just Home + /c/
 * [slug], so it never remounts navigating between them or between two
 * different L1s).
 *
 * Redesign Phase B collapsed this from all 9 L1s down to exactly
 * Women / Men / Kids as plain text + underline tabs. This visual-
 * refinement pass keeps that same collapse (still exactly these three,
 * still the same routes/active-state rule below — the other 6 L1s stay
 * reachable via the bottom nav's Categories tab, unchanged) but replaces
 * the text-tab treatment with image-led navigation: each L1's own
 * `image` field (the same field `/api/categories` already returns and
 * the desktop category_pills grid in L1PageClient.tsx already renders
 * with `object-cover object-top` — reused verbatim here, not a new image
 * source) fills a flex-1 segment, all three sitting edge-to-edge inside
 * one rounded container so the strip reads as ONE seamless band rather
 * than three separate image cards. Active state is the same orange bar
 * the old text-tab treatment used (`bg-[#E68910]`), now along the
 * segment's bottom edge instead of under a text label, plus a lighter
 * dim overlay on the inactive two so the active segment reads as
 * brighter/selected without a heavy border.
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
      <div
        className="w-full flex items-stretch rounded-2xl overflow-hidden h-24 sm:h-28 lg:h-32"
        data-testid="category-tile-row"
      >
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
              className="group relative flex-1 min-w-0 bg-[#E5E2DC]"
            >
              {cat?.image && (
                <img
                  src={cat.image}
                  alt=""
                  loading="eager"
                  className={`absolute inset-0 w-full h-full object-cover object-top transition-[filter,transform] duration-300 ${
                    isActive ? "" : "brightness-[0.78] saturate-[0.85]"
                  } group-hover:scale-105`}
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
              <span
                className={`absolute inset-x-0 bottom-0 pb-2.5 text-center font-display font-bold text-sm sm:text-base text-white tracking-tight transition-opacity ${
                  isActive ? "opacity-100" : "opacity-85"
                }`}
              >
                {label}
              </span>
              {isActive && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-[#E68910]" />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
