import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Truck, Shirt, Store, Sparkles } from "lucide-react";

const FALLBACK_HERO_IMG = "https://customer-assets.emergentagent.com/job_bharat-fashion-os/artifacts/n1elwepz_ChatGPT%20Image%20May%2016%2C%202026%2C%2006_29_23%20PM.png";

export default function HeroV2({ stats, hero }) {
  const img = hero?.image || FALLBACK_HERO_IMG;
  const eyebrow = hero?.eyebrow || "Bhilai · Live";
  const t1 = hero?.title_line1 || "Fashion from Bhilai's best stores.";
  const t2 = hero?.title_line2 || "Delivered in under 45 minutes.";
  const sub = hero?.subtitle || "Discover thousands of products from trusted local boutiques with fast delivery, doorstep trial and easy returns.";
  const cta1l = hero?.cta_primary_label || "Shop Women";
  const cta1h = hero?.cta_primary_link || "/c/women";
  const cta2l = hero?.cta_secondary_label || "Shop Men";
  const cta2h = hero?.cta_secondary_link || "/c/men";
  const showStats = hero?.show_stats !== false;
  const showChips = hero?.show_usp_chips !== false;

  return (
    <section className="relative overflow-hidden" data-testid="hero-v2">
      <div className="relative h-[72vh] sm:h-[68vh] lg:h-[78vh] max-h-[720px] min-h-[460px]">
        <img src={img} alt="Lokl fashion hero" className="absolute inset-0 w-full h-full object-cover object-center" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A1F5C]/55 via-[#0A1F5C]/35 to-[#0A1F5C]/85" />
        <div className="relative h-full max-w-7xl mx-auto flex flex-col justify-end px-4 sm:px-8 pb-36 sm:pb-40 lg:pb-44 text-white">
          <span className="inline-flex w-fit items-center gap-1.5 px-3 py-1 rounded-full bg-[#F59E0B] text-white text-[10px] font-bold uppercase tracking-widest mb-3">
            <Sparkles size={11} /> {eyebrow}
          </span>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-display font-bold leading-[1.05] tracking-tight max-w-2xl">
            {t1}
            <br className="hidden sm:block" /> {t2}
          </h1>
          <p className="text-sm sm:text-base lg:text-lg opacity-90 mt-4 max-w-lg leading-relaxed">{sub}</p>
          <div className="flex flex-wrap gap-3 sm:gap-4 mt-6">
            <Link to={cta1h} data-testid="hero-shop-women" className="inline-flex items-center gap-1.5 px-6 py-3 rounded-full bg-[#F59E0B] text-white text-sm font-bold shadow-[0_8px_24px_rgba(245,158,11,0.35)] active:scale-95 transition">
              {cta1l} <ArrowRight size={14} />
            </Link>
            <Link to={cta2h} data-testid="hero-shop-men" className="inline-flex items-center gap-1.5 px-6 py-3 rounded-full bg-white text-[#0A1F5C] text-sm font-bold active:scale-95 transition">
              {cta2l} <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        {showStats && stats && (
          <div data-testid="hero-stats" className="absolute left-4 right-4 sm:left-8 sm:right-8 lg:max-w-3xl lg:left-1/2 lg:-translate-x-1/2 bottom-20 sm:bottom-24 grid grid-cols-4 gap-4 sm:gap-8 bg-white/95 backdrop-blur-md rounded-2xl py-4 px-4 sm:px-8 shadow-[0_16px_48px_rgba(10,31,92,0.25)]">
            <Metric label="Rating" value={`★ ${stats.avg_rating?.toFixed?.(1) ?? "4.5"}`} />
            <Metric label="Stores" value={`${stats.verified_stores}+`} />
            <Metric label="Products" value={fmt(stats.products)} />
            <Metric label="Deliveries" value={fmt(stats.deliveries)} />
          </div>
        )}
      </div>

      {showChips && (
        <div className="relative -mt-8 px-4 sm:px-8 max-w-7xl mx-auto">
          <div className="grid grid-cols-3 gap-2 sm:gap-4 bg-white rounded-2xl p-2 sm:p-3 shadow-[0_8px_24px_rgba(10,31,92,0.10)]" data-testid="usp-chips">
            <UspChip icon={Truck} title="Delivery in 30–45 mins" />
            <UspChip icon={Shirt} title="Try before you buy" />
            <UspChip icon={Store} title="Verified local stores" />
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-sm sm:text-lg font-bold text-[#0A1F5C] leading-tight">{value}</div>
      <div className="text-[9px] sm:text-[11px] uppercase tracking-widest text-[#64748B] font-semibold mt-1">{label}</div>
    </div>
  );
}

function UspChip({ icon: Icon, title }) {
  return (
    <div className="flex flex-col items-center gap-1 py-2 sm:py-3 text-center">
      <Icon size={18} className="text-[#F59E0B]" />
      <span className="text-[10px] sm:text-xs font-bold text-[#0F172A] leading-tight">{title}</span>
    </div>
  );
}

function fmt(n) {
  n = Number(n || 0);
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k+`;
  if (n >= 100) return `${Math.floor(n / 100) * 100}+`;
  return String(n);
}
