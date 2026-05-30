import React, { useEffect, useState } from "react";
import { AlertCircle, MapPin, ChevronDown, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  getPermissionState,
  isUserInService,
  readStored,
  requestBrowserLocation,
  onLocationChange,
} from "../../lib/location";
import api from "../../lib/api";

// Thin strip below the header.
// States:
//  - unknown / denied / skipped  → tappable "Enable location…" CTA strip.
//  - granted + outside Bhilai    → 1-2 line orange "we serve Bhilai" callout.
//  - granted + inside Bhilai     → Swiggy-style address strip (mobile only).
//
// Copy is no longer truncated — the strip allows the text to wrap to a second
// line on narrow phones so users can read the full message in the smallest
// possible vertical footprint.
export default function LocationBanner() {
  const [, force] = useState(0);
  useEffect(() => onLocationChange(() => force((n) => n + 1)), []);

  const state = getPermissionState();

  if (state === "granted") {
    if (isUserInService()) return <AddressStrip />;
    return (
      <div data-testid="away-banner" className="bg-[#E68910]/10 border-b border-[#E68910]/30 text-[#0A1F5C]">
        <div className="max-w-7xl mx-auto px-3 sm:px-8 py-1.5 flex items-start gap-2">
          <AlertCircle size={13} className="text-[#E68910] shrink-0 mt-[2px]" />
          <span className="text-[11px] sm:text-sm leading-snug">
            Lokl currently serves <strong>Bhilai</strong>. We'll let you know the moment we launch in your area.
          </span>
        </div>
      </div>
    );
  }

  // unknown / denied / skipped — strip with full wrapping copy.
  const ask = async () => { await requestBrowserLocation(); };
  return (
    <div data-testid="location-cta-banner" className="bg-[#0A1F5C]/[0.05] border-b border-[#0A1F5C]/15 text-[#0A1F5C]">
      <button
        type="button"
        onClick={ask}
        data-testid="enable-location-cta"
        className="w-full max-w-7xl mx-auto px-3 sm:px-8 py-1.5 flex items-start gap-2 text-left hover:bg-[#0A1F5C]/[0.03] transition"
      >
        <MapPin size={13} className="text-[#0A1F5C] shrink-0 mt-[2px]" />
        <span className="text-[11px] sm:text-sm leading-snug flex-1">
          Enable location for nearby stores and accurate delivery estimates.
        </span>
        <span className="text-[10px] uppercase tracking-widest font-bold text-[#E68910] shrink-0 mt-[1px]">Enable</span>
      </button>
    </div>
  );
}

// Mobile-only Swiggy-style address strip. Cleaner, single-row layout with the
// pin → "Deliver to {label · area · pincode}" → chevron + ETA right.
function AddressStrip() {
  const nav = useNavigate();
  const [primary, setPrimary] = useState(null);

  useEffect(() => {
    const phone = localStorage.getItem("bf_customer_phone");
    if (!phone) return;
    api.get(`/customer/${phone}`).then((r) => {
      const list = r?.data?.customer?.addresses || [];
      setPrimary(list[0] || null);
    }).catch(() => {});
  }, []);

  const headline = primary
    ? `${primary.label || "Home"} · ${primary.line1?.split(",")[0]?.trim() || primary.city || "Bhilai"}${primary.pincode ? ` · ${primary.pincode}` : ""}`
    : "Your location · Bhilai";

  return (
    <div data-testid="address-strip" className="md:hidden bg-white border-b border-[#E5E2DC]">
      <button
        type="button"
        onClick={() => nav("/account?tab=addresses")}
        className="w-full max-w-7xl mx-auto px-3 py-2 flex items-center gap-2.5 text-left active:bg-[#FDFBF7] transition"
        data-testid="address-strip-cta"
      >
        <div className="w-7 h-7 rounded-full bg-[#E68910]/10 grid place-items-center shrink-0">
          <MapPin size={13} className="text-[#E68910]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-[0.18em] text-[#64748B] leading-none font-semibold">Deliver to</div>
          <div className="text-[12.5px] font-semibold text-[#0A1F5C] truncate mt-0.5 leading-tight">{headline}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0 text-[11px] text-[#0A1F5C] font-semibold">
          <Clock size={11} className="text-[#4F7363]" /> 30 min
          <ChevronDown size={13} className="text-[#94A3B8] ml-0.5" />
        </div>
      </button>
    </div>
  );
}

export function useUserCoords() {
  const [coords, setCoords] = useState(() => {
    const s = readStored();
    return s?.state === "granted" ? { lat: s.lat, lng: s.lng } : null;
  });
  useEffect(() => onLocationChange((s) => {
    setCoords(s?.state === "granted" ? { lat: s.lat, lng: s.lng } : null);
  }), []);
  return coords;
}
