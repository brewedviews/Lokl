import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MapPin, Search, ShoppingBag, Store, ChevronDown, Sparkles } from "lucide-react";
import { useCart } from "../../contexts/CartContext";

const cities = ["Jaipur", "Indore", "Lucknow", "Kanpur", "Surat", "Nagpur"];

export default function ConsumerHeader() {
  const [city, setCity] = useState(localStorage.getItem("bf_city") || "Jaipur");
  const [openCity, setOpenCity] = useState(false);
  const [q, setQ] = useState("");
  const { count } = useCart();
  const nav = useNavigate();

  const selectCity = (c) => {
    setCity(c);
    localStorage.setItem("bf_city", c);
    setOpenCity(false);
  };

  return (
    <header data-testid="consumer-header" className="sticky top-0 z-50 bf-glass border-b border-[#E5E2DC]">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-3 flex items-center gap-3 md:gap-6">
        <Link to="/" data-testid="brand-logo" className="flex items-center gap-2 shrink-0">
          <div className="w-9 h-9 rounded-full bg-[#1A2B4C] flex items-center justify-center">
            <Sparkles size={18} className="text-[#E68910]" />
          </div>
          <span className="display text-xl md:text-2xl font-bold tracking-tight text-[#1A2B4C] hidden sm:inline">bharat<span className="text-[#E68910]">.</span></span>
        </Link>

        <button
          data-testid="city-selector-btn"
          onClick={() => setOpenCity(!openCity)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-[#E5E2DC] hover:border-[#1A2B4C] transition text-sm relative"
        >
          <MapPin size={15} className="text-[#E68910]" />
          <span className="font-medium">{city}</span>
          <ChevronDown size={14} />
          {openCity && (
            <div className="absolute top-full left-0 mt-2 bg-white border border-[#E5E2DC] rounded-2xl shadow-lg py-2 min-w-[160px] z-50">
              {cities.map((c) => (
                <div key={c} onClick={() => selectCity(c)} data-testid={`city-option-${c.toLowerCase()}`}
                  className="px-4 py-2 hover:bg-[#FDFBF7] text-left text-sm">{c}</div>
              ))}
            </div>
          )}
        </button>

        <div className="flex-1 hidden md:flex">
          <div className="flex w-full items-center gap-2 px-4 py-2.5 bg-white border border-[#E5E2DC] rounded-full focus-within:border-[#1A2B4C] transition">
            <Search size={16} className="text-[#595959]" />
            <input
              data-testid="search-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && nav(`/shop?q=${encodeURIComponent(q)}`)}
              placeholder="Search kurtas, sneakers, boutique stores…"
              className="bg-transparent flex-1 outline-none text-sm"
            />
          </div>
        </div>

        <Link to="/stores" data-testid="nav-stores" className="hidden md:flex items-center gap-1.5 text-sm font-medium hover:text-[#E68910] transition">
          <Store size={16} /> Stores
        </Link>
        <Link to="/merchant/login" data-testid="nav-merchant" className="hidden md:inline text-sm font-medium hover:text-[#E68910] transition">
          For Merchants
        </Link>
        <Link to="/cart" data-testid="nav-cart" className="relative flex items-center gap-1 px-3 py-2 rounded-full bg-[#1A2B4C] text-white hover:bg-[#101D36] transition">
          <ShoppingBag size={16} />
          {count > 0 && <span className="text-xs font-semibold">{count}</span>}
        </Link>
      </div>
    </header>
  );
}
