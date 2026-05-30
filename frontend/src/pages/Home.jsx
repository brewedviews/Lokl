import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Store as StoreIcon, Eye } from "lucide-react";
import api from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import HeroV2 from "../components/consumer/v2/HeroV2";
import WhyLokl, { HowLoklWorks } from "../components/consumer/v2/WhyLokl";
import OffersStrip from "../components/consumer/v2/OffersStrip";
import HCarousel from "../components/consumer/v2/HCarousel";
import ProductCardV2 from "../components/consumer/v2/ProductCardV2";
import StoreCardV2 from "../components/consumer/v2/StoreCardV2";
import CustomerLove from "../components/consumer/v2/CustomerLove";

export default function Home() {
  const { customer } = useAuth() || {};
  const [stats, setStats] = useState(null);
  const [offers, setOffers] = useState([]);
  const [cats, setCats] = useState([]);
  const [popular, setPopular] = useState([]);
  const [sellingFast, setSellingFast] = useState([]);
  const [stores, setStores] = useState([]);
  const [trending, setTrending] = useState([]);
  const [newArrivals, setNewArrivals] = useState([]);
  const [bestSellers, setBestSellers] = useState([]);
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const [testimonials, setTestimonials] = useState([]);

  useEffect(() => {
    // Foreground critical (above fold): stats + popular + stores
    Promise.all([
      api.get("/stats/home").then((r) => setStats(r.data)).catch(() => setStats(null)),
      api.get("/feed/popular-in-city?limit=10").then((r) => setPopular(r.data || [])).catch(() => setPopular([])),
      api.get("/stores?limit=8").then((r) => setStores(r.data || [])).catch(() => setStores([])),
      api.get("/offers").then((r) => setOffers(r.data || [])).catch(() => setOffers([])),
      api.get("/categories/counts").then((r) => setCats(r.data || [])).catch(() => setCats([])),
    ]);
    // Background — below fold lazy fetch in next tick
    setTimeout(() => {
      api.get("/feed/selling-fast?limit=10").then((r) => setSellingFast(r.data || [])).catch(() => {});
      api.get("/feed/trending?limit=10").then((r) => setTrending(r.data || [])).catch(() => {});
      api.get("/feed/new-arrivals?limit=10").then((r) => setNewArrivals(r.data || [])).catch(() => {});
      api.get("/feed/best-sellers?limit=10").then((r) => setBestSellers(r.data || [])).catch(() => {});
      api.get("/testimonials").then((r) => setTestimonials(r.data || [])).catch(() => {});
      if (customer) {
        api.get("/me/recently-viewed?limit=10").then((r) => setRecentlyViewed(r.data || [])).catch(() => {});
      }
    }, 80);
  }, [customer]);

  return (
    <div className="min-h-screen bg-white">
      <ConsumerHeader />
      <main className="pb-24 md:pb-12">
        <HeroV2 stats={stats} />

        <WhyLokl />

        <OffersStrip offers={offers} />

        {/* Categories with counts */}
        {cats.length > 0 && (
          <section className="px-4 py-6" data-testid="categories-v2">
            <h2 className="text-xl font-display font-bold text-[#0A1F5C] mb-1">Shop by category</h2>
            <p className="text-xs text-[#64748B] mb-4">From boutiques across Bhilai.</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {cats.slice(0, 6).map((c) => (
                <Link key={c.id} to={`/c/${c.slug}`} data-testid={`category-${c.slug}`} className="group bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-[0_2px_8px_rgba(10,31,92,0.06)] active:scale-95 transition">
                  <div className="aspect-square bg-slate-100">
                    {c.image && <img src={c.image} alt={c.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-110 transition duration-500" />}
                  </div>
                  <div className="text-center py-2 px-1">
                    <div className="text-[12px] font-bold text-[#0F172A]">{c.name}</div>
                    <div className="text-[10px] text-[#64748B] mt-0.5">{(c.product_count ?? 0).toLocaleString()} products</div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {popular.length > 0 && (
          <HCarousel title="Popular in Bhilai" subtitle="Most ordered products nearby this week" testid="popular-in-city" link="/products" linkLabel="See all">
            {popular.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}

        {sellingFast.length > 0 && (
          <HCarousel title="Selling fast" subtitle="Don't miss out — limited stock" testid="selling-fast" link="/products">
            {sellingFast.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}

        {/* Stores Near You */}
        {stores.length > 0 ? (
          <section className="px-4 py-6" data-testid="stores-near-you">
            <div className="flex items-end justify-between mb-3">
              <div>
                <h2 className="text-xl font-display font-bold text-[#0A1F5C]">Stores near you</h2>
                <p className="text-xs text-[#64748B] mt-0.5">Verified Bhilai boutiques delivering today.</p>
              </div>
              <Link to="/stores" className="text-xs font-bold text-[#F59E0B]">See all →</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {stores.slice(0, 4).map((s) => <StoreCardV2 key={s.id} s={s} />)}
            </div>
          </section>
        ) : (
          <section className="px-4 py-10 text-center bg-[#F8FAFC]">
            <StoreIcon size={36} className="text-[#F59E0B] mx-auto mb-3" />
            <h3 className="text-lg font-display font-bold text-[#0A1F5C]">Boutiques are coming soon</h3>
            <p className="text-sm text-[#64748B] mt-2 max-w-md mx-auto">Run a Bhilai boutique? Join the marketplace.</p>
            <Link to="/merchant/register" className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#F59E0B] text-white text-sm font-bold shadow-[0_8px_24px_rgba(245,158,11,0.35)]">Become a seller <ArrowRight size={14} /></Link>
          </section>
        )}

        {trending.length > 0 && (
          <HCarousel title="Trending now" subtitle="What Bhilai is shopping today" testid="trending">
            {trending.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}

        {newArrivals.length > 0 && (
          <HCarousel title="New arrivals" subtitle="Fresh drops in the last two weeks" testid="new-arrivals">
            {newArrivals.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}

        {bestSellers.length > 0 && (
          <HCarousel title="Best sellers" subtitle="Bhilai's most-ordered styles, last 30 days" testid="best-sellers">
            {bestSellers.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}

        {recentlyViewed.length > 0 && (
          <HCarousel title="Recently viewed" subtitle="Pick up where you left off" testid="recently-viewed">
            {recentlyViewed.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}

        <CustomerLove items={testimonials} />

        <HowLoklWorks />
      </main>
      <Footer />
    </div>
  );
}
