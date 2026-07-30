"use client";

import Link from "next/link";
import { Heart, Plus } from "lucide-react";
import { toast } from "sonner";
import { useWishlistStore } from "@/stores";
import type { ProductCard as ProductCardType } from "@/types";

interface Props {
  product: ProductCardType;
  onAddToCart: (product: ProductCardType) => void;
}

/**
 * Discount-forward discovery tile for the "Find your fit" band — Blinkit
 * steal-deals visual language. Navigates to the PDP; the heart and "+"
 * buttons stop propagation so they act without leaving the rail.
 */
export function FashionTile({ product: p, onAddToCart }: Props) {
  const isWishlisted = useWishlistStore((s) => s.isWishlisted(p.id));
  const toggleWishlist = useWishlistStore((s) => s.toggle);

  const handleHeart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = toggleWishlist(p);
    const justAdded = next.some((x) => x.id === p.id);
    toast.success(justAdded ? "Saved to wishlist" : "Removed from wishlist");
  };

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onAddToCart(p);
  };

  return (
    <Link
      href={`/product/${p.id}`}
      data-testid={`fashion-tile-${p.id}`}
      className="block active:scale-[0.98] transition"
    >
      <div className="relative w-40 flex-shrink-0 bg-white rounded-2xl overflow-hidden border border-[#E5E2DC]">
        {/* Product image */}
        <div className="relative w-full aspect-[4/5] bg-slate-100">
          {p.image ? (
            <img src={p.image} alt={p.name} className="w-full h-full object-cover object-top" />
          ) : (
            <div className="w-full h-full v2-shimmer" />
          )}

          {/* Wishlist heart top-right */}
          <button
            type="button"
            aria-label="Wishlist"
            onClick={handleHeart}
            className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition active:scale-90 ${
              isWishlisted ? "bg-[#E68910] text-white" : "bg-white/80 text-[#595959]"
            }`}
          >
            <Heart size={14} fill={isWishlisted ? "currentColor" : "none"} />
          </button>

          {/* Add to cart "+" bottom-right overlapping */}
          <button
            type="button"
            aria-label="Add to cart"
            onClick={handleAdd}
            data-testid={`fashion-tile-add-${p.id}`}
            className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-[#0A1F5C] text-white flex items-center justify-center shadow-md hover:bg-[#E68910] transition-colors"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Info below image */}
        <div className="p-2.5">
          <p className="text-[11px] text-[#595959] truncate mb-1">{p.name}</p>

          {/* Price row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-[#0A1F5C] text-sm">₹{Number(p.price).toLocaleString("en-IN")}</span>
            {p.mrp && p.mrp > p.price && (
              <span className="text-[10px] text-[#9CA3AF] line-through">₹{Number(p.mrp).toLocaleString("en-IN")}</span>
            )}
          </div>

          {/* Discount badge — only when genuine discount exists */}
          {p.mrp && p.mrp > p.price && (
            <div className="mt-1 inline-flex items-center bg-[#0D6832] rounded-full px-2 py-0.5">
              <span className="text-[9px] font-bold text-white">
                ₹{Number(p.mrp - p.price).toLocaleString("en-IN")} off
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
