"use client";

/**
 * BudgetBentoSection — "Picks for Every Budget" (G8, replaces the old
 * "Shop by Price" 3-card asymmetric rail). A 2x2 editorial bento — four
 * large photo cards (Under ₹499 / Under ₹999 / Under ₹1,499 / Premium),
 * minimal text, no pills/CTA chrome, matching the Quickeee reference's
 * "large photography does most of the work" direction.
 *
 * One component, reused by both surfaces (§12) — `l1Id` is optional:
 * omitted on the Marketplace Home (mixed marketplace destinations),
 * passed by each L1 page (scoped destinations, same component/visuals).
 * Self-fetches `api.catalog.priceBento()` (unchanged endpoint, now
 * returns a 4th `premium` key — see server.py's feed_price_bento).
 *
 * G15 — `interactive` (default true): the public coming-soon page reuses
 * this section as a visual preview only, before `/products?price=...`
 * is a real shopping destination for a visitor. `false` renders each tile
 * as a plain non-navigating `div` instead of a `Link`, same classes
 * otherwise. Every existing caller omits it and is unaffected.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { cloudinaryOptimize } from "@/lib/utils";
import { trackPriceFilterClick } from "@/lib/analytics";
import type { PriceBentoResponse } from "@/types";

const TILES = [
  { key: "under_499" as const,  price: "Under ₹499",   href: (l1?: string) => `/products?price=under-499${l1 ? `&l1=${l1}` : ""}`,  filter: "under_499" as const },
  { key: "under_999" as const,  price: "Under ₹999",   href: (l1?: string) => `/products?price=under-999${l1 ? `&l1=${l1}` : ""}`,  filter: "under_999" as const },
  { key: "under_1499" as const, price: "Under ₹1,499", href: (l1?: string) => `/products?price=under-1499${l1 ? `&l1=${l1}` : ""}`, filter: "under_1499" as const },
  { key: "premium" as const,    price: "Premium",      href: (l1?: string) => `/products?sort=price_desc${l1 ? `&l1=${l1}` : ""}`,   filter: "under_1499" as const },
];

export function BudgetBentoSection({ l1Id, interactive = true }: { l1Id?: string; interactive?: boolean }) {
  const [bento, setBento] = useState<PriceBentoResponse | null>(null);
  // G13 §10 — l1Id arrives as the category id ("l1-women"); the CMS/API
  // side keys L1 overrides by the bare slug ("women") instead, since that's
  // the vocabulary PRICE_BAND_L1_SLUGS and the admin editor's tabs already
  // use. Marketplace passes no l1Id at all, so l1Slug stays undefined there
  // (global set, unchanged behavior).
  const l1Slug = l1Id?.replace(/^l1-/, "");

  useEffect(() => {
    api.catalog.priceBento(l1Slug).then(setBento).catch(() => {});
  }, [l1Slug]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid="home-under_499">
      <h2 className="font-display font-medium text-xl sm:text-2xl tracking-tight text-[#0A1F5C] leading-tight mb-4">Picks for Every Budget</h2>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {TILES.map((t) => {
          const image = bento?.[t.key] ?? null;
          const tileClassName = "group relative aspect-[4/5] sm:aspect-square rounded-card overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] transition-all active:scale-[0.98]";
          const tileContent = (
            <>
              {image ? (
                <>
                  <img
                    src={cloudinaryOptimize(image, "w_500,q_auto,f_auto")}
                    alt={t.price}
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
                  />
                  {/* G13 — strengthened from black/60→15 over h-1/2 to
                      black/75→25 over h-3/5: labels were reported hard to
                      read against brighter photography. Text stays
                      overlaid on the image (no white box), just given a
                      darker, slightly taller scrim plus a drop-shadow as a
                      second line of contrast. Only rendered when there's a
                      real photo underneath — the flat cream fallback below
                      uses dark text directly, so it never needs a scrim. */}
                  <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/75 via-black/25 to-transparent pointer-events-none" />
                  <span className="absolute bottom-3 left-3 right-3 font-display font-medium text-white text-base sm:text-lg leading-tight tracking-tight [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
                    {t.price.toUpperCase()}
                  </span>
                </>
              ) : (
                <>
                  <div className="absolute inset-0 bg-[#F4F1E9]" />
                  <span className="absolute bottom-3 left-3 right-3 font-display font-medium text-[#0A1F5C] text-base sm:text-lg leading-tight tracking-tight">
                    {t.price.toUpperCase()}
                  </span>
                </>
              )}
            </>
          );
          return interactive ? (
            <Link
              key={t.key}
              href={t.href(l1Id)}
              onClick={() => { try { trackPriceFilterClick(t.filter); } catch {} }}
              data-testid={`price-band-${t.key}`}
              className={tileClassName}
            >
              {tileContent}
            </Link>
          ) : (
            <div key={t.key} data-testid={`price-band-${t.key}`} className={tileClassName}>
              {tileContent}
            </div>
          );
        })}
      </div>
    </div>
  );
}
