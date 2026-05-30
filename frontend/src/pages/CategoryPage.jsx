import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import api from "../lib/api";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import ProductCardV2 from "../components/consumer/v2/ProductCardV2";
import OffersStrip from "../components/consumer/v2/OffersStrip";

// L1 + L2 category listing page.
// Route: /c/:slug          → L1 view (L2 tiles + all L1 products)
// Route: /c/:slug/:l2slug  → dedicated L2 view (only that L2's products) +
//                            Offers for you rail below.
// L2 tiles now navigate to the dedicated route instead of inline-filtering.
// All product grids use ProductCardV2 (non-compact) so cards show %-off badge,
// store name, product name, ₹price, ₹MRP striked, delivery ETA, add-to-cart.
export default function CategoryPage() {
  const { slug, l2slug } = useParams();
  const nav = useNavigate();
  const [cats, setCats] = useState([]);
  const [products, setProducts] = useState([]);
  const [offers, setOffers] = useState([]);
  const [gender, setGender] = useState("");
  const [sort, setSort] = useState("trending");

  const l1 = useMemo(() => cats.find((c) => c.slug === slug), [cats, slug]);
  const l2 = useMemo(() => l1?.l2?.find((s) => s.slug === l2slug) || null, [l1, l2slug]);
  const showingL2 = !!l2;
  const showL2Tiles = !!l1 && l1.l2 && l1.l2.length > 0 && !showingL2;

  useEffect(() => { api.get("/categories").then((r) => setCats(r.data)); }, []);

  useEffect(() => {
    if (!l1) return;
    // Reset products + scroll to top on category/subcategory change so each
    // L2 click feels like a fresh page load.
    window.scrollTo({ top: 0, behavior: "auto" });
    const params = new URLSearchParams({ l1: l1.id, sort });
    if (l2) params.set("l2", l2.id);
    if (gender) params.set("gender", gender);
    api.get(`/products?${params.toString()}`).then((r) => setProducts(r.data));
  }, [l1, l2, gender, sort]);

  // Offers rail only loads inside an L2 view (per user spec).
  useEffect(() => {
    if (!showingL2) { setOffers([]); return; }
    api.get("/offers").then((r) => setOffers(r.data || [])).catch(() => setOffers([]));
  }, [showingL2]);

  if (!l1) return <div className="min-h-screen bg-[#FDFBF7]"><ConsumerHeader /><div className="p-10 text-center text-[#595959]">Loading…</div></div>;

  const title = l2 ? l2.name : l1.name;

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <ConsumerHeader />
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-8">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-[#595959] mb-2 flex-wrap">
            <Link to="/" className="hover:text-[#1A2B4C]">Home</Link><span>›</span>
            <Link to="/categories" className="hover:text-[#1A2B4C]">Categories</Link><span>›</span>
            {l2 ? (
              <>
                <Link to={`/c/${l1.slug}`} className="hover:text-[#1A2B4C]">{l1.name}</Link>
                <span>›</span><span data-testid="crumb-l2">{l2.name}</span>
              </>
            ) : (
              <span data-testid="crumb-l1">{l1.name}</span>
            )}
          </div>
          <h1 data-testid="cat-title" className="font-display text-3xl md:text-5xl font-bold text-[#1A2B4C] leading-tight">{title}</h1>

          {showL2Tiles ? (
            <>
              <p className="text-[#595959] text-sm mt-1">Browse {l1.name.toLowerCase()} by category</p>
              <div className="mt-6 grid grid-cols-3 md:grid-cols-5 gap-3 md:gap-4">
                {l1.l2.map((s) => (
                  <Link
                    key={s.id}
                    to={`/c/${l1.slug}/${s.slug}`}
                    data-testid={`l2-${s.slug}`}
                    className="group rounded-2xl active:scale-95 transition"
                  >
                    <div className="aspect-square rounded-2xl overflow-hidden bg-white border border-[#E5E2DC]">
                      <img src={s.image} alt={s.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-110 transition duration-500" />
                    </div>
                    <div className="text-center mt-2 text-xs font-medium text-[#1C1C1C]">{s.name}</div>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-6 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[#595959] uppercase">Shop for:</span>
              {[["", "Everyone"], ["women", "Women"], ["men", "Men"], ["kids", "Kids"], ["unisex", "Unisex"]].map(([g, l]) => (
                <button key={g || "all"} onClick={() => setGender(g)} data-testid={`gender-${g || "all"}`}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${gender === g ? "bg-[#1A2B4C] text-white border-[#1A2B4C]" : "bg-white text-[#1C1C1C] border-[#E5E2DC]"}`}>
                  {l}
                </button>
              ))}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm text-[#595959]">{products.length} product{products.length !== 1 ? "s" : ""}</p>
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={14} className="text-[#595959]" />
              <select value={sort} onChange={(e) => setSort(e.target.value)} data-testid="sort-select" className="px-3 py-2 rounded-full bg-white border border-[#E5E2DC] text-xs">
                <option value="trending">Trending</option><option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option><option value="rating">Top Rated</option>
              </select>
            </div>
          </div>

          {products.length === 0 ? (
            <div className="mt-6 bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#E68910]/10 text-[#E68910] text-[11px] font-bold uppercase tracking-widest mb-3">Building it</div>
              <h3 className="font-display text-xl md:text-2xl font-bold text-[#1A2B4C]">Coming soon to {title} in Bhilai</h3>
              <p className="text-sm text-[#595959] mt-2 max-w-md mx-auto">We're onboarding local sellers right now — fresh drops will land here shortly.</p>
            </div>
          ) : (
            <div data-testid="cat-product-grid" className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
              {products.map((p) => <ProductCardV2 key={p.id} p={p} />)}
            </div>
          )}
        </div>

        {/* Offers rail — only inside an L2 view */}
        {showingL2 && offers.length > 0 && <OffersStrip offers={offers} />}
      </main>
      <Footer />
    </div>
  );
}
