"use client";

import Link from "next/link";
import type { ProductCard as ProductCardType } from "@/types";

interface Props {
  product: ProductCardType;
}

/**
 * Compact, image-led discovery card for the "Find your fit" gender rows.
 * Pure doorway to the PDP — no cart/wishlist actions live here, those
 * belong on the product page.
 */
export function FashionTile({ product: p }: Props) {
  const discount =
    p.mrp && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;

  return (
    <Link
      href={`/product/${p.id}`}
      data-testid={`fashion-tile-${p.id}`}
      className="block flex-shrink-0 w-[130px] sm:w-[140px] active:scale-[0.97] transition"
    >
      <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-slate-100">
        {p.image ? (
          <img src={p.image} alt={p.name} className="w-full h-full object-cover object-top" />
        ) : (
          <div className="w-full h-full v2-shimmer" />
        )}
        {discount > 0 && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-white/90 text-[#E68910] text-[9px] font-bold uppercase leading-none">
            {discount}% off
          </span>
        )}
      </div>

      <div className="pt-1.5 space-y-0.5">
        <div className="text-[11px] font-semibold text-[#0A1F5C] leading-tight truncate">{p.name}</div>
        <div className="flex items-baseline gap-1 flex-wrap">
          <span className="text-[12px] font-bold text-[#0A1F5C]">₹{Number(p.price).toLocaleString("en-IN")}</span>
          {p.mrp && p.mrp > p.price && (
            <span className="text-[10px] text-[#9CA3AF] line-through">₹{Number(p.mrp).toLocaleString("en-IN")}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
