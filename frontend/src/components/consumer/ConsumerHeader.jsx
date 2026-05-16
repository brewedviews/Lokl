import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MapPin, Search, ShoppingBag, Store, Sparkles, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useCart } from "../../contexts/CartContext";
import api from "../../lib/api";

export default function ConsumerHeader() {
  const [city, setCity] = useState(localStorage.getItem("bf_city") || "");
  const [detecting, setDetecting] = useState(false);
  const [unsupportedNotice, setUnsupportedNotice] = useState(null);
  const [q, setQ] = useState("");
  const { count } = useCart();
  const nav = useNavigate();

  useEffect(() => {
    // Auto-detect on every load if no city yet — silent
    if (!city) runGeoDetect(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyCity = (c) => {
    setCity(c);
    localStorage.setItem("bf_city", c);
    window.dispatchEvent(new CustomEvent("bf-city-changed", { detail: c }));
  };

  const runGeoDetect = async (silent = false) => {
    setDetecting(true);
    setUnsupportedNotice(null);
    const callIp = async () => {
      try {
        const { data } = await api.get("/geo/detect");
        if (data.supported && data.city) applyCity(data.city);
        else {
          applyCity("Raipur");
          setUnsupportedNotice(data.detected_city || "your city");
        }
      } catch {
        applyCity("Raipur");
      } finally { setDetecting(false); }
    };

    if (!navigator.geolocation) return callIp();
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { data } = await api.get(`/geo/detect?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
          if (data.supported && data.city) applyCity(data.city);
          else {
            applyCity("Raipur");
            setUnsupportedNotice(data.detected_city || "your city");
          }
        } catch { applyCity("Raipur"); }
        finally { setDetecting(false); }
      },
      () => callIp(),
      { timeout: 6000, maximumAge: 600000 }
    );
  };

  return (
    <>
      <header data-testid="consumer-header" className="sticky top-0 z-50 bf-glass border-b border-[#E5E2DC]">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-3 flex items-center gap-3 md:gap-6">
          <Link to="/" data-testid="brand-logo" className="flex items-center gap-2 shrink-0">
            <div className="w-9 h-9 rounded-full bg-[#1A2B4C] flex items-center justify-center">
              <Sparkles size={18} className="text-[#E68910]" />
            </div>
            <span className="display text-xl md:text-2xl font-bold tracking-tight text-[#1A2B4C] hidden sm:inline">bharat<span className="text-[#E68910]">.</span></span>
          </Link>

          <button
            data-testid="city-display"
            onClick={() => runGeoDetect(false)}
            title="Click to re-detect your location"
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-[#E5E2DC] hover:border-[#1A2B4C] transition text-sm"
          >
            {detecting ? <Loader2 size={15} className="animate-spin text-[#E68910]" /> : <MapPin size={15} className="text-[#E68910]" />}
            <span className="font-medium">{city || "Detecting…"}</span>
            <RefreshCw size={11} className="text-[#595959]" />
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
          <Link to="/account" data-testid="nav-account" className="hidden md:flex items-center gap-1.5 text-sm font-medium hover:text-[#E68910] transition">
            <Store size={16} style={{ display: "none" }} /> Account
          </Link>
          <Link to="/cart" data-testid="nav-cart" className="relative flex items-center gap-1 px-3 py-2 rounded-full bg-[#1A2B4C] text-white hover:bg-[#101D36] transition">
            <ShoppingBag size={16} />
            {count > 0 && <span className="text-xs font-semibold">{count}</span>}
          </Link>
        </div>
      </header>

      {unsupportedNotice && (
        <div data-testid="unsupported-banner" className="bg-[#E68910]/10 border-b border-[#E68910]/30 text-[#1A2B4C] text-xs md:text-sm">
          <div className="max-w-7xl mx-auto px-4 md:px-8 py-2 flex items-center gap-2 flex-wrap">
            <AlertCircle size={14} className="text-[#E68910] shrink-0" />
            <span>
              We're not live in <strong>{unsupportedNotice}</strong> yet. Pilot is in <strong>Bhilai</strong> and <strong>Raipur</strong>. Showing Raipur for now.
            </span>
            <button onClick={() => setUnsupportedNotice(null)} className="ml-auto text-[10px] uppercase tracking-widest hover:text-[#E68910]">Dismiss</button>
          </div>
        </div>
      )}
    </>
  );
}
