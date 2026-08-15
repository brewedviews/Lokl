"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Heart, Plus, Minus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { useCartStore, useWishlistStore } from "@/stores";
import { useMounted } from "@/hooks/useMounted";
import { useDeliveryEta } from "@/hooks/useDeliveryEta";
import { useStoreConflict } from "@/hooks/useStoreConflict";
import { StoreConflictDialog } from "./StoreConflictDialog";
import type { ProductCard as ProductCardType } from "@/types";

type AnyProduct = ProductCardType & {
  sizes?: string[];
  store_eta_min?: number | null;
  eta_min?: number | null;
  store_distance_km?: number | null;
  distance_km?: number | null;
  badge?: string;
  low_stock_size?: string;
  social_proof?: string;
};

interface Props {
  p: AnyProduct;
  size?: "default" | "compact";
}

export function ProductCard({ p, size = "default" }: Props) {
  const isCompact = size === "compact";
  const mounted = useMounted();
  const isWishlisted = useWishlistStore((s) => s.isWishlisted(p.id));
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  const items = useCartStore((s) => s.items);
  const addItem = useCartStore((s) => s.addItem);
  const updateQty = useCartStore((s) => s.updateQty);

  const [wished, setWished] = useState(false);
  useEffect(() => { setWished(isWishlisted); }, [isWishlisted]);

  const inCart = mounted ? items.find((i) => i.id === p.id) : undefined;
  const qty = inCart?.qty ?? 0;
  const discount =
    p.mrp && p.price && p.mrp > p.price
      ? Math.round((1 - p.price / p.mrp) * 100)
      : 0;

  const staticEta = p.store_eta_min ?? p.eta_min ?? 45;
  const eta = useDeliveryEta({
    distanceKm: p.store_distance_km ?? p.distance_km ?? null,
    fallback: staticEta,
  });
  const sizes = (p.sizes ?? []).slice(0, 4);
  const [pickingSize, setPickingSize] = useState(false);
  const { conflict, promptConflict, confirmClearAndAdd, dismiss } = useStoreConflict();

  const storeBadge = (p as any).store_badge as string | undefined;
  const storeOpensAt = (p as any).store_opens_at_label as string | undefined;
  const unavailable = storeBadge === "Closed" || storeBadge === "Store Offline";

  const doAdd = (chosenSize: string) => {
    if (unavailable) {
      toast.error("This store is currently unavailable");
      return;
    }
    const r = addItem(p, chosenSize);
    if (!r.success && r.conflict) {
      promptConflict(r.conflict, () => {
        addItem(p, chosenSize);
        toast.success(`${p.name} added`);
        setPickingSize(false);
      });
      return;
    }
    toast.success(`${p.name} added`);
    setPickingSize(false);
  };

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sizesArr = p.sizes ?? [];
    if (sizesArr.length > 1) { setPickingSize(true); return; }
    doAdd(sizesArr[0] ?? "");
  };

  const handlePickSize = (e: React.MouseEvent, s: string) => {
    e.preventDefault();
    e.stopPropagation();
    doAdd(s);
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
    <div
      className={`group relative bg-white rounded-2xl overflow-hidden transition ${
        isCompact
          ? "shadow-[0_1px_4px_rgba(26,43,76,0.08)] hover:shadow-[0_4px_12px_rgba(26,43,76,0.12)]"
          : "shadow-[0_2px_8px_rgba(26,43,76,0.06)] hover:shadow-[0_8px_24px_rgba(26,43,76,0.12)]"
      }`}
      data-testid={`p-card-${p.id}`}
    >
      <Link href={`/product/${p.id}`} className="block active:scale-[0.98] transition">
        {/* Image */}
        <div className={`relative bg-slate-100 overflow-hidden ${isCompact ? "aspect-[4/5]" : "aspect-[3/4]"}`}>
          {p.image ? (
            <Image
              src={p.image}
              alt={p.name}
              fill
              sizes={isCompact ? "160px" : "(max-width: 640px) 42vw, 220px"}
              loading="lazy"
              className="object-cover group-hover:scale-105 transition duration-500"
            />
          ) : (
            <div className="w-full h-full v2-shimmer" />
          )}

          {/* Discount badge — top-left */}
          {discount > 0 && (
            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-white/90 text-[#E68910] text-[9px] font-bold uppercase leading-none">
              {discount}% off
            </span>
          )}

          {/* Wishlist heart — top-right */}
          <button
            type="button"
            aria-label="Wishlist"
            onClick={handleHeart}
            className={`absolute top-1.5 right-1.5 rounded-full grid place-items-center backdrop-blur-md transition active:scale-90 ${
              wished ? "bg-[#E68910] text-white" : "bg-white/85 text-[#0A1F5C]"
            } ${isCompact ? "w-7 h-7" : "w-9 h-9"}`}
          >
            <Heart
              size={isCompact ? 12 : 15}
              fill={wished ? "currentColor" : "none"}
              strokeWidth={2.2}
            />
          </button>
        </div>

        {/* Text content */}
        <div className={isCompact ? "px-1.5 pt-1.5 pb-0 space-y-0.5" : "p-2 pb-1 space-y-0.5"}>
          {/* Store name — default only */}
          {!isCompact && (
            <div className="text-[9px] font-bold uppercase tracking-wider text-[#E68910] line-clamp-1">
              {p.store_name || "Lokl Store"}
            </div>
          )}

          {/* Product name */}
          <div
            className={`font-semibold text-[#0A1F5C] leading-tight ${
              isCompact ? "text-[11px] truncate" : "text-[12px] line-clamp-2"
            }`}
          >
            {p.name}
          </div>

          {/* Price row */}
          <div className="flex items-baseline gap-1 flex-wrap">
            <span className={`font-bold text-[#0A1F5C] ${isCompact ? "text-[12px]" : "text-sm"}`}>
              ₹{Number(p.price).toLocaleString()}
            </span>
            {p.mrp && p.mrp > p.price && (
              <span className={`text-[#9CA3AF] line-through ${isCompact ? "text-[10px]" : "text-[11px]"}`}>
                ₹{Number(p.mrp).toLocaleString()}
              </span>
            )}
          </div>

          {/* Status / ETA — default only */}
          {!isCompact && (
            <>
              {storeBadge === "Away" && (
                <div className="text-[10px] font-semibold text-[#D97706]">Back soon</div>
              )}
              {storeBadge === "Closed" && storeOpensAt && (
                <p className="text-[11px] text-[#9CA3AF] truncate">
                  Available from {storeOpensAt.replace(/^Opens\s+(at\s+)?/i, "")}
                </p>
              )}
              {storeBadge === "Store Offline" && (
                <div className="text-[10px] font-semibold text-[#94A3B8]">Currently unavailable</div>
              )}
              {(!storeBadge || storeBadge === "LIVE") && (
                (p as any).low_stock_size ? (
                  <div className="text-[10px] font-semibold text-[#EF4444]">{(p as any).low_stock_size}</div>
                ) : (p as any).social_proof ? (
                  <div className="text-[10px] text-[#64748B]">{(p as any).social_proof}</div>
                ) : (
                  <div className="text-[10px] text-[#64748B]">
                    {eta} min · {sizes.length ? sizes.slice(0, 3).join(" · ") : "All sizes"}
                  </div>
                )
              )}
            </>
          )}
        </div>
      </Link>

      {/* Cart controls */}
      <div className={isCompact ? "px-1.5 pb-1.5 pt-1" : "px-2 pb-2.5"}>
        {pickingSize && qty === 0 ? (
          <div
            data-testid={`p-card-sizes-${p.id}`}
            className="flex flex-wrap gap-1 py-0.5"
          >
            {(p.sizes ?? []).slice(0, 6).map((s) => (
              <button
                key={s}
                onClick={(e) => handlePickSize(e, s)}
                data-testid={`p-card-size-${p.id}-${s}`}
                className={`min-w-[26px] px-1.5 rounded-full bg-white border border-[#0A1F5C]/30 font-bold text-[#0A1F5C] hover:bg-[#0A1F5C] hover:text-white transition active:scale-95 ${
                  isCompact ? "py-0.5 text-[9px]" : "py-1 text-[11px]"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        ) : qty === 0 && unavailable ? (
          <div
            data-testid={`p-card-add-${p.id}`}
            className={`w-full inline-flex items-center justify-center rounded-full bg-slate-100 text-slate-400 font-bold cursor-not-allowed ${
              isCompact ? "py-1 text-[10px]" : "py-1.5 text-[12px]"
            }`}
          >
            Unavailable
          </div>
        ) : qty === 0 ? (
          <button
            onClick={handleAdd}
            data-testid={`p-card-add-${p.id}`}
            className={`w-full inline-flex items-center justify-center gap-1 rounded-full bg-[#E68910] text-white font-bold active:scale-95 transition shadow-[0_4px_12px_rgba(230,137,16,0.28)] ${
              isCompact ? "py-1 text-[10px]" : "py-1.5 gap-1.5 text-[12px]"
            }`}
          >
            <ShoppingBag size={isCompact ? 11 : 13} />
            {isCompact ? "Add" : "Add to Bag"}
          </button>
        ) : (
          <div
            className={`flex items-center justify-between gap-1 rounded-full bg-[#E68910] text-white ${
              isCompact ? "py-0.5 px-0.5" : "py-1 px-1"
            }`}
            data-testid={`p-card-qty-${p.id}`}
          >
            <button
              onClick={(e) => handleStep(e, -1)}
              aria-label="Decrease"
              data-testid={`qty-dec-${p.id}`}
              className={`rounded-full bg-white/20 hover:bg-white/30 grid place-items-center active:scale-90 ${
                isCompact ? "w-5 h-5" : "w-6 h-6"
              }`}
            >
              <Minus size={isCompact ? 10 : 12} />
            </button>
            <span className={`font-bold flex-1 text-center ${isCompact ? "text-[11px]" : "text-[12px]"}`}>
              {qty}
            </span>
            <button
              onClick={(e) => handleStep(e, 1)}
              aria-label="Increase"
              data-testid={`qty-inc-${p.id}`}
              className={`rounded-full bg-white/20 hover:bg-white/30 grid place-items-center active:scale-90 ${
                isCompact ? "w-5 h-5" : "w-6 h-6"
              }`}
            >
              <Plus size={isCompact ? 10 : 12} />
            </button>
          </div>
        )}
      </div>

      <StoreConflictDialog conflict={conflict} onConfirm={confirmClearAndAdd} onCancel={dismiss} />
    </div>
  );
}
