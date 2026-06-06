import React from "react";
import { Link } from "react-router-dom";
import { Star, Bike, Sparkles } from "lucide-react";

export default function ProductCard({ p }) {
  return (
    <Link to={`/product/${p.id}`} data-testid={`product-card-${p.id}`} className="group block">
      <div className="relative overflow-hidden rounded-2xl bg-white aspect-[4/5] mb-3 border border-[#E5E2DC]">
        <img src={p.image} alt={p.name} loading="lazy"
             className="w-full h-full object-cover group-hover:scale-[1.04] transition duration-700 ease-out" />
        {p.ai_enhanced && (
          <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-[#1A2B4C] text-white text-[10px] font-semibold flex items-center gap-1">
            <Sparkles size={10} className="text-[#E68910]" /> AI Enhanced
          </div>
        )}
        {p.try_at_doorstep && (
          <div className="absolute bottom-3 left-3 px-2 py-1 rounded-full bg-white/95 text-[#1A2B4C] text-[10px] font-semibold">
            Try-at-Doorstep
          </div>
        )}
      </div>
      <div className="px-1">
        <div className="text-[11px] text-[#595959] uppercase tracking-wider">{p.store_name}</div>
        <h3 className="font-medium text-sm text-[#1C1C1C] mt-0.5 line-clamp-1">{p.name}</h3>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="font-semibold text-[#1A2B4C]">₹{p.price.toLocaleString()}</span>
          {p.mrp && p.mrp > p.price && (
            <>
              <span className="text-xs text-[#595959] line-through">₹{p.mrp.toLocaleString()}</span>
              <span className="text-xs font-semibold text-[#4F7363]">{Math.round((1 - p.price / p.mrp) * 100)}% off</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2 text-[11px] text-[#595959]">
          <span className="flex items-center gap-0.5"><Star size={11} className="fill-[#E68910] text-[#E68910]" /> {p.rating}</span>
          <span className="flex items-center gap-0.5"><Bike size={11} /> {p.store_eta_min} min</span>
          <span>{p.store_distance_km} km</span>
        </div>
      </div>
    </Link>
  );
}
