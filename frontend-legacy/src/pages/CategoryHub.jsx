import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import OffersStrip from "../components/consumer/v2/OffersStrip";
import HCarousel from "../components/consumer/v2/HCarousel";
import ProductCardV2 from "../components/consumer/v2/ProductCardV2";

// Category hub — Myntra/Ajio style:
// L1 category tile grid → Offers rail → Trending now → Selling fast → Recently added.
// Click any L1 tile → /c/{slug} (the dedicated L1 page that already exists).
export default function CategoryHub() {
  const [cats, setCats] = useState([]);
  const [offers, setOffers] = useState([]);
  const [trending, setTrending] = useState([]);
  const [sellingFast, setSellingFast] = useState([]);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    Promise.all([
      api.get("/categories/counts").then((r) => setCats(r.data || [])).catch(() => setCats([])),
      api.get("/offers").then((r) => setOffers(r.data || [])).catch(() => setOffers([])),
      api.get("/feed/popular-in-city?limit=10").then((r) => setTrending(r.data || [])).catch(() => {}),
      api.get("/feed/selling-fast?limit=10").then((r) => setSellingFast(r.data || [])).catch(() => {}),
      api.get("/feed/new-arrivals?limit=10").then((r) => setRecent(r.data || [])).catch(() => {}),
    ]);
  }, []);

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <ConsumerHeader />
      <main className="flex-1">
        {/* L1 grid */}
        <section data-testid="category-hub-grid" className="max-w-7xl mx-auto px-4 sm:px-8 pt-8">
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] leading-tight">Shop by category</h1>
          <p className="text-xs sm:text-sm text-[#64748B] mt-1">All categories from your nearby stores.</p>
          {cats.length === 0 ? (
            <div className="py-10 text-center text-sm text-[#64748B]">Loading categories…</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 sm:gap-4 mt-5">
              {cats.map((c) => (
                <Link
                  key={c.id}
                  to={`/c/${c.slug}`}
                  data-testid={`category-tile-${c.slug}`}
                  className="group bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-[0_2px_8px_rgba(10,31,92,0.06)] hover:shadow-md transition active:scale-95"
                >
                  <div className="aspect-square bg-slate-100">
                    {c.image && (
                      <img src={c.image} alt={c.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                    )}
                  </div>
                  <div className="text-center py-2 px-1">
                    <div className="text-[12px] font-bold text-[#0A1F5C]">{c.name}</div>
                    <div className="text-[10px] text-[#64748B] mt-0.5">{(c.product_count ?? 0).toLocaleString()} products</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Offers carousel */}
        {offers.length > 0 && <OffersStrip offers={offers} />}

        {/* Trending now */}
        {trending.length > 0 && (
          <HCarousel title="Trending now" subtitle="Most ordered products nearby this week" testid="hub-trending" link="/products?sort=trending" linkLabel="See all">
            {trending.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}

        {/* Selling fast */}
        {sellingFast.length > 0 && (
          <HCarousel title="Selling fast" subtitle="Don't miss out — limited stock" testid="hub-selling-fast" link="/products?sort=trending">
            {sellingFast.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}

        {/* Recently added */}
        {recent.length > 0 && (
          <HCarousel title="Recently added" subtitle="Fresh drops from Bhilai stores" testid="hub-recent" link="/products?sort=new" linkLabel="See all">
            {recent.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}
      </main>
      <Footer />
    </div>
  );
}
