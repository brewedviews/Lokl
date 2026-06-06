import React from "react";
import { Link } from "react-router-dom";
import { Star, Bike, MapPin, ShieldCheck } from "lucide-react";

export default function StoreCard({ s }) {
  return (
    <Link to={`/store/${s.id}`} data-testid={`store-card-${s.id}`} className="group block">
      <div className="relative overflow-hidden rounded-2xl aspect-[4/5] mb-3">
        <img src={s.banner} alt={s.name} loading="lazy"
             className="w-full h-full object-cover group-hover:scale-[1.05] transition duration-700" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        {s.trusted && (
          <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-white/90 text-[#1A2B4C] text-[10px] font-semibold flex items-center gap-1">
            <ShieldCheck size={11} className="text-[#4F7363]" /> Trusted
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
          <div className="text-[10px] uppercase tracking-widest text-white/70 mb-1">{s.locality} · {s.city}</div>
          <h3 className="display text-xl font-bold leading-tight">{s.name}</h3>
          <p className="text-xs text-white/80 mt-1 line-clamp-1">{s.tagline}</p>
          <div className="flex items-center gap-3 mt-2 text-[11px] text-white/90">
            <span className="flex items-center gap-1"><Star size={11} className="fill-[#E68910] text-[#E68910]" /> {s.rating}</span>
            <span className="flex items-center gap-1"><Bike size={11} /> {s.eta_min} min</span>
            <span className="flex items-center gap-1"><MapPin size={11} /> {s.distance_km} km</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
