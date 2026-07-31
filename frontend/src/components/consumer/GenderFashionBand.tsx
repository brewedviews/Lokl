"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { FashionTile } from "@/components/consumer/FashionTile";
import type { ProductCard as ProductCardType, CategoryNode } from "@/types";

const L1_ORDER = ["l1-women", "l1-men", "l1-footwear"] as const;

const L1_META: Record<(typeof L1_ORDER)[number], { label: string; descriptor: string; slug: string }> = {
  "l1-women":    { label: "Women's Fashion", descriptor: "Dresses, tops, denim",       slug: "women" },
  "l1-men":      { label: "Men's Fashion",   descriptor: "Shirts, jeans, tees",        slug: "men" },
  "l1-footwear": { label: "Footwear",        descriptor: "Sneakers, sandals, formals", slug: "footwear" },
};

interface Props {
  categories: CategoryNode[];
}

/**
 * "Find your fit" — banner-led editorial zone. Each gender gets its own
 * navy doorway banner (headline + descriptor + "See all") with a compact
 * product row directly beneath it. Stacked, not tabbed — all visible on
 * scroll. Prefetches all three L1 rails on mount; a gender block (banner
 * + row) only renders if that L1 has products, and the whole zone
 * collapses if none do.
 */
export function GenderFashionBand({ categories }: Props) {
  const [productsByL1, setProductsByL1] = useState<Partial<Record<string, ProductCardType[]>>>({});

  useEffect(() => {
    L1_ORDER.forEach(async (l1Id) => {
      try {
        const r = await apiClient.get<{ products: ProductCardType[] }>(`/api/feed/gender-rail?l1=${l1Id}`);
        const products = r.data?.products ?? [];
        if (products.length > 0) {
          setProductsByL1((prev) => ({ ...prev, [l1Id]: products }));
        }
      } catch {
        // silent — block just omits this L1
      }
    });
  }, []);

  const availableL1s = L1_ORDER.filter((id) => (productsByL1[id]?.length ?? 0) > 0);
  if (availableL1s.length === 0) return null;

  const bannerImage = (id: string) => categories.find((c) => c.id === id)?.image;

  return (
    <div className="pt-8 px-4 sm:px-6">
      <section className="max-w-7xl mx-auto bg-[#EEF1F7] rounded-3xl overflow-hidden pt-5 pb-5" data-testid="gender-fashion-band">
        <div className="text-center px-4 pb-4">
          <p className="text-[10px] font-bold text-[#E68910] uppercase tracking-[0.15em] mb-1">Fashion</p>
          <h2 className="font-display font-bold text-[#0A1F5C] text-xl leading-tight">Find your fit</h2>
        </div>

        <div className="space-y-5">
          {availableL1s.map((id) => {
            const meta = L1_META[id];
            const products = productsByL1[id] ?? [];
            const image = bannerImage(id);

            return (
              <div key={id} data-testid={`fit-block-${id}`}>
                {/* Banner — the doorway. Text always lives on the solid
                    navy flex-1 panel; the photo is a separate sibling
                    panel, so the two can never share pixels. */}
                <Link href={`/c/${meta.slug}`} className="block group px-4 sm:px-6">
                  <div className="flex items-stretch bg-[#0A1F5C] rounded-2xl overflow-hidden min-h-[104px]">
                    <div className="flex-1 min-w-0 px-4 py-4 flex flex-col justify-center gap-1">
                      <h3 className="font-display font-bold text-white text-lg leading-tight">{meta.label}</h3>
                      <p className="text-white/70 text-xs leading-snug">{meta.descriptor}</p>
                      <span className="mt-1 inline-flex items-center gap-1 text-[#F59E0B] text-xs font-bold group-hover:underline underline-offset-4">
                        See all →
                      </span>
                    </div>
                    {image && (
                      <div className="relative w-[34%] shrink-0">
                        <img src={image} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-r from-[#0A1F5C] via-[#0A1F5C]/35 to-transparent" />
                      </div>
                    )}
                  </div>
                </Link>

                {/* Product row — tight gap under the banner, no dead space. */}
                <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 sm:px-6 pt-2.5">
                  {products.map((p) => (
                    <FashionTile key={p.id} product={p} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
