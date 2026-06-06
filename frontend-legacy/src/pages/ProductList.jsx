import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import api from "../lib/api";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import ProductCard from "../components/consumer/ProductCard";

export default function ProductList() {
  const [sp, setSp] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [sort, setSort] = useState(sp.get("sort") || "trending");
  const cat = sp.get("category") || "";

  useEffect(() => {
    api.get("/categories").then((r) => setCategories(r.data));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (cat) params.set("category", cat);
    if (sort) params.set("sort", sort);
    api.get(`/products?${params.toString()}`).then((r) => setProducts(r.data));
  }, [cat, sort]);

  const setCat = (c) => {
    const next = new URLSearchParams(sp);
    if (c) next.set("category", c); else next.delete("category");
    setSp(next);
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-10">
        <h1 data-testid="plp-title" className="display text-4xl md:text-5xl font-bold text-[#1A2B4C]">All products</h1>
        <p className="text-[#595959] mt-2">{products.length} pieces from stores near you</p>

        <div className="mt-8 flex flex-wrap gap-2 overflow-x-auto no-scrollbar">
          <button onClick={() => setCat("")} data-testid="filter-all"
            className={`px-4 py-2 rounded-full text-sm whitespace-nowrap border transition ${!cat ? "bg-[#1A2B4C] text-white border-[#1A2B4C]" : "bg-white text-[#1C1C1C] border-[#E5E2DC] hover:border-[#1A2B4C]"}`}>
            All
          </button>
          {categories.map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)} data-testid={`filter-${c.slug}`}
              className={`px-4 py-2 rounded-full text-sm whitespace-nowrap border transition ${cat === c.id ? "bg-[#1A2B4C] text-white border-[#1A2B4C]" : "bg-white text-[#1C1C1C] border-[#E5E2DC] hover:border-[#1A2B4C]"}`}>
              {c.name}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-[#595959]" />
            <select value={sort} onChange={(e) => setSort(e.target.value)} data-testid="sort-select"
              className="px-3 py-2 rounded-full bg-white border border-[#E5E2DC] text-sm">
              <option value="trending">Trending</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="rating">Top Rated</option>
            </select>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          {products.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      </div>
      <Footer />
    </div>
  );
}
