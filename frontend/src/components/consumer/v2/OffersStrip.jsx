import React from "react";
import { Link } from "react-router-dom";

/** Horizontal offers carousel — admin-managed via /api/offers. */
export default function OffersStrip({ offers }) {
  if (!offers || offers.length === 0) return null;
  return (
    <section className="pt-8" data-testid="offers-strip">
      <div className="px-4 sm:px-8 mb-3 max-w-7xl mx-auto">
        <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C]">Offers for you</h2>
        <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">Limited-time campaigns from your nearby stores.</p>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-pl-4 sm:scroll-pl-8 px-4 sm:px-8 max-w-7xl mx-auto">
        {offers.map((o) => (
          <Link
            key={o.id}
            to={o.cta_link || "/products"}
            data-testid={`offer-${o.id}`}
            className="snap-start shrink-0 w-[78vw] sm:w-[340px] rounded-2xl overflow-hidden relative shadow-[0_8px_24px_rgba(10,31,92,0.12)] active:scale-[0.98] transition"
            style={{ background: o.background || "#0A1F5C" }}
          >
            <div className="aspect-[16/9] relative">
              {o.image && <img src={o.image} alt={o.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-70" />}
              <div className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/30 to-transparent" />
              <div className="absolute inset-0 p-5 flex flex-col justify-center text-white">
                <div className="text-[10px] uppercase tracking-widest font-bold opacity-90">Limited time</div>
                <div className="text-xl font-display font-bold mt-1 leading-tight">{o.title}</div>
                <div className="text-sm opacity-95 mt-1">{o.subtitle}</div>
                <div className="mt-3 inline-flex items-center gap-1 text-xs font-bold">
                  {o.cta_label || "Shop now"} →
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
