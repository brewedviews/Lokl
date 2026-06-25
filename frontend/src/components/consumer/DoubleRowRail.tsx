"use client";

import Link from "next/link";
import Image from "next/image";
import type { ProductCard } from "@/types";

interface Props {
  title: string;
  products: ProductCard[];
  viewAllHref?: string;
}

export function DoubleRowRail({ title, products, viewAllHref }: Props) {
  if (products.length === 0) return null;

  const useDoubleRow = products.length >= 6;

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
          style={{ gridAutoFlow: "column", gridAutoColumns: "140px" }}
        >
          {products.map((p) => {
            const discount =
              p.mrp && p.price && p.mrp > p.price
                ? Math.round((1 - p.price / p.mrp) * 100)
                : 0;
            return (
              <Link
                key={p.id}
                href={`/product/${p.id}`}
                className="block w-[140px] bg-white border border-[#E5E2DC] rounded-xl overflow-hidden hover:border-[#1A2B4C]/30 hover:shadow-sm transition active:scale-95"
              >
                <div className="relative w-full aspect-[3/4] bg-[#E5E2DC]">
                  {p.image ? (
                    <Image
                      src={p.image}
                      alt={p.name}
                      fill
                      sizes="140px"
                      loading="lazy"
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-[#E5E2DC]" />
                  )}
                  {discount > 0 && (
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-white/90 text-[#E68910] text-[9px] font-bold uppercase leading-none">
                      {discount}% off
                    </span>
                  )}
                </div>
                <div className="p-1.5">
                  <p className="text-[11px] font-semibold text-[#1A2B4C] leading-tight truncate">
                    {p.name}
                  </p>
                  <div className="flex items-baseline gap-1 mt-0.5 flex-wrap">
                    <span className="text-[12px] font-bold text-[#1A2B4C]">
                      ₹{Number(p.price).toLocaleString()}
                    </span>
                    {p.mrp && p.mrp > p.price && (
                      <span className="text-[10px] text-[#9CA3AF] line-through">
                        ₹{Number(p.mrp).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
