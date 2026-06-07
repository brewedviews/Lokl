"use client";

/**
 * "Shop by category" tile grid on the home page.
 *
 * Per the Feb-26 home reorder spec, ONLY these six categories surface on
 * the home page. The other DB-seeded categories (streetwear, electronics,
 * sports) remain in the catalogue but are intentionally hidden here — the
 * client-side filter keeps them paused without touching the DB so they can
 * be re-enabled later by simply adding their slug to `VISIBLE_SLUGS`.
 *
 * Layout:
 *   • Mobile: 3 columns × 2 rows (grid-cols-3)
 *   • Desktop: 6 in a single row (md:grid-cols-6)
 *
 * Tiles link to /c/{slug} (the existing category landing pages).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { api } from "@/lib/api";
import { trackAssetClick } from "@/lib/api/admin";
import type { CategoryCount } from "@/types";

type CategoryRow = CategoryCount & { slug: string; id?: string; product_count?: number; redirect_url?: string };

// Display order + display name overrides. The spec spells "Beauty &
// Personal Care" but the DB row is just "Beauty" — we override here.
const VISIBLE: Array<{ slug: string; label: string }> = [
  { slug: "men", label: "Men" },
  { slug: "women", label: "Women" },
  { slug: "footwear", label: "Footwear" },
  { slug: "accessories", label: "Accessories" },
  { slug: "kids", label: "Kids" },
  { slug: "beauty", label: "Beauty & Personal Care" },
];

export function ShopByCategory() {
  const [byCat, setByCat] = useState<Map<string, CategoryRow>>(new Map());

  useEffect(() => {
    api.catalog.categoryCounts()
      .then((rows) => {
        const map = new Map<string, CategoryRow>();
        for (const r of rows as unknown as CategoryRow[]) map.set(r.slug, r);
        setByCat(map);
      })
      .catch(() => setByCat(new Map()));
  }, []);

  // Only render once we know we have at least one of the six — otherwise
  // skip silently to avoid a layout gap. This matches the testimonials rule.
  const hasAny = VISIBLE.some((v) => byCat.has(v.slug));
  if (!hasAny) return null;

  return (
    <section data-testid="shop-by-category" className="pt-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 mb-3">
        <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight">
          Shop by category
        </h2>
        <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">Find your fit across Bhilai&apos;s top picks.</p>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-8">
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4">
          {VISIBLE.map(({ slug, label }) => {
            const row = byCat.get(slug);
            const href = row?.redirect_url || `/c/${slug}`;
            return (
              <Link
                key={slug}
                href={href}
                onClick={() => void trackAssetClick("category", row?.id || slug, href)}
                data-testid={`home-cat-${slug}`}
                className="group bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-[0_2px_8px_rgba(10,31,92,0.06)] hover:shadow-md transition active:scale-95"
              >
                <div className="relative aspect-square bg-slate-100">
                  {row?.image ? (
                    <Image
                      src={row.image}
                      alt={label}
                      fill
                      sizes="(max-width: 768px) 33vw, 16vw"
                      className="object-cover group-hover:scale-105 transition duration-500"
                    />
                  ) : <div className="w-full h-full v2-shimmer" />}
                </div>
                <div className="text-center py-2 px-1">
                  <div className="text-[12px] font-bold text-[#0A1F5C] line-clamp-1">{label}</div>
                  {row?.product_count != null && row.product_count > 0 && (
                    <div className="text-[10px] text-[#64748B] mt-0.5">
                      {row.product_count.toLocaleString()} products
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
