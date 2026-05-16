import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Bike, Store as StoreIcon, Zap, MapPin, ShieldCheck, Sparkles, Package } from "lucide-react";
import api from "../lib/api";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import ProductCard from "../components/consumer/ProductCard";
import StoreCard from "../components/consumer/StoreCard";

const HERO_IMG = "https://customer-assets.emergentagent.com/job_bharat-fashion-os/artifacts/n1elwepz_ChatGPT%20Image%20May%2016%2C%202026%2C%2006_29_23%20PM.png"; // Bhilai Globe Chowk — full-bleed 2.4:1

export default function Home() {
  const [categories, setCategories] = useState([]);
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);
  const city = "Bhilai";

  useEffect(() => {
    Promise.all([
      api.get("/categories"),
      api.get("/stores"),
      api.get("/products?limit=12"),
    ]).then(([c, s, p]) => { setCategories(c.data); setStores(s.data); setProducts(p.data); }).catch(console.error);
  }, []);

  const fastestEta = stores.length ? Math.min(...stores.map((s) => s.eta_min).filter(Boolean)) : null;
  const cityStores = stores;

  const perks = [
    { i: ShieldCheck, label: "Trusted Stores" },
    { i: Zap,         label: "Lightning Fast" },
    { i: Sparkles,    label: "Try at Your Doorstep" },
    { i: Package,     label: "Easy Returns" },
  ];

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />

      <section data-testid="hero" className="relative">
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 md:pt-8">
          <div className="relative rounded-[28px] overflow-hidden bg-[#1A2B4C] min-h-[420px] md:min-h-[520px]">
            {/* Bhilai Globe Chowk landmark — full-bleed 2.4:1 source, no padding */}
            <img
              src={HERO_IMG}
              alt="Bhilai Globe Chowk"
              className="absolute inset-0 w-full h-full object-cover object-[60%_50%] md:object-center"
            />
            {/* Cream wash for text legibility (lighter on mobile so landmark is visible) */}
            <div className="absolute inset-0 bg-gradient-to-b from-[#FDFBF7]/55 via-[#FDFBF7]/10 to-[#FDFBF7]/0 md:bg-gradient-to-r md:from-[#FDFBF7]/95 md:via-[#FDFBF7]/55 md:to-transparent" />

            <div className="relative grid md:grid-cols-12 gap-6 items-end md:items-center px-6 md:px-10 lg:px-12 py-8 md:py-12 min-h-[420px] md:min-h-[520px]">
              <div className="md:col-span-7 lg:col-span-6 text-[#1A2B4C] bf-fadeup">
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white shadow-sm text-[11px] font-semibold mb-5">
                  <MapPin size={12} className="text-[#E68910]" /> SERVING BHILAI
                </div>
                <h1 className="display text-3xl md:text-4xl lg:text-5xl font-bold leading-[1.05] tracking-tight">
                  Delivered in minutes from <span className="text-[#E68910]">stores next door.</span>
                </h1>
                <p className="mt-5 text-sm md:text-base text-[#595959] max-w-md leading-relaxed">
                  Discover hand-picked fashion from trusted Bhilai boutiques — with doorstep trials and 45-minute delivery.
                </p>

                {/* Feature pills */}
                <div className="mt-7 flex flex-wrap gap-2 md:gap-2.5">
                  {perks.map(({ i: Icon, label }) => (
                    <div key={label} data-testid={`perk-${label.toLowerCase().replace(/\s+/g, "-")}`} className="inline-flex items-center gap-2 px-3 py-1.5 md:px-3.5 md:py-2 rounded-2xl bg-white shadow-sm border border-white/80">
                      <Icon size={13} className="text-[#E68910]" />
                      <span className="text-[11px] md:text-[12px] font-semibold text-[#1A2B4C]">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="md:col-span-5 lg:col-span-6" /> {/* spacer */}
            </div>

            {/* Floating ETA card — middle-right over the photo */}
            <div className="hidden md:flex absolute top-1/2 right-6 lg:right-10 -translate-y-1/2 bf-glass rounded-2xl p-3.5 items-center gap-3 min-w-[260px] shadow-xl">
              <div className="w-11 h-11 rounded-full bg-[#E68910] flex items-center justify-center shrink-0"><Bike size={18} className="text-white" /></div>
              <div className="flex-1">
                <div className="text-[11px] text-[#1A2B4C]/70">Fast delivery in Bhilai</div>
                <div className="font-bold text-[#1A2B4C] display text-lg" data-testid="hero-fastest-eta">{fastestEta ? `${fastestEta} minutes` : "45 minutes"}</div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-[#1A2B4C] text-white text-[10px] font-bold flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#E68910] animate-pulse" /> LIVE</span>
            </div>
            {/* Mobile ETA card (in-flow) */}
            <div className="md:hidden mx-6 mb-6 bf-glass rounded-2xl p-3.5 flex items-center gap-3 shadow">
              <div className="w-10 h-10 rounded-full bg-[#E68910] flex items-center justify-center shrink-0"><Bike size={16} className="text-white" /></div>
              <div className="flex-1">
                <div className="text-[10px] text-[#1A2B4C]/70">Fast delivery in Bhilai</div>
                <div className="font-bold text-[#1A2B4C] display text-base" data-testid="hero-fastest-eta-m">{fastestEta ? `${fastestEta} minutes` : "45 minutes"}</div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-[#1A2B4C] text-white text-[10px] font-bold flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#E68910] animate-pulse" /> LIVE</span>
            </div>
          </div>
        </div>
      </section>

      {/* L1 CATEGORIES */}
      <section data-testid="categories" className="max-w-7xl mx-auto px-4 md:px-8 mt-10">
        <div className="flex justify-between items-end mb-5">
          <h2 className="display text-2xl md:text-3xl font-bold text-[#1A2B4C]">Shop by category</h2>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-7 gap-3 md:gap-4">
          {categories.map((c) => (
            <Link key={c.id} to={`/c/${c.slug}`} data-testid={`category-${c.slug}`} className="group">
              <div className="aspect-square rounded-2xl overflow-hidden bg-white border border-[#E5E2DC]">
                <img src={c.image} alt={c.name} className="w-full h-full object-cover group-hover:scale-110 transition duration-500" />
              </div>
              <div className="text-center mt-2 text-xs md:text-sm font-medium text-[#1C1C1C]">{c.name}</div>
            </Link>
          ))}
        </div>
      </section>

      <section data-testid="nearby-stores" className="max-w-7xl mx-auto px-4 md:px-8 mt-14">
        <div className="flex justify-between items-end mb-5">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E68910]/10 text-[#E68910] text-[11px] font-semibold mb-2"><StoreIcon size={11} /> NEAR YOU</div>
            <h2 className="display text-2xl md:text-3xl font-bold text-[#1A2B4C]">Stores in your neighborhood</h2>
          </div>
          <Link to="/stores" className="text-sm text-[#1A2B4C] font-semibold hover:text-[#E68910]">All stores →</Link>
        </div>
        {(cityStores.length ? cityStores : stores).length === 0 ? (
          <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center">
            <StoreIcon size={36} className="text-[#E68910] mx-auto mb-3" />
            <h3 className="display text-xl font-bold text-[#1A2B4C]">Boutiques are coming soon to Bhilai</h3>
            <p className="text-sm text-[#595959] mt-2 max-w-md mx-auto">We're onboarding local fashion stores in Bhilai. Are you a boutique owner? Join us.</p>
            <Link to="/merchant/register" className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#E68910] text-white text-sm font-semibold">Become a seller <ArrowRight size={14} /></Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
            {(cityStores.length ? cityStores : stores).slice(0, 4).map((s) => <StoreCard key={s.id} s={s} />)}
          </div>
        )}
      </section>

      <section data-testid="trending-products" className="max-w-7xl mx-auto px-4 md:px-8 mt-14">
        <div className="flex justify-between items-end mb-5">
          <h2 className="display text-2xl md:text-3xl font-bold text-[#1A2B4C]">Trending nearby</h2>
        </div>
        {products.length === 0 ? (
          <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center text-sm text-[#595959]">
            No products live yet — fresh drops will appear here as merchants go live.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {products.slice(0, 8).map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        )}
      </section>

      <section data-testid="merchant-strip" className="max-w-7xl mx-auto px-4 md:px-8 mt-16">
        <div className="relative rounded-2xl overflow-hidden bg-[#1A2B4C] text-white px-5 md:px-8 py-4 md:py-5 flex flex-wrap items-center justify-between gap-3">
          <div className="bf-noise absolute inset-0 opacity-25" />
          <div className="relative flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#E68910]/20 flex items-center justify-center shrink-0"><Zap size={16} className="text-[#E68910]" /></div>
            <div><div className="display text-base md:text-lg font-bold">Sell on Bharat.</div><div className="text-xs text-white/70">AI-powered storefront in minutes — free to start.</div></div>
          </div>
          <Link to="/merchant/register" className="relative inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#E68910] text-white text-sm font-semibold">Become a seller <ArrowRight size={14} /></Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
