import React, { useEffect, useState } from "react";
import { MapPin, ShieldCheck } from "lucide-react";
import {
  getPermissionState,
  requestBrowserLocation,
  markSkipped,
  onLocationChange,
} from "../../lib/location";

// First-visit custom modal — shown only when permission state is "unknown".
// Clicking "Share Location" triggers the native browser prompt; copy is tuned
// for higher acceptance ("see nearby stores, accurate delivery times and
// distance-based delivery charges").
export default function LocationGate() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Auto-modal disabled per UX feedback (it blocked discovery on first visit).
    // The thin "Enable location" strip below the header is the single entry
    // point now — clicking it triggers the native browser permission directly.
    return onLocationChange((s) => { if (s?.state && s.state !== "unknown") setOpen(false); });
  }, []);

  if (!open) return null;

  const share = async () => {
    setBusy(true);
    await requestBrowserLocation();
    setBusy(false);
    setOpen(false);
  };

  const skip = () => { markSkipped(); setOpen(false); };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" data-testid="location-gate">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={skip} />
      <div className="relative bg-white w-full sm:max-w-md sm:mx-4 rounded-t-3xl sm:rounded-3xl p-6 sm:p-7 shadow-2xl">
        <div className="w-12 h-12 rounded-2xl bg-[#E68910]/12 grid place-items-center mb-4">
          <MapPin size={22} className="text-[#E68910]" />
        </div>
        <h2 className="text-xl sm:text-2xl font-display font-bold text-[#0A1F5C] leading-tight">
          See what's nearby
        </h2>
        <p className="text-sm text-[#64748B] mt-2 leading-relaxed">
          Share your location to see nearby stores, accurate delivery times and distance-based delivery charges.
        </p>
        <div className="mt-3 text-[11px] text-[#64748B] flex items-center gap-1.5">
          <ShieldCheck size={13} className="text-[#4F7363]" />
          <span>We only use your coords for distance — never tracked or sold.</span>
        </div>
        <div className="mt-6 flex flex-col-reverse sm:flex-row gap-2">
          <button
            onClick={skip}
            data-testid="location-skip"
            className="px-5 py-3 rounded-full border border-[#E5E2DC] text-[#0A1F5C] text-sm font-semibold hover:bg-[#FDFBF7] transition"
          >
            Not now
          </button>
          <button
            onClick={share}
            disabled={busy}
            data-testid="location-share"
            className="flex-1 px-5 py-3 rounded-full bg-[#0A1F5C] text-white text-sm font-semibold hover:bg-[#08174A] disabled:opacity-60 transition"
          >
            {busy ? "Asking your browser…" : "Share Location"}
          </button>
        </div>
      </div>
    </div>
  );
}
