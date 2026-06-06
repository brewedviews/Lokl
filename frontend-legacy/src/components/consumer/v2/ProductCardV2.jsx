import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Plus, Minus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import ProductBadge from "./ProductBadge";
import { useCart } from "../../../contexts/CartContext";
import { isInWishlist, toggleWishlist } from "../../../lib/wishlist";

/** 80% image / 20% content product card — single primary badge, qty stepper.
 *  Props:
 *    - p:           product
 *    - compact:     when true, hides the store-name label and the delivery-ETA
 *                   sub-line. Use this inside store-page grids (where the page
 *                   itself already communicates store + delivery).
 *    - linkState:   extra `state` to forward via <Link> — used by the PDP to
 *                   detect when the user navigated from a Store page so the
 *                   "More from {store}" section can render instead of generic
 *                   "You might also love".
 */
export default function ProductCardV2({ p, onWishlist, isWished, compact = false, linkState }) {
  const [wished, setWished] = useState(() => (typeof isWished === "boolean" ? isWished : isInWishlist(p.id)));
  useEffect(() => {
    // Stay in sync when wishlist changes elsewhere (e.g. removed from /account)
    const onChange = () => setWished(isInWishlist(p.id));
    window.addEventListener("wishlist:change", onChange);
    return () => window.removeEventListener("wishlist:change", onChange);
  }, [p.id]);
  const { items, add, updateQty } = useCart();
  // Find this product in cart (any size variant)
  const inCart = (items || []).find((i) => i.id === p.id);
  const qty = inCart?.qty || 0;
  const discount = p.mrp && p.price && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  const eta = p.store_eta_min || p.eta_min || 45;
  const sizes = (p.sizes || []).slice(0, 4);

  const handleAdd = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const defaultSize = p.sizes?.[0] || null;
    add(p, defaultSize);
    toast.success(`${p.name} added`);
  };

  const handleStep = (e, delta) => {
    e.preventDefault();
    e.stopPropagation();
    if (!inCart) return;
    updateQty(inCart.key, qty + delta);
  };

  return (
    <div className="group relative bg-white rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] hover:shadow-[0_8px_24px_rgba(10,31,92,0.12)] transition" data-testid={`p-card-${p.id}`}>
      <Link to={`/product/${p.id}`} state={linkState} className="block active:scale-[0.98] transition">
        <div className="relative aspect-[4/5] bg-slate-100 overflow-hidden">
          {p.image ? (
            <img src={p.image} alt={p.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
          ) : (
            <div className="w-full h-full v2-shimmer" />
          )}
          {p.badge && <ProductBadge kind={p.badge} className="absolute top-2 left-2" />}
          <button
            type="button"
            aria-label="Wishlist"
            onClick={(e) => {
              e.preventDefault(); e.stopPropagation();
              const justAdded = toggleWishlist(p);
              setWished(justAdded);
              toast.success(justAdded ? "Saved to wishlist" : "Removed from wishlist");
              onWishlist?.(p, justAdded);
            }}
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
            // Inside a store page: skip the delivery sub-line (the store header already shows ETA).
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
      {/* Add-to-cart / qty stepper — outside the Link so clicks don't navigate */}
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
