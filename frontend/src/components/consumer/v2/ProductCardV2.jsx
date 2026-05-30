import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import ProductBadge from "./ProductBadge";

/** 80% image / 20% content product card — single primary badge, optional urgency line. */
export default function ProductCardV2({ p, onWishlist, isWished }) {
  const [wished, setWished] = useState(!!isWished);
  const discount = p.mrp && p.price && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  const eta = p.store_eta_min || p.eta_min || 45;
  const sizes = (p.sizes || []).slice(0, 4);

  return (
    <Link to={`/product/${p.id}`} data-testid={`p-card-${p.id}`} className="group block bg-white rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] hover:shadow-[0_8px_24px_rgba(10,31,92,0.12)] transition active:scale-[0.98]">
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
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setWished((w) => !w); onWishlist?.(p, !wished); }}
          className={`absolute top-2 right-2 w-9 h-9 rounded-full grid place-items-center backdrop-blur-md transition active:scale-90 ${wished ? "bg-[#F59E0B] text-white" : "bg-white/85 text-[#0A1F5C]"}`}
        >
          <Heart size={15} fill={wished ? "currentColor" : "none"} strokeWidth={2.2} />
        </button>
        {discount > 0 && (
          <span className="absolute bottom-2 left-2 px-2 py-1 rounded-md bg-white/90 text-[#EF4444] text-[10px] font-bold uppercase tracking-wide">{discount}% off</span>
        )}
      </div>
      <div className="p-2 space-y-0.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] line-clamp-1">{p.store_name || "Lokl Store"}</div>
        <div className="text-[12px] font-semibold text-[#0F172A] line-clamp-1">{p.name}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-bold text-[#0A1F5C]">₹{Number(p.price).toLocaleString()}</span>
          {p.mrp && p.mrp > p.price && <span className="text-[11px] text-[#94A3B8] line-through">₹{Number(p.mrp).toLocaleString()}</span>}
        </div>
        {p.low_stock_size ? (
          <div className="text-[10px] font-semibold text-[#EF4444]">{p.low_stock_size}</div>
        ) : p.social_proof ? (
          <div className="text-[10px] text-[#64748B]">{p.social_proof}</div>
        ) : (
          <div className="text-[10px] text-[#64748B]">⚡ {eta} min · {sizes.length ? sizes.join(" · ") : "All sizes"}</div>
        )}
      </div>
    </Link>
  );
}
