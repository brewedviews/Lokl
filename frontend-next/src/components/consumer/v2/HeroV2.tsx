import Image from "next/image";
import { MapPin, Bike } from "lucide-react";

const FALLBACK_HERO_IMG =
  "https://customer-assets.emergentagent.com/job_bharat-fashion-os/artifacts/n1elwepz_ChatGPT%20Image%20May%2016%2C%202026%2C%2006_29_23%20PM.png";

interface HeroConfig {
  image?: string;
  eyebrow?: string;
  title_line1?: string;
  title_line2?: string;
  subtitle?: string;
}

interface Stats {
  fastest_eta_min?: number;
}

/** Hero card with cream wash over Bhilai backdrop. Ported from CRA HeroV2.jsx. */
export function HeroV2({ stats, hero }: { stats?: Stats | null; hero?: HeroConfig | null }) {
  const img = hero?.image || FALLBACK_HERO_IMG;
  const eyebrow = hero?.eyebrow || "Serving Bhilai";
  const t1 = hero?.title_line1 || "Delivered in minutes from";
  const t2 = hero?.title_line2 || "stores next door.";
  const sub = hero?.subtitle || "Hand-picked fashion from trusted Bhilai stores.";
  const eta = stats?.fastest_eta_min || 30;

  return (
    <section data-testid="hero-v2" className="relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-4 md:pt-6">
        <div className="relative rounded-2xl overflow-hidden bg-[#1A2B4C] min-h-[300px] md:min-h-[320px]">
          <Image
            src={img}
            alt="Bhilai Globe Chowk"
            fill
            priority
            sizes="(max-width: 768px) 100vw, 1200px"
            className="object-cover object-[60%_45%] md:object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#FDFBF7]/95 via-[#FDFBF7]/80 to-[#FDFBF7]/30 md:bg-gradient-to-r md:from-[#FDFBF7]/95 md:via-[#FDFBF7]/55 md:to-transparent" />
          <div className="relative px-5 md:px-10 lg:px-12 py-6 md:py-10 min-h-[300px] md:min-h-[320px] flex flex-col justify-between md:justify-center max-w-2xl">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white shadow-sm text-[11px] font-semibold mb-3 md:mb-4 self-start text-[#0A1F5C] uppercase tracking-wide">
                <MapPin size={12} className="text-[#F59E0B]" /> {eyebrow}
              </div>
              <h1 className="font-display text-[28px] leading-[1.1] md:text-4xl lg:text-5xl font-bold tracking-tight text-[#0A1F5C]">
                {t1} <span className="text-[#F59E0B]">{t2}</span>
              </h1>
              <p className="mt-2.5 md:mt-3 text-[13px] md:text-base text-[#0A1F5C]/75 md:text-[#475569] max-w-md leading-relaxed">
                {sub}
              </p>
            </div>
            <div className="md:hidden mt-4 inline-flex items-center gap-2.5 self-start px-3 py-2 rounded-2xl bg-white/95 backdrop-blur-sm shadow-md">
              <div className="w-8 h-8 rounded-full bg-[#F59E0B] flex items-center justify-center shrink-0"><Bike size={14} className="text-white" /></div>
              <div className="leading-tight">
                <div className="text-[10px] text-[#0A1F5C]/70 font-medium">Fast delivery</div>
                <div className="font-bold text-[#0A1F5C] font-display text-sm" data-testid="hero-fastest-eta-mobile">{eta} minutes</div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-[#0A1F5C] text-white text-[9px] font-bold flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" /> LIVE</span>
            </div>
          </div>
          <div className="hidden md:flex absolute top-1/2 right-6 lg:right-10 -translate-y-1/2 bg-white/90 backdrop-blur-md rounded-2xl p-3.5 items-center gap-3 min-w-[260px] shadow-xl">
            <div className="w-11 h-11 rounded-full bg-[#F59E0B] flex items-center justify-center shrink-0"><Bike size={18} className="text-white" /></div>
            <div className="flex-1">
              <div className="text-[11px] text-[#0A1F5C]/70">Fast delivery in Bhilai</div>
              <div className="font-bold text-[#0A1F5C] font-display text-lg" data-testid="hero-fastest-eta">{eta} minutes</div>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-[#0A1F5C] text-white text-[10px] font-bold flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" /> LIVE</span>
          </div>
        </div>
      </div>
    </section>
  );
}
