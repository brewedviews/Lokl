import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MapPin, Search, ShoppingBag, Store, User, AlertCircle, RefreshCw } from "lucide-react";
import { useCart } from "../../contexts/CartContext";
import api from "../../lib/api";
import useHeartbeat from "../../hooks/useHeartbeat";

export default function ConsumerHeader() {
  const [city] = useState("Bhilai"); // pilot is Bhilai-only
  const [detectedAway, setDetectedAway] = useState(null);
  const [q, setQ] = useState("");
  const { count } = useCart();
  const nav = useNavigate();
  const customerPhone = localStorage.getItem("bf_customer_phone") || null;
  useHeartbeat(customerPhone ? "customer" : "guest", { phone: customerPhone });

  useEffect(() => {
    localStorage.setItem("bf_city", "Bhilai");
    const probe = async () => {
      const callIp = async () => {
        try {
          const { data } = await api.get("/geo/detect");
          if (!data.supported) {
            const c = (data.detected_city || "").trim();
            setDetectedAway(c && c.toLowerCase() !== "unknown" ? c : "your area");
          }
        } catch { /* noop */ }
      };
      if (!navigator.geolocation) return callIp();
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const { data } = await api.get(`/geo/detect?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
            if (!data.supported) {
              const c = (data.detected_city || "").trim();
              setDetectedAway(c && c.toLowerCase() !== "unknown" ? c : "your area");
            }
          } catch { /* noop */ }
        },
        () => callIp(),
        { timeout: 6000, maximumAge: 600000 }
      );
    };
    probe();
  }, []);

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
          <div className="flex-1 hidden md:flex">
            <div className="flex w-full items-center gap-2 px-4 py-2.5 bg-white border border-[#E5E2DC] rounded-full focus-within:border-[#1A2B4C] transition">
              <Search size={16} className="text-[#595959]" />
              <input
                data-testid="search-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && nav(`/c/women?q=${encodeURIComponent(q)}`)}
                placeholder="Search kurtas, sneakers, boutique stores…"
                className="bg-transparent flex-1 outline-none text-sm"
              />
            </div>
          </div>

          {/* Mobile search (compact) */}
          <div className="flex-1 md:hidden">
            <div className="flex w-full items-center gap-2 px-3 py-2 bg-white border border-[#E5E2DC] rounded-full focus-within:border-[#1A2B4C] transition">
              <Search size={14} className="text-[#595959] shrink-0" />
              <input
                data-testid="search-input-mobile"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && nav(`/c/women?q=${encodeURIComponent(q)}`)}
                placeholder="Search…"
                className="bg-transparent flex-1 outline-none text-xs min-w-0"
              />
            </div>
          </div>

          <Link to="/stores" data-testid="nav-stores" className="hidden md:flex items-center gap-1.5 text-sm font-medium hover:text-[#E68910] transition">
            <Store size={16} /> Stores
          </Link>
          <Link to="/merchant/login" data-testid="nav-merchant" className="hidden md:inline text-sm font-medium hover:text-[#E68910] transition">
            For Merchants
          </Link>
          <Link to="/account" data-testid="nav-account" aria-label="Account" title="My account" className="w-9 h-9 rounded-full bg-white border border-[#E5E2DC] flex items-center justify-center hover:border-[#1A2B4C] transition shrink-0">
            <User size={16} />
          </Link>
          <Link to="/cart" data-testid="nav-cart" className="relative flex items-center gap-1 px-3 py-2 rounded-full bg-[#1A2B4C] text-white hover:bg-[#101D36] transition shrink-0">
            <ShoppingBag size={16} />
            {count > 0 && <span className="text-xs font-semibold">{count}</span>}
          </Link>
        </div>
      </header>

      {detectedAway && (
        <div data-testid="away-banner" className="bg-[#E68910]/10 border-b border-[#E68910]/30 text-[#1A2B4C] text-xs md:text-sm">
          <div className="max-w-7xl mx-auto px-4 md:px-8 py-2 flex items-center gap-2 flex-wrap">
            <AlertCircle size={14} className="text-[#E68910] shrink-0" />
            <span>
              Lokl currently serves <strong>Bhilai</strong>. We'll let you know when we're in <strong>{detectedAway}</strong>.
            </span>
            <button onClick={() => setDetectedAway(null)} className="ml-auto text-[10px] uppercase tracking-widest hover:text-[#E68910]">Dismiss</button>
          </div>
        </div>
      )}
    </>
  );
}
