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

// Replaces the old hard-coded "Lokl currently serves Bhilai…" callout AND
// doubles as the Swiggy-style address strip when the user is in-service.
//
// Rules:
//  - unknown / denied / skipped  → CTA banner: "Enable location for nearby
//                                  stores and accurate delivery estimates"
//                                  (clicking triggers the native browser
//                                  prompt, no custom modal).
//  - granted + outside Bhilai    → compact orange callout, single line, with
//                                  truncate so it doesn't bloat the layout.
//  - granted + inside Bhilai     → mobile-only address strip showing the
//                                  primary saved address (if any) OR the
//                                  user's pinned location + 30 min ETA.
//                                  Desktop hides this because the right-side
//                                  "Bhilai" tile in the header already covers it.
export default function LocationBanner() {
  const [, force] = useState(0);
  useEffect(() => onLocationChange(() => force((n) => n + 1)), []);

  const state = getPermissionState();

  if (state === "granted") {
    if (isUserInService()) return <AddressStrip />;
    return (
      <div data-testid="away-banner" className="bg-[#E68910]/10 border-b border-[#E68910]/30 text-[#0A1F5C] text-xs md:text-sm">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-2 flex items-center gap-2">
          <AlertCircle size={14} className="text-[#E68910] shrink-0" />
          <span className="truncate">
            Lokl currently serves <strong>Bhilai</strong>. We'll let you know the moment we launch in your area.
          </span>
        </div>
      </div>
    );
  }

  // unknown / denied / skipped — single thin strip CTA. Clicking triggers the
  // native browser permission directly (no custom modal).
  const ask = async () => { await requestBrowserLocation(); };
  return (
    <div data-testid="location-cta-banner" className="bg-[#0A1F5C]/[0.05] border-b border-[#0A1F5C]/15 text-[#0A1F5C] text-xs md:text-sm">
      <button
        type="button"
        onClick={ask}
        data-testid="enable-location-cta"
        className="w-full max-w-7xl mx-auto px-4 md:px-8 py-2 flex items-center gap-2 text-left hover:bg-[#0A1F5C]/[0.03] transition"
      >
        <MapPin size={14} className="text-[#0A1F5C] shrink-0" />
        <span className="truncate">Enable location for nearby stores and accurate delivery estimates.</span>
        <span className="ml-auto text-[10px] uppercase tracking-widest font-bold text-[#E68910] shrink-0">Enable</span>
      </button>
    </div>
  );
}

// Swiggy-style strip: single tappable row with "Deliver to {label/area} · {eta}"
// Only renders on mobile (md:hidden). Tappable → /account?tab=addresses.
function AddressStrip() {
  const nav = useNavigate();
  const [primary, setPrimary] = useState(null);

  useEffect(() => {
    const phone = localStorage.getItem("bf_customer_phone");
    if (!phone) return;
    api.get(`/customer/${phone}`).then((r) => {
      const list = r?.data?.customer?.addresses || [];
      // "primary" address = the first one (we don't have an explicit primary
      // flag yet — first-added is treated as default per the Address book).
      setPrimary(list[0] || null);
    }).catch(() => {});
  }, []);

  const headline = primary
    ? `${primary.label || "Home"} · ${primary.line1?.split(",")[0] || primary.city || "Bhilai"}${primary.pincode ? `, ${primary.pincode}` : ""}`
    : "Your location · Bhilai";

  return (
    <div
      data-testid="address-strip"
      className="md:hidden bg-white border-b border-[#E5E2DC]"
    >
      <button
        type="button"
        onClick={() => nav("/account?tab=addresses")}
        className="w-full max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-2 text-left active:bg-[#FDFBF7]"
        data-testid="address-strip-cta"
      >
        <MapPin size={15} className="text-[#E68910] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#64748B] leading-none">Deliver to</div>
          <div className="text-[13px] font-semibold text-[#0A1F5C] truncate mt-0.5">{headline}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-[#0A1F5C] font-semibold">
          <Clock size={12} className="text-[#4F7363]" /> 30 min
          <ChevronDown size={14} className="text-[#94A3B8]" />
        </div>
      </button>
    </div>
  );
}

// Helper so other components can read the latest coords reactively
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
