import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Truck, Shirt, Store, Sparkles } from "lucide-react";

const HERO_IMG = "https://images.unsplash.com/photo-1618375601660-3e6842f5b791?w=1200&q=70";

export default function HeroV2({ stats }) {
  return (
    <section className="relative overflow-hidden" data-testid="hero-v2">
      <div className="relative h-[78vh] sm:h-[68vh] max-h-[640px] min-h-[460px]">
        <img src={HERO_IMG} alt="Lokl fashion hero" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A1F5C]/55 via-[#0A1F5C]/40 to-[#0A1F5C]/85" />
        <div className="relative h-full flex flex-col justify-end px-4 pb-32 sm:pb-36 text-white">
          <span className="inline-flex w-fit items-center gap-1.5 px-3 py-1 rounded-full bg-[#F59E0B] text-white text-[10px] font-bold uppercase tracking-widest mb-3">
            <Sparkles size={11} /> Bhilai · Live
          </span>
          <h1 className="text-3xl sm:text-5xl font-display font-bold leading-[1.05] tracking-tight max-w-[18ch]">
            Fashion from <span className="text-[#F59E0B]">Bhilai's</span> best stores.
            <br />Delivered in under 45 minutes.
          </h1>
          <p className="text-sm sm:text-base opacity-90 mt-3 max-w-md leading-relaxed">
            Discover thousands of products from trusted local boutiques with fast delivery, doorstep trial and easy returns.
          </p>
          <div className="flex gap-2 mt-5">
            <Link to="/products?gender=women" data-testid="hero-shop-women" className="inline-flex items-center gap-1.5 px-5 py-3 rounded-full bg-[#F59E0B] text-white text-sm font-bold shadow-[0_8px_24px_rgba(245,158,11,0.35)] active:scale-95 transition">
              Shop Women <ArrowRight size={14} />
            </Link>
            <Link to="/products?gender=men" data-testid="hero-shop-men" className="inline-flex items-center gap-1.5 px-5 py-3 rounded-full bg-white text-[#0A1F5C] text-sm font-bold active:scale-95 transition">
              Shop Men <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        {/* Floating metric strip */}
        {stats && (
          <div data-testid="hero-stats" className="absolute left-4 right-4 bottom-16 sm:bottom-20 grid grid-cols-4 gap-2 bg-white/95 backdrop-blur-md rounded-2xl py-3 px-2 shadow-[0_16px_48px_rgba(10,31,92,0.25)]">
            <Metric label="Rating" value={`★ ${stats.avg_rating?.toFixed?.(1) ?? "4.5"}`} />
            <Metric label="Stores" value={`${stats.verified_stores}+`} />
            <Metric label="Products" value={fmt(stats.products)} />
            <Metric label="Deliveries" value={fmt(stats.deliveries)} />
          </div>
        )}
      </div>

      {/* USP chips — visible without scrolling */}
      <div className="relative -mt-7 px-4">
        <div className="grid grid-cols-3 gap-2 bg-white rounded-2xl p-2 shadow-[0_8px_24px_rgba(10,31,92,0.10)]" data-testid="usp-chips">
          <UspChip icon={Truck} title="Delivery in 30–45 mins" />
          <UspChip icon={Shirt} title="Try before you buy" />
          <UspChip icon={Store} title="Verified local stores" />
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-sm sm:text-base font-bold text-[#0A1F5C] leading-tight">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-[#64748B] font-semibold mt-0.5">{label}</div>
    </div>
  );
}

function UspChip({ icon: Icon, title }) {
  return (
    <div className="flex flex-col items-center gap-1 py-2 text-center">
      <Icon size={16} className="text-[#F59E0B]" />
      <span className="text-[10px] font-bold text-[#0F172A] leading-tight">{title}</span>
    </div>
  );
}

function fmt(n) {
  n = Number(n || 0);
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k+`;
  if (n >= 100) return `${Math.floor(n / 100) * 100}+`;
  return String(n);
}
