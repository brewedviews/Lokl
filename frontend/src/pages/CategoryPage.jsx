import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import api from "../lib/api";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import ProductCard from "../components/consumer/ProductCard";

export default function CategoryPage() {
  const { slug } = useParams();
  const [cats, setCats] = useState([]);
  const [products, setProducts] = useState([]);
  const [activeL2, setActiveL2] = useState(null);
  const [gender, setGender] = useState("");
  const [sort, setSort] = useState("trending");

  const l1 = useMemo(() => cats.find((c) => c.slug === slug), [cats, slug]);
  const hasL2 = l1 && l1.l2 && l1.l2.length > 0;

  useEffect(() => {
    api.get("/categories").then((r) => setCats(r.data));
  }, []);

  useEffect(() => {
    if (!l1) return;
    const params = new URLSearchParams({ l1: l1.id, sort });
    if (activeL2) params.set("l2", activeL2);
    if (gender) params.set("gender", gender);
    api.get(`/products?${params.toString()}`).then((r) => setProducts(r.data));
  }, [l1, activeL2, gender, sort]);

  if (!l1) return <div className="min-h-screen bg-[#FDFBF7]"><ConsumerHeader /><div className="p-10 text-center text-[#595959]">Loading…</div></div>;

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <div className="flex items-center gap-2 text-xs text-[#595959] mb-2">
          <Link to="/" className="hover:text-[#1A2B4C]">Home</Link><span>›</span><span>{l1.name}</span>
        </div>
        <h1 data-testid="cat-title" className="display text-4xl md:text-5xl font-bold text-[#1A2B4C]">{l1.name}</h1>

        {hasL2 ? (
          <>
            <p className="text-[#595959] text-sm mt-1">Browse {l1.name.toLowerCase()} by category</p>
            <div className="mt-6 grid grid-cols-3 md:grid-cols-5 gap-3 md:gap-4">
              <button onClick={() => setActiveL2(null)} data-testid="l2-all" className={`group ${!activeL2 ? "ring-2 ring-[#E68910] ring-offset-2" : ""} rounded-2xl`}>
                <div className="aspect-square rounded-2xl overflow-hidden bg-[#1A2B4C] flex items-center justify-center">
                  <span className="text-white display font-bold text-sm md:text-base">All</span>
                </div>
                <div className="text-center mt-2 text-xs font-medium">All in {l1.name}</div>
              </button>
              {l1.l2.map((s) => (
                <button key={s.id} onClick={() => setActiveL2(s.id)} data-testid={`l2-${s.slug}`} className={`group ${activeL2 === s.id ? "ring-2 ring-[#E68910] ring-offset-2" : ""} rounded-2xl`}>
                  <div className="aspect-square rounded-2xl overflow-hidden bg-white border border-[#E5E2DC]">
                    <img src={s.image} alt={s.name} className="w-full h-full object-cover group-hover:scale-110 transition duration-500" />
                  </div>
                  <div className="text-center mt-2 text-xs font-medium text-[#1C1C1C]">{s.name}</div>
                </button>
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

        <div className="mt-8 flex items-center justify-between">
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
          <div className="mt-8 bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center text-sm text-[#595959]">
            No products in this category yet — check back as merchants go live.
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {products.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
