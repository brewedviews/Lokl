import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles, Bike, Store as StoreIcon, Zap } from "lucide-react";
import api from "../lib/api";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import ProductCard from "../components/consumer/ProductCard";
import StoreCard from "../components/consumer/StoreCard";

const HERO_IMG = "https://static.prod-images.emergentagent.com/jobs/7eafffce-c685-4839-ad08-06796579c4de/images/2170af8ea48f218e9a710150fe28702a1b95a190e31f2858b88e10d4dde36cc1.png";

export default function Home() {
  const [categories, setCategories] = useState([]);
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);

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
  }, []);

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />

      {/* HERO */}
      <section data-testid="hero" className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-10 md:py-16 grid md:grid-cols-12 gap-8 items-center">
          <div className="md:col-span-6 bf-fadeup">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1A2B4C]/5 text-[#1A2B4C] text-xs font-semibold mb-5">
              <Sparkles size={13} className="text-[#E68910]" /> AI-powered Bharat-first fashion
            </div>
            <h1 className="display text-5xl md:text-7xl font-bold leading-[0.95] text-[#1A2B4C]">
              Boutiques next door.
              <br />
              <span className="text-[#E68910]">Delivered in minutes.</span>
            </h1>
            <p className="mt-6 text-[#595959] text-base md:text-lg max-w-md leading-relaxed">
              Discover hand-picked fashion from trusted local stores in your city — with AI styling, doorstep trials, and 45-minute delivery.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/stores" data-testid="cta-shop-nearby" className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-[#1A2B4C] text-white font-semibold hover:bg-[#101D36] transition">
                Shop nearby stores <ArrowRight size={16} />
              </Link>
              <Link to="/merchant/register" data-testid="cta-merchant" className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full border border-[#1A2B4C] text-[#1A2B4C] font-semibold hover:bg-[#1A2B4C] hover:text-white transition">
                I sell fashion
              </Link>
            </div>
            <div className="mt-10 flex gap-8 text-xs text-[#595959]">
              <div><div className="text-2xl font-bold text-[#1A2B4C] display">2,400+</div>local boutiques</div>
              <div><div className="text-2xl font-bold text-[#1A2B4C] display">45 min</div>avg delivery</div>
              <div><div className="text-2xl font-bold text-[#1A2B4C] display">14</div>Bharat cities</div>
            </div>
          </div>
          <div className="md:col-span-6 relative">
            <div className="aspect-[4/5] rounded-3xl overflow-hidden relative">
              <img src={HERO_IMG} alt="Bharat fashion" className="w-full h-full object-cover" />
              <div className="absolute bottom-5 left-5 right-5 bf-glass rounded-2xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#E68910] flex items-center justify-center">
                  <Bike size={18} className="text-white" />
                </div>
                <div className="flex-1">
                  <div className="text-xs text-[#595959]">Your next order arrives in</div>
                  <div className="font-bold text-[#1A2B4C]">28 minutes</div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-[#1A2B4C] text-white text-[10px] font-bold">LIVE</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CATEGORIES */}
      <section data-testid="categories" className="max-w-7xl mx-auto px-4 md:px-8 mt-8">
        <div className="flex justify-between items-end mb-6">
          <h2 className="display text-3xl md:text-4xl font-bold text-[#1A2B4C]">Shop by category</h2>
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
      <section data-testid="nearby-stores" className="max-w-7xl mx-auto px-4 md:px-8 mt-16">
        <div className="flex justify-between items-end mb-6">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E68910]/10 text-[#E68910] text-[11px] font-semibold mb-2">
              <StoreIcon size={11} /> NEAR YOU
            </div>
            <h2 className="display text-3xl md:text-4xl font-bold text-[#1A2B4C]">Boutiques in your neighborhood</h2>
          </div>
          <Link to="/stores" className="text-sm text-[#1A2B4C] font-semibold hover:text-[#E68910]">All stores →</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
          {stores.slice(0, 4).map((s) => <StoreCard key={s.id} s={s} />)}
        </div>
      </section>

      {/* AI BANNER */}
      <section data-testid="ai-banner" className="max-w-7xl mx-auto px-4 md:px-8 mt-16">
        <div className="relative rounded-3xl overflow-hidden bg-[#1A2B4C] text-white p-8 md:p-16">
          <div className="bf-noise absolute inset-0 opacity-30" />
          <div className="relative grid md:grid-cols-2 gap-8 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E68910]/20 text-[#E68910] text-xs font-semibold mb-4">
                <Zap size={12} /> FOR MERCHANTS
              </div>
              <h3 className="display text-3xl md:text-5xl font-bold leading-tight">
                Launch your AI-powered digital storefront in minutes.
              </h3>
              <p className="mt-4 text-white/70 max-w-md">
                Snap a phone photo of your products. Our AI transforms them into magazine-quality catalogs with descriptions, tags & ad copy.
              </p>
              <Link to="/merchant/register" data-testid="cta-merchant-ai" className="inline-flex items-center gap-2 mt-6 px-6 py-3 rounded-full bg-[#E68910] text-white font-semibold hover:bg-[#C9770E] transition">
                Start free <ArrowRight size={16} />
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl overflow-hidden bg-white/5">
                <div className="text-[10px] uppercase tracking-widest text-white/60 p-2 text-center">Raw photo</div>
                <img src="https://static.prod-images.emergentagent.com/jobs/7eafffce-c685-4839-ad08-06796579c4de/images/ec5665f39e798be41fe86083e99a5d4c91342b61fdb3c0fed0ac8470b9f5ae30.png"
                     alt="raw" className="w-full aspect-[4/5] object-cover" />
              </div>
              <div className="rounded-2xl overflow-hidden border-2 border-[#E68910]">
                <div className="text-[10px] uppercase tracking-widest text-[#E68910] bg-[#E68910]/10 p-2 text-center font-semibold">AI Studio</div>
                <img src="https://static.prod-images.emergentagent.com/jobs/7eafffce-c685-4839-ad08-06796579c4de/images/85d2c0f8f4172341be04027aee7a0cdd867b695317ee9a9a01a9e2b11653670e.png"
                     alt="enhanced" className="w-full aspect-[4/5] object-cover" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRENDING PRODUCTS */}
      <section data-testid="trending-products" className="max-w-7xl mx-auto px-4 md:px-8 mt-16">
        <div className="flex justify-between items-end mb-6">
          <h2 className="display text-3xl md:text-4xl font-bold text-[#1A2B4C]">Trending nearby</h2>
          <Link to="/shop" className="text-sm text-[#1A2B4C] font-semibold hover:text-[#E68910]">Shop all →</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          {products.slice(0, 8).map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      </section>

      <Footer />
    </div>
  );
}
