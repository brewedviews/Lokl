import React, { useEffect, useState } from "react";
import { AlertCircle, MapPin } from "lucide-react";
import {
  getPermissionState,
  isUserInService,
  readStored,
  requestBrowserLocation,
  onLocationChange,
} from "../../lib/location";

// Replaces the old hard-coded "Lokl currently serves Bhilai…" callout.
// Rules:
//  - permission "granted" + in service area  → render nothing
//  - permission "granted" + outside service  → orange callout
//  - permission "denied" / "skipped"         → subtle neutral CTA to enable
//  - permission "unknown"                    → render nothing (LocationGate is up)
export default function LocationBanner() {
  const [, force] = useState(0);
  useEffect(() => onLocationChange(() => force((n) => n + 1)), []);

  const state = getPermissionState();
  if (state === "unknown") return null;

  if (state === "granted") {
    if (isUserInService()) return null;
    return (
      <div data-testid="away-banner" className="bg-[#E68910]/10 border-b border-[#E68910]/30 text-[#0A1F5C] text-xs md:text-sm">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-2 flex items-center gap-2 flex-wrap">
          <AlertCircle size={14} className="text-[#E68910] shrink-0" />
          <span>
            Lokl currently serves <strong>Bhilai</strong>. We'll let you know the moment we launch in your area.
          </span>
        </div>
      </div>
    );
  }

  // denied / skipped — subtle CTA only
  const ask = async () => { await requestBrowserLocation(); };
  return (
    <div data-testid="location-cta-banner" className="bg-[#0A1F5C]/[0.05] border-b border-[#0A1F5C]/15 text-[#0A1F5C] text-xs md:text-sm">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-2 flex items-center gap-2 flex-wrap">
        <MapPin size={14} className="text-[#0A1F5C] shrink-0" />
        <span>Enable location for nearby stores and accurate delivery estimates.</span>
        <button
          onClick={ask}
          data-testid="enable-location-cta"
          className="ml-auto text-[10px] uppercase tracking-widest font-semibold hover:text-[#E68910] transition"
        >
          Enable
        </button>
      </div>
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
