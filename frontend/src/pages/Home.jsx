import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles, Bike, Store as StoreIcon, Zap, MapPin } from "lucide-react";
import api from "../lib/api";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import ProductCard from "../components/consumer/ProductCard";
import StoreCard from "../components/consumer/StoreCard";

const HERO_BY_CITY = {
  Jaipur: "https://static.prod-images.emergentagent.com/jobs/7eafffce-c685-4839-ad08-06796579c4de/images/2170af8ea48f218e9a710150fe28702a1b95a190e31f2858b88e10d4dde36cc1.png",
  Lucknow: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=1600&auto=format&fit=crop&q=80",
  Indore: "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1600&auto=format&fit=crop&q=80",
  Kanpur: "https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=1600&auto=format&fit=crop&q=80",
  Surat: "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=1600&auto=format&fit=crop&q=80",
  Nagpur: "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=1600&auto=format&fit=crop&q=80",
};

const CITY_TAGLINE = {
  Jaipur: "block-print boutiques",
  Lucknow: "chikankari ateliers",
  Indore: "ethnic-modern stores",
  Kanpur: "leather + streetwear shops",
  Surat: "silk & saree houses",
  Nagpur: "festive fashion boutiques",
};

export default function Home() {
  const [categories, setCategories] = useState([]);
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);
  const [city, setCity] = useState(localStorage.getItem("bf_city") || "Jaipur");

  useEffect(() => {
    Promise.all([
      api.get("/categories"),
      api.get("/stores"),
      api.get("/products?limit=12"),
    ]).then(([c, s, p]) => {
      setCategories(c.data);
      setStores(s.data);
      setProducts(p.data);
    }).catch(console.error);
    const sync = (e) => setCity((e && e.detail) || localStorage.getItem("bf_city") || "Jaipur");
    window.addEventListener("storage", sync);
    window.addEventListener("bf-city-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("bf-city-changed", sync);
    };
  }, []);

  const heroImg = HERO_BY_CITY[city] || HERO_BY_CITY.Jaipur;
  const cityTag = CITY_TAGLINE[city] || "fashion boutiques";
  const fastestEta = stores.length
    ? Math.min(...stores.map((s) => s.eta_min).filter(Boolean))
    : null;

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />

      {/* COMPACT HERO — city-customised, doesn't take the whole fold */}
      <section data-testid="hero" className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 md:pt-8">
          <div className="relative rounded-3xl overflow-hidden bg-[#1A2B4C]">
            <img key={city} src={heroImg} alt={`Fashion in ${city}`} className="absolute inset-0 w-full h-full object-cover opacity-90 bf-fadeup" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#1A2B4C]/85 via-[#1A2B4C]/55 to-transparent" />
            <div className="relative grid md:grid-cols-12 gap-6 items-center px-6 md:px-12 py-8 md:py-10 min-h-[280px] md:min-h-[320px]">
              <div className="md:col-span-7 text-white bf-fadeup">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur text-[11px] font-semibold mb-3">
                  <MapPin size={11} className="text-[#E68910]" /> LIVE IN {city.toUpperCase()} · {cityTag}
                </div>
                <h1 className="display text-3xl md:text-5xl font-bold leading-[1.05]">
                  Delivered in minutes from <span className="text-[#E68910]">stores next door.</span>
                </h1>
                <p className="mt-3 text-sm md:text-base text-white/80 max-w-xl leading-relaxed">
                  Discover hand-picked fashion from trusted local stores in your city — with doorstep trials and 45-minute delivery.
                </p>
              </div>
              <div className="md:col-span-5 flex md:justify-end">
                <div className="bf-glass rounded-2xl p-3.5 flex items-center gap-3 w-full md:w-auto md:min-w-[280px]">
                  <div className="w-11 h-11 rounded-full bg-[#E68910] flex items-center justify-center shrink-0">
                    <Bike size={18} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[11px] text-[#1A2B4C]/70">Fastest store nearby</div>
                    <div className="font-bold text-[#1A2B4C] display text-lg" data-testid="hero-fastest-eta">
                      {fastestEta ? `${fastestEta} minutes` : "Loading…"}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-[#1A2B4C] text-white text-[10px] font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#E68910] animate-pulse" /> LIVE
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CATEGORIES — bumped right up after the compact hero */}
      <section data-testid="categories" className="max-w-7xl mx-auto px-4 md:px-8 mt-10">
        <div className="flex justify-between items-end mb-5">
          <h2 className="display text-2xl md:text-3xl font-bold text-[#1A2B4C]">Shop by category</h2>
          <Link to="/shop" className="text-sm text-[#1A2B4C] font-semibold hover:text-[#E68910]">View all →</Link>
        </div>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-3 md:gap-4">
          {categories.map((c) => (
            <Link key={c.id} to={`/shop?category=${c.id}`} data-testid={`category-${c.slug}`} className="group">
              <div className="aspect-square rounded-2xl overflow-hidden bg-white border border-[#E5E2DC]">
                <img src={c.image} alt={c.name} className="w-full h-full object-cover group-hover:scale-110 transition duration-500" />
              </div>
              <div className="text-center mt-2 text-xs md:text-sm font-medium text-[#1C1C1C]">{c.name}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* NEARBY STORES */}
      <section data-testid="nearby-stores" className="max-w-7xl mx-auto px-4 md:px-8 mt-14">
        <div className="flex justify-between items-end mb-5">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E68910]/10 text-[#E68910] text-[11px] font-semibold mb-2">
              <StoreIcon size={11} /> NEAR YOU
            </div>
            <h2 className="display text-2xl md:text-3xl font-bold text-[#1A2B4C]">Stores in your neighborhood</h2>
          </div>
          <Link to="/stores" className="text-sm text-[#1A2B4C] font-semibold hover:text-[#E68910]">All stores →</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
          {stores.slice(0, 4).map((s) => <StoreCard key={s.id} s={s} />)}
        </div>
      </section>

      {/* TRENDING PRODUCTS */}
      <section data-testid="trending-products" className="max-w-7xl mx-auto px-4 md:px-8 mt-14">
        <div className="flex justify-between items-end mb-5">
          <h2 className="display text-2xl md:text-3xl font-bold text-[#1A2B4C]">Trending nearby</h2>
          <Link to="/shop" className="text-sm text-[#1A2B4C] font-semibold hover:text-[#E68910]">Shop all →</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          {products.slice(0, 8).map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      </section>

      {/* THIN MERCHANT STRIP — sits just above footer */}
      <section data-testid="merchant-strip" className="max-w-7xl mx-auto px-4 md:px-8 mt-16">
        <div className="relative rounded-2xl overflow-hidden bg-[#1A2B4C] text-white px-5 md:px-8 py-4 md:py-5 flex flex-wrap items-center justify-between gap-3">
          <div className="bf-noise absolute inset-0 opacity-25" />
          <div className="relative flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#E68910]/20 flex items-center justify-center shrink-0">
              <Zap size={16} className="text-[#E68910]" />
            </div>
            <div>
              <div className="display text-base md:text-lg font-bold leading-tight">Sell on Bharat.</div>
              <div className="text-xs text-white/70">Launch your AI-powered storefront in minutes — free to start.</div>
            </div>
          </div>
          <Link to="/merchant/register" data-testid="cta-merchant-strip" className="relative inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#E68910] text-white text-sm font-semibold hover:bg-[#C9770E] transition">
            Become a seller <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
