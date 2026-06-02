"use client";

/**
 * 80% image / 20% content product card — ported from CRA `ProductCardV2.jsx`.
 * Sources cart state from `useCartStore` and wishlist state from `useWishlistStore`.
 *
 * Single-store cart rule: the Zustand store returns `{success:false, conflict}`
 * when an add crosses store boundaries. We surface that as a toast and bail.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Heart, Plus, Minus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { ProductBadge } from "./ProductBadge";
import { useCartStore, useWishlistStore } from "@/stores";
import type { ProductCard as ProductCardType } from "@/types";

type AnyProduct = ProductCardType & {
  sizes?: string[];
  store_eta_min?: number | null;
  eta_min?: number | null;
  badge?: string;
  low_stock_size?: string;
  social_proof?: string;
};

interface Props {
  p: AnyProduct;
  compact?: boolean;
}

export function ProductCardV2({ p, compact = false }: Props) {
  const isWishlisted = useWishlistStore((s) => s.isWishlisted(p.id));
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  const items = useCartStore((s) => s.items);
  const addItem = useCartStore((s) => s.addItem);
  const updateQty = useCartStore((s) => s.updateQty);

  // local hydration to avoid SSR/CSR flicker on the heart
  const [wished, setWished] = useState(false);
  useEffect(() => { setWished(isWishlisted); }, [isWishlisted]);

  const inCart = items.find((i) => i.id === p.id);
  const qty = inCart?.qty ?? 0;
  const discount = p.mrp && p.price && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  const eta = p.store_eta_min ?? p.eta_min ?? 45;
  const sizes = (p.sizes ?? []).slice(0, 4);

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const defaultSize = p.sizes?.[0] ?? "";
    const r = addItem(p, defaultSize);
    if (!r.success && r.conflict) {
      toast.error(`Your bag already has items from ${r.conflict.existing_store_name}. Clear the bag to switch stores.`);
      return;
    }
    toast.success(`${p.name} added`);
  };

  const handleStep = (e: React.MouseEvent, delta: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!inCart) return;
    updateQty(inCart.id, inCart.size ?? "", qty + delta);
  };

  const handleHeart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = toggleWishlist(p);
    const justAdded = next.some((x) => x.id === p.id);
    setWished(justAdded);
    toast.success(justAdded ? "Saved to wishlist" : "Removed from wishlist");
  };

  return (
    <div className="group relative bg-white rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] hover:shadow-[0_8px_24px_rgba(10,31,92,0.12)] transition" data-testid={`p-card-${p.id}`}>
      <Link href={`/product/${p.id}`} className="block active:scale-[0.98] transition">
        <div className="relative aspect-[4/5] bg-slate-100 overflow-hidden">
          {p.image ? (
            <Image
              src={p.image}
              alt={p.name}
              fill
              sizes="(max-width: 640px) 42vw, 220px"
              loading="lazy"
              className="object-cover group-hover:scale-105 transition duration-500"
            />
          ) : (
            <div className="w-full h-full v2-shimmer" />
          )}
          <ProductBadge kind={p.badge} className="absolute top-2 left-2" />
          <button
            type="button"
            aria-label="Wishlist"
            onClick={handleHeart}
            className={`absolute top-2 right-2 w-9 h-9 rounded-full grid place-items-center backdrop-blur-md transition active:scale-90 ${wished ? "bg-[#F59E0B] text-white" : "bg-white/85 text-[#0A1F5C]"}`}
          >
            <Heart size={15} fill={wished ? "currentColor" : "none"} strokeWidth={2.2} />
          </button>
          {discount > 0 && (
            <span className="absolute bottom-2 left-2 px-2 py-1 rounded-md bg-white/90 text-[#EF4444] text-[10px] font-bold uppercase tracking-wide">{discount}% off</span>
          )}
        </div>
        <div className="p-2 pb-1 space-y-0.5">
          {!compact && (
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] line-clamp-1">{p.store_name || "Lokl Store"}</div>
          )}
          <div className="text-[12px] font-semibold text-[#0F172A] line-clamp-1">{p.name}</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-bold text-[#0A1F5C]">₹{Number(p.price).toLocaleString()}</span>
            {p.mrp && p.mrp > p.price && <span className="text-[11px] text-[#94A3B8] line-through">₹{Number(p.mrp).toLocaleString()}</span>}
          </div>
          {compact ? (
            p.low_stock_size ? <div className="text-[10px] font-semibold text-[#EF4444]">{p.low_stock_size}</div> : null
          ) : p.low_stock_size ? (
            <div className="text-[10px] font-semibold text-[#EF4444]">{p.low_stock_size}</div>
          ) : p.social_proof ? (
            <div className="text-[10px] text-[#64748B]">{p.social_proof}</div>
          ) : (
            <div className="text-[10px] text-[#64748B]">⚡ {eta} min · {sizes.length ? sizes.slice(0, 3).join(" · ") : "All sizes"}</div>
          )}
        </div>
      </Link>
      <div className="px-2 pb-2.5">
        {qty === 0 ? (
          <button
            onClick={handleAdd}
            data-testid={`p-card-add-${p.id}`}
            className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-full bg-[#F59E0B] text-white text-[12px] font-bold active:scale-95 transition shadow-[0_4px_12px_rgba(245,158,11,0.32)]"
          >
            <ShoppingBag size={13} /> Add
          </button>
        ) : (
          <div className="flex items-center justify-between gap-1 py-1 px-1 rounded-full bg-[#F59E0B] text-white" data-testid={`p-card-qty-${p.id}`}>
            <button onClick={(e) => handleStep(e, -1)} aria-label="Decrease" data-testid={`qty-dec-${p.id}`} className="w-6 h-6 rounded-full bg-white/20 hover:bg-white/30 grid place-items-center active:scale-90">
              <Minus size={12} />
            </button>
            <span className="text-[12px] font-bold flex-1 text-center">{qty}</span>
            <button onClick={(e) => handleStep(e, 1)} aria-label="Increase" data-testid={`qty-inc-${p.id}`} className="w-6 h-6 rounded-full bg-white/20 hover:bg-white/30 grid place-items-center active:scale-90">
              <Plus size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
