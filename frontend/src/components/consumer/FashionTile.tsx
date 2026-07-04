"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { useWishlistStore } from "@/stores";
import type { ProductCard as ProductCardType } from "@/types";

interface Props {
  p: ProductCardType;
}

/**
 * Compact image-led discovery tile for the "Find your fit" fashion band.
 * Deliberately drops store name / ETA / Add-to-Cart — it's a doorway to the
 * PDP, not a mini checkout. Keeps discount badge + wishlist heart only.
 */
export function FashionTile({ p }: Props) {
  const isWishlisted = useWishlistStore((s) => s.isWishlisted(p.id));
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  const [wished, setWished] = useState(false);
  useEffect(() => { setWished(isWishlisted); }, [isWishlisted]);

  const discount =
    p.mrp && p.price && p.mrp > p.price
      ? Math.round((1 - p.price / p.mrp) * 100)
      : 0;

  const handleHeart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = toggleWishlist(p);
    const justAdded = next.some((x) => x.id === p.id);
    setWished(justAdded);
    toast.success(justAdded ? "Saved to wishlist" : "Removed from wishlist");
  };

  return (
    <Link
      href={`/product/${p.id}`}
      data-testid={`fashion-tile-${p.id}`}
      className="group block active:scale-[0.97] transition"
    >
      <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-slate-100">
        {p.image ? (
          <Image
            src={p.image}
            alt={p.name}
            fill
            sizes="150px"
            loading="lazy"
            className="object-cover object-top group-hover:scale-105 transition duration-500"
          />
        ) : (
          <div className="w-full h-full v2-shimmer" />
        )}

        {discount > 0 && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-white/90 text-[#E68910] text-[9px] font-bold uppercase leading-none">
            {discount}% off
          </span>
        )}

        <button
          type="button"
          aria-label="Wishlist"
          onClick={handleHeart}
          className={`absolute top-1.5 right-1.5 w-7 h-7 rounded-full grid place-items-center backdrop-blur-md transition active:scale-90 ${
            wished ? "bg-[#E68910] text-white" : "bg-white/85 text-[#0A1F5C]"
          }`}
        >
          <Heart size={12} fill={wished ? "currentColor" : "none"} strokeWidth={2.2} />
        </button>
      </div>

      {/* Caption — name + price only, no store/ETA/cart */}
      <div className="pt-1.5 space-y-0.5">
        <div className="text-[11px] font-semibold text-[#0A1F5C] leading-tight truncate">
          {p.name}
        </div>
        <div className="flex items-baseline gap-1 flex-wrap">
          <span className="text-[12px] font-bold text-[#0A1F5C]">
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
}
