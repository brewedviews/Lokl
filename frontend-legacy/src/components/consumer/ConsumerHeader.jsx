import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MapPin, Search, ShoppingBag, Store, User } from "lucide-react";
import { useCart } from "../../contexts/CartContext";
import api from "../../lib/api";
import useHeartbeat from "../../hooks/useHeartbeat";
import OrderStatusStrip from "./OrderStatusStrip";
import LocationBanner from "./LocationBanner";

export default function ConsumerHeader() {
  const [city] = useState("Bhilai"); // pilot is Bhilai-only
  const [q, setQ] = useState("");
  const [sug, setSug] = useState({ products: [], stores: [] });
  const [sugOpen, setSugOpen] = useState(false);
  const { count } = useCart();
  const nav = useNavigate();
  const customerPhone = localStorage.getItem("bf_customer_phone") || null;
  useHeartbeat(customerPhone ? "customer" : "guest", { phone: customerPhone });

  // Debounced typeahead
  useEffect(() => {
    if (!q || q.trim().length < 2) { setSug({ products: [], stores: [] }); return; }
    const t = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(q)}`).then((r) => setSug(r.data || { products: [], stores: [] })).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const submitSearch = (e) => {
    e?.preventDefault?.();
    setSugOpen(false);
    nav(`/search?q=${encodeURIComponent(q)}`);
  };

  const pickProduct = (p) => { setSugOpen(false); setQ(""); nav(`/p/${p.id}`); };
  const pickStore = (s) => { setSugOpen(false); setQ(""); nav(`/store/${s.id}`); };

  useEffect(() => { localStorage.setItem("bf_city", "Bhilai"); }, []);

  return (
    <>
      <header data-testid="consumer-header" className="sticky top-0 z-50 bf-glass border-b border-[#E5E2DC]">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-3 flex items-center gap-3 md:gap-6">
          <Link to="/" data-testid="brand-logo" className="flex items-center shrink-0">
            <span className="display text-2xl md:text-3xl font-bold tracking-tight text-[#1A2B4C]">lokl<span className="text-[#E68910]">.</span></span>
          </Link>

          <div data-testid="city-display" className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-[#E5E2DC] text-sm">
            <MapPin size={15} className="text-[#E68910]" />
            <span className="font-medium">{city}</span>
          </div>

          {/* Desktop search */}
          <form onSubmit={submitSearch} className="flex-1 hidden md:flex relative">
            <div className="flex w-full items-center gap-2 px-4 py-2.5 bg-white border border-[#E5E2DC] rounded-full focus-within:border-[#1A2B4C] transition">
              <Search size={16} className="text-[#595959]" />
              <input
                data-testid="search-input"
                value={q}
                onChange={(e) => { setQ(e.target.value); setSugOpen(true); }}
                onFocus={() => setSugOpen(true)}
                onBlur={() => setTimeout(() => setSugOpen(false), 200)}
                placeholder="Search kurtas, sneakers, store stores…"
                className="bg-transparent flex-1 outline-none text-sm"
              />
            </div>
            {sugOpen && q.trim().length >= 2 && (sug.products.length || sug.stores.length) > 0 && (
              <div data-testid="search-suggest" className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-2xl border border-[#E5E2DC] py-2 max-h-[60vh] overflow-y-auto z-50">
                {sug.stores.slice(0, 4).map((s) => (
                  <button type="button" key={s.id} onClick={() => pickStore(s)} className="w-full text-left px-4 py-2 hover:bg-[#FDFBF7] flex items-center gap-3" data-testid={`sug-store-${s.id}`}>
                    <img src={s.banner || s.image} alt="" className="w-10 h-10 rounded-lg object-cover" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#1A2B4C] truncate">{s.name}</div>
                      <div className="text-[11px] text-[#595959] truncate">Store · {s.area || ""}</div>
                    </div>
                  </button>
                ))}
                {sug.products.slice(0, 6).map((p) => (
                  <button type="button" key={p.id} onClick={() => pickProduct(p)} className="w-full text-left px-4 py-2 hover:bg-[#FDFBF7] flex items-center gap-3" data-testid={`sug-product-${p.id}`}>
                    <img src={p.image} alt="" className="w-10 h-10 rounded-lg object-cover" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#1A2B4C] truncate">{p.name}</div>
                      <div className="text-[11px] text-[#595959] truncate">{p.store_name} · ₹{Number(p.price).toLocaleString()}</div>
                    </div>
                  </button>
                ))}
                <button type="submit" className="w-full text-left px-4 py-2 hover:bg-[#FDFBF7] text-xs text-[#E68910] font-semibold border-t border-[#E5E2DC] mt-1">
                  Search all results for "{q}" →
                </button>
              </div>
            )}
          </form>

          {/* Mobile search */}
          <form onSubmit={submitSearch} className="flex-1 md:hidden relative">
            <div className="flex w-full items-center gap-2 px-3 py-2 bg-white border border-[#E5E2DC] rounded-full focus-within:border-[#1A2B4C] transition">
              <Search size={14} className="text-[#595959] shrink-0" />
              <input
                data-testid="search-input-mobile"
                value={q}
                onChange={(e) => { setQ(e.target.value); setSugOpen(true); }}
                onFocus={() => setSugOpen(true)}
                onBlur={() => setTimeout(() => setSugOpen(false), 200)}
                placeholder="Search…"
                className="bg-transparent flex-1 outline-none text-xs min-w-0"
              />
            </div>
            {sugOpen && q.trim().length >= 2 && (sug.products.length || sug.stores.length) > 0 && (
              <div data-testid="search-suggest-mobile" className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-2xl border border-[#E5E2DC] py-2 max-h-[60vh] overflow-y-auto z-50">
                {sug.stores.slice(0, 4).map((s) => (
                  <button type="button" key={s.id} onClick={() => pickStore(s)} className="w-full text-left px-4 py-2 hover:bg-[#FDFBF7] flex items-center gap-3" data-testid={`sug-store-${s.id}-m`}>
                    <img src={s.banner || s.image} alt="" className="w-9 h-9 rounded-lg object-cover" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-[#1A2B4C] truncate">{s.name}</div>
                      <div className="text-[10px] text-[#595959] truncate">Store · {s.area || ""}</div>
                    </div>
                  </button>
                ))}
                {sug.products.slice(0, 6).map((p) => (
                  <button type="button" key={p.id} onClick={() => pickProduct(p)} className="w-full text-left px-4 py-2 hover:bg-[#FDFBF7] flex items-center gap-3" data-testid={`sug-product-${p.id}-m`}>
                    <img src={p.image} alt="" className="w-9 h-9 rounded-lg object-cover" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-[#1A2B4C] truncate">{p.name}</div>
                      <div className="text-[10px] text-[#595959] truncate">{p.store_name} · ₹{Number(p.price).toLocaleString()}</div>
                    </div>
                  </button>
                ))}
                <button type="submit" className="w-full text-left px-4 py-2 hover:bg-[#FDFBF7] text-[11px] text-[#E68910] font-semibold border-t border-[#E5E2DC] mt-1">
                  Search all results for "{q}" →
                </button>
              </div>
            )}
          </form>

          <Link to="/stores" data-testid="nav-stores" className="hidden md:flex items-center gap-1.5 text-sm font-medium hover:text-[#E68910] transition">
            <Store size={16} /> Stores
          </Link>
          <Link to="/merchant/login" data-testid="nav-merchant" className="hidden md:inline text-sm font-medium hover:text-[#E68910] transition">
            For Merchants
          </Link>
          <Link to="/account" data-testid="nav-account" aria-label="Account" title="My account" className="hidden md:flex w-9 h-9 rounded-full bg-white border border-[#E5E2DC] items-center justify-center hover:border-[#1A2B4C] transition shrink-0">
            <User size={16} />
          </Link>
          <Link to="/cart" data-testid="nav-cart" className="relative flex items-center gap-1 px-3 py-2 rounded-full bg-[#1A2B4C] text-white hover:bg-[#101D36] transition shrink-0">
            <ShoppingBag size={16} />
            {count > 0 && <span className="text-xs font-semibold">{count}</span>}
          </Link>
        </div>
      </header>

      {detectedAwayPlaceholder}
      <LocationBanner />
      <OrderStatusStrip />
    </>
  );
}

// Removed dead detectedAway state — LocationBanner now handles every state.
const detectedAwayPlaceholder = null;
