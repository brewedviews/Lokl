"use client";

import Link from "next/link";
import { ProductCard } from "@/components/consumer/ProductCard";
import type { ProductCard as ProductCardType } from "@/types";

interface Props {
  women: ProductCardType[];
  men: ProductCardType[];
}

export function GenderFashionBand({ women, men }: Props) {
  if (women.length === 0 && men.length === 0) return null;

  return (
    <section
      className="my-6 mx-4 rounded-3xl bg-[#F4F6FB] shadow-[0_4px_20px_rgba(10,31,92,0.07)] overflow-hidden"
      data-testid="gender-fashion-band"
    >
      {/* Zone header */}
      <div className="px-4 sm:px-6 pt-5 pb-1">
        <div className="text-[10px] uppercase tracking-widest font-bold text-[#0A1F5C]/40 mb-0.5">
          Fashion
        </div>
        <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight">
          Find your fit
        </h2>
        <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
          Style picks from Bhilai stores, delivered fast
        </p>
      </div>

      {/* Women's sub-rail */}
      {women.length > 0 && (
        <div className="pt-4 pb-2">
          <div className="px-4 sm:px-6 flex items-center justify-between gap-3 mb-3">
            <h3 className="text-base sm:text-lg font-display font-bold tracking-tight text-[#0A1F5C] leading-tight">
              Women&apos;s Fashion
            </h3>
            <Link
              href="/c/women"
              className="text-xs font-bold text-[#F59E0B] shrink-0 underline-offset-4 hover:underline"
            >
              See all →
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-pl-4 sm:scroll-pl-6 px-4 sm:px-6 pb-1">
            {women.map((p) => (
              <div key={p.id} className="snap-start shrink-0 w-[38vw] sm:w-[180px] md:w-[200px]">
                <ProductCard p={p} size="default" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Men's sub-rail */}
      {men.length > 0 && (
        <div
          className={`pb-5 ${women.length > 0 ? "pt-4 border-t border-[#0A1F5C]/[0.06]" : "pt-4"}`}
        >
          <div className="px-4 sm:px-6 flex items-center justify-between gap-3 mb-3">
            <h3 className="text-base sm:text-lg font-display font-bold tracking-tight text-[#0A1F5C] leading-tight">
              Men&apos;s Fashion
            </h3>
            <Link
              href="/c/men"
              className="text-xs font-bold text-[#F59E0B] shrink-0 underline-offset-4 hover:underline"
            >
              See all →
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-pl-4 sm:scroll-pl-6 px-4 sm:px-6 pb-1">
            {men.map((p) => (
              <div key={p.id} className="snap-start shrink-0 w-[38vw] sm:w-[180px] md:w-[200px]">
                <ProductCard p={p} size="default" />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
