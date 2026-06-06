import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Search as SearchIcon } from "lucide-react";
import api from "../lib/api";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import ProductCard from "../components/consumer/ProductCard";

export default function SearchPage() {
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const q = params.get("q") || "";
  const [data, setData] = useState({ products: [], stores: [] });
  const [cats, setCats] = useState([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (!q) { setData({ products: [], stores: [] }); setBusy(false); return; }
    setBusy(true);
    api.get(`/search?q=${encodeURIComponent(q)}&limit=60`).then((r) => setData(r.data || { products: [], stores: [] }))
      .finally(() => setBusy(false));
  }, [q]);

  useEffect(() => {
    api.get("/categories").then((r) => setCats(r.data)).catch(() => {});
  }, []);

  const hasResults = data.products.length > 0 || data.stores.length > 0;

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <div className="flex items-center gap-3 mb-6">
          <SearchIcon size={20} className="text-[#E68910]" />
          <h1 className="display text-2xl md:text-3xl font-bold text-[#1A2B4C]">
            {q ? <>Results for <span className="text-[#E68910]">"{q}"</span></> : "Search"}
          </h1>
        </div>

        {busy && <p className="text-sm text-[#595959]">Searching…</p>}

        {!busy && data.stores.length > 0 && (
          <section className="mb-10">
            <h2 className="text-[11px] uppercase tracking-widest text-[#595959] mb-3">Stores</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {data.stores.map((s) => (
                <Link key={s.id} to={`/store/${s.id}`} data-testid={`search-store-${s.id}`} className="bg-white rounded-2xl overflow-hidden border border-[#E5E2DC] hover:border-[#1A2B4C] transition">
                  <div className="aspect-[4/3] bg-[#FDFBF7]"><img src={s.banner || s.image} alt={s.name} loading="lazy" className="w-full h-full object-cover" /></div>
                  <div className="p-3">
                    <div className="font-semibold text-[#1A2B4C] truncate">{s.name}</div>
                    {s.tagline && <div className="text-[11px] text-[#595959] truncate">{s.tagline}</div>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {!busy && data.products.length > 0 && (
          <section className="mb-10">
            <h2 className="text-[11px] uppercase tracking-widest text-[#595959] mb-3">Products ({data.products.length})</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
              {data.products.map((p) => <ProductCard key={p.id} p={p} />)}
            </div>
          </section>
        )}

        {!busy && !hasResults && q && (
          <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center mb-10">
            <p className="text-sm text-[#595959]">No matches for "{q}". Try a different keyword.</p>
          </div>
        )}

        {/* Always-on category shortcut */}
        <section className="border-t border-[#E5E2DC] pt-8">
          <h3 className="display text-xl md:text-2xl font-bold text-[#1A2B4C]">Didn't get what you searched for?</h3>
          <p className="text-sm text-[#595959] mt-1 mb-5">Shop by category instead.</p>
          <div className="grid grid-cols-3 md:grid-cols-7 gap-3 md:gap-4">
            {cats.map((c) => (
              <Link key={c.id} to={`/c/${c.slug}`} data-testid={`search-cat-${c.slug}`} className="group">
                <div className="aspect-square rounded-2xl overflow-hidden bg-white border border-[#E5E2DC]">
                  <img src={c.image} alt={c.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-110 transition duration-500" />
                </div>
                <div className="text-center mt-2 text-xs md:text-sm font-medium text-[#1C1C1C]">{c.name}</div>
              </Link>
            ))}
          </div>
        </section>
      </div>
      <Footer />
    </div>
  );
}
