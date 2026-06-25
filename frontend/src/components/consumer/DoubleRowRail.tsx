"use client";

import Link from "next/link";
import { ProductCard } from "@/components/consumer/ProductCard";
import type { ProductCard as ProductCardType } from "@/types";

interface Props {
  title: string;
  products: ProductCardType[];
  viewAllHref?: string;
}

export function DoubleRowRail({ title, products, viewAllHref }: Props) {
  if (products.length === 0) return null;

  // 7 cards needed to fill both rows without a single orphaned top card.
  const useDoubleRow = products.length >= 7;

  return (
    <section className="pt-4 max-w-7xl mx-auto px-4 sm:px-6">
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#1A2B4C] leading-tight">
            {title}
          </h2>
          <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">Shop local, delivered fast</p>
        </div>
        {viewAllHref && (
          <Link href={viewAllHref} className="text-xs font-bold text-[#E68910] shrink-0 hover:underline">
            See all →
          </Link>
        )}
      </div>
      <div className="overflow-x-auto no-scrollbar pb-1">
        <div
          className={useDoubleRow ? "grid grid-rows-2 gap-2" : "grid grid-rows-1 gap-2"}
          style={{ gridAutoFlow: "column", gridAutoColumns: "160px" }}
        >
          {products.map((p) => (
            <div key={p.id} className="w-[160px]">
              <ProductCard p={p} size="compact" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
