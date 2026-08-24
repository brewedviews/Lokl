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

export function BudgetBentoSection({ l1Id }: { l1Id?: string }) {
  const [bento, setBento] = useState<PriceBentoResponse | null>(null);

  useEffect(() => {
    api.catalog.priceBento().then(setBento).catch(() => {});
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid="home-under_499">
      <h2 className="font-display font-medium text-xl sm:text-2xl tracking-tight text-[#0A1F5C] leading-tight mb-4">Picks for Every Budget</h2>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {TILES.map((t) => {
          const image = bento?.[t.key] ?? null;
          return (
            <Link
              key={t.key}
              href={t.href(l1Id)}
              onClick={() => { try { trackPriceFilterClick(t.filter); } catch {} }}
              data-testid={`price-band-${t.key}`}
              className="group relative aspect-[4/5] sm:aspect-square rounded-card overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] transition-all active:scale-[0.98]"
            >
              {image ? (
                <img
                  src={cloudinaryOptimize(image, "w_500,q_auto,f_auto")}
                  alt={t.price}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0 bg-[#F4F1E9]" />
              )}
              <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 via-black/15 to-transparent pointer-events-none" />
              <span className="absolute bottom-3 left-3 right-3 font-display font-medium text-white text-base sm:text-lg leading-tight tracking-tight">
                {t.price.toUpperCase()}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
