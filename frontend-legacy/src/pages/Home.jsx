import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Store as StoreIcon } from "lucide-react";
import api from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import HeroV2 from "../components/consumer/v2/HeroV2";
import OffersStrip from "../components/consumer/v2/OffersStrip";
import HCarousel from "../components/consumer/v2/HCarousel";
import ProductCardV2 from "../components/consumer/v2/ProductCardV2";
import StoreCardV2 from "../components/consumer/v2/StoreCardV2";
import CustomerLove from "../components/consumer/v2/CustomerLove";
import { useUserCoords } from "../components/consumer/LocationBanner";

export default function Home() {
  const { customer } = useAuth() || {};
  const coords = useUserCoords();
  const [stats, setStats] = useState(null);
  const [offers, setOffers] = useState([]);
  const [cats, setCats] = useState([]);
  const [popular, setPopular] = useState([]);
  const [sellingFast, setSellingFast] = useState([]);
  const [nearbyStores, setNearbyStores] = useState([]);
  const [popularStores, setPopularStores] = useState([]);
  const [allStores, setAllStores] = useState([]);
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [config, setConfig] = useState(null);

  useEffect(() => {
    const llQ = coords ? `lat=${coords.lat}&lng=${coords.lng}` : "";
    Promise.all([
      api.get("/site/homepage-config").then((r) => setConfig(r.data)).catch(() => setConfig(null)),
      api.get("/stats/home").then((r) => setStats(r.data)).catch(() => setStats(null)),
      api.get("/feed/popular-in-city?limit=10").then((r) => setPopular(r.data || [])).catch(() => setPopular([])),
      api.get(`/stores?limit=12${llQ ? `&${llQ}` : ""}`).then((r) => setAllStores(r.data || [])).catch(() => setAllStores([])),
      api.get("/feed/popular-stores?limit=8").then((r) => setPopularStores(r.data || [])).catch(() => setPopularStores([])),
      api.get("/offers").then((r) => setOffers(r.data || [])).catch(() => setOffers([])),
      api.get("/categories/counts").then((r) => setCats(r.data || [])).catch(() => setCats([])),
    ]);
    if (coords) {
      api.get(`/feed/nearby-stores?lat=${coords.lat}&lng=${coords.lng}&limit=8`)
        .then((r) => setNearbyStores(r.data || []))
        .catch(() => setNearbyStores([]));
    } else {
      setNearbyStores([]);
    }
    setTimeout(() => {
      api.get("/feed/selling-fast?limit=10").then((r) => setSellingFast(r.data || [])).catch(() => {});
      api.get("/testimonials").then((r) => setTestimonials(r.data || [])).catch(() => {});
      if (customer) {
        api.get("/me/recently-viewed?limit=10").then((r) => setRecentlyViewed(r.data || [])).catch(() => {});
      }
    }, 80);
  }, [customer, coords]);

  // CMS visibility helper — admin can toggle any section off; default on if config not loaded yet.
  const enabled = (id) => {
    if (!config?.sections) return true;
    const s = config.sections.find((x) => x.id === id);
    return s ? s.enabled : true;
  };
  const orderedIds = (config?.sections || [])
    .filter((s) => s.enabled !== false)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .map((s) => s.id);

  const SECTIONS = {
    hero: () => <HeroV2 stats={stats} hero={config?.hero} />,
    offers: () => offers.length > 0 && <OffersStrip offers={offers} />,
    categories: () => cats.length > 0 && (
      <section className="px-4 sm:px-8 pt-8 max-w-7xl mx-auto" data-testid="categories-v2">
        <h2 className="text-xl sm:text-2xl font-display font-bold text-[#0A1F5C] mb-1">Shop by category</h2>
        <p className="text-xs sm:text-sm text-[#64748B] mb-4">From stores across Bhilai.</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 sm:gap-4">
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
    ),
    popular_in_city: () => popular.length > 0 && (
      <HCarousel title="Trending now" subtitle="Most ordered products nearby this week" testid="popular-in-city" link="/products?sort=trending" linkLabel="See all">
        {popular.map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ),
    selling_fast: () => sellingFast.length > 0 && (
      <HCarousel title="Selling fast" subtitle="Don't miss out — limited stock" testid="selling-fast" link="/products?sort=trending">
        {sellingFast.map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ),
    stores: () => {
      // Per UX feedback we keep only the "Nearby stores" rail on Home. The
      // Popular Stores + All Stores rails were merged into the dedicated
      // /stores listing page — Home stays focused on personal proximity.
      if (coords && nearbyStores.length > 0) {
        return (
          <section className="px-4 sm:px-8 pt-8 max-w-7xl mx-auto" data-testid="stores-nearby">
            <div className="flex items-end justify-between mb-3">
              <div>
                <h2 className="text-xl sm:text-2xl font-display font-bold text-[#0A1F5C]">Nearby stores</h2>
                <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">Closest open stores around you.</p>
              </div>
              <Link to="/stores" className="text-xs font-bold text-[#F59E0B]">See all →</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {nearbyStores.slice(0, 6).map((s) => <StoreCardV2 key={s.id} s={s} />)}
            </div>
          </section>
        );
      }
      // No coords or no nearby stores → fall back to a compact all-stores rail
      // so first-time visitors still see something to discover.
      if (allStores.length > 0) {
        return (
          <section className="px-4 sm:px-8 pt-8 max-w-7xl mx-auto" data-testid="stores-nearby">
            <div className="flex items-end justify-between mb-3">
              <div>
                <h2 className="text-xl sm:text-2xl font-display font-bold text-[#0A1F5C]">Nearby stores</h2>
                <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
                  {coords ? "Top stores around you." : "Enable location to see distance + ETA."}
                </p>
              </div>
              <Link to="/stores" className="text-xs font-bold text-[#F59E0B]">See all →</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {allStores.slice(0, 6).map((s) => <StoreCardV2 key={s.id} s={s} />)}
            </div>
          </section>
        );
      }
      return (
        <section className="px-4 py-10 text-center bg-[#F8FAFC]">
          <StoreIcon size={36} className="text-[#F59E0B] mx-auto mb-3" />
          <h3 className="text-lg font-display font-bold text-[#0A1F5C]">Stores are coming soon</h3>
          <p className="text-sm text-[#64748B] mt-2 max-w-md mx-auto">Run a Bhilai store? Join the marketplace.</p>
          <Link to="/merchant/register" className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#F59E0B] text-white text-sm font-bold shadow-[0_8px_24px_rgba(245,158,11,0.35)]">Become a seller <ArrowRight size={14} /></Link>
        </section>
      );
    },
    recently_viewed: () => recentlyViewed.length > 0 && (
      <HCarousel title="Recently viewed" subtitle="Pick up where you left off" testid="recently-viewed">
        {recentlyViewed.map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ),
    customer_love: () => <CustomerLove items={testimonials} />,
  };

  // Suppress unused-var lint while preserving the helper for future fine-grained UI gates.
  void enabled;

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />
      <main className="pb-0">
        {orderedIds.length > 0
          ? orderedIds.map((id) => <React.Fragment key={id}>{SECTIONS[id]?.()}</React.Fragment>)
          : Object.entries(SECTIONS).map(([k, fn]) => <React.Fragment key={k}>{fn()}</React.Fragment>)
        }
      </main>
      <Footer topGap={false} />
    </div>
  );
}
