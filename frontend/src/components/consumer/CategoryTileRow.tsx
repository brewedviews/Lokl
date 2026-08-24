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
 * Home (see MarketplaceHomeClient.tsx) — none of the three tabs are
 * "active" there; `activeSlug` is only ever set on a real /c/[slug] page
 * (including its L2 catch-all, /c/{slug}/{l2}), null on "/" itself.
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

  const activeSlug = pathname?.match(/^\/c\/([^/]+)/)?.[1] ?? null;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-8 pt-3">
      <div className="w-full flex items-center gap-5 h-9 sm:h-10" data-testid="category-tile-row">
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
              className="relative inline-flex items-center gap-1.5 h-full"
            >
              <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg overflow-hidden bg-[#E5E2DC] shrink-0">
                {cat?.image && (
                  <img
                    src={cat.image}
                    alt=""
                    loading="eager"
                    className={`w-full h-full object-cover object-top transition-[filter] duration-300 ${isActive ? "" : "brightness-90"}`}
                  />
                )}
              </span>
              <span className={`font-display text-sm sm:text-base tracking-tight ${isActive ? "font-bold text-[#0A1F5C]" : "font-semibold text-[#0A1F5C]/60"}`}>
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
