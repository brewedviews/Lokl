"use client";

/**
 * AddressPinPicker — Group C3 (reworked from Group C2's Mapbox version).
 * Lets a customer, after typing an address, optionally set a precise
 * delivery PIN — no map, no third-party maps dependency. Mirrors
 * /merchant/storefront's own location-capture pattern exactly: a
 * "use my current location" button (navigator.geolocation) is the
 * confirm step, with an approximate area-centroid (BHILAI_AREAS, the same
 * table the merchant flow uses) as a starting/fallback point when the
 * address already has a pincode. See docs/investigation on why we dropped
 * Mapbox: merchants already solve this for free with geolocation alone.
 *
 * SAFETY — read before touching this file: the pin this component produces
 * is the DELIVERY ADDRESS's own coordinate, saved as address.lat/address.lng.
 * It is never the shopper's live device GPS, and it never feeds any location
 * store used for that purpose (useLocationStore, customer_lat/customer_lng on
 * the order payload). We've shipped and reverted the shopper-GPS-as-
 * serviceability-gate bug three times — keep those two concepts apart. The
 * "use my current location" button below is a CONVENIENCE that seeds the pin
 * with the browser's geolocation reading — it's the customer choosing their
 * delivery spot, not a device-location check.
 *
 * Pinning is OPTIONAL. Skipping it leaves lat/lng null and the address still
 * saves fine — serviceability falls back to the pincode whitelist
 * server-side (_address_is_serviceable).
 */
import { useEffect, useMemo, useState } from "react";
import { MapPin, LocateFixed, Check, X, Loader2, CircleCheck, CircleAlert, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { findBhilaiAreaByPincode } from "@/data/bhilai-areas";

interface Point { lat: number; lng: number }
type PinSource = "gps" | "area" | null;

interface AddressPinPickerProps {
  lat: number | null | undefined;
  lng: number | null | undefined;
  /** The address's pincode, if typed yet — used to seed an approximate
   *  starting pin from BHILAI_AREAS (same table /merchant/storefront
   *  uses). Several areas can share a pincode; this is a starting point,
   *  never presented as a confirmed precise location. */
  pincode?: string | null;
  onChange: (lat: number | null, lng: number | null) => void;
}

export function AddressPinPicker({ lat, lng, pincode, onChange }: AddressPinPickerProps) {
  const hasCommittedPin = lat != null && lng != null;

  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<Point | null>(hasCommittedPin ? { lat, lng } : null);
  const [pinSource, setPinSource] = useState<PinSource>(null);
  const [locating, setLocating] = useState(false);

  const areaCentroid = useMemo(() => findBhilaiAreaByPincode(pincode), [pincode]);

  // The point currently being evaluated for serviceability feedback: the
  // in-progress pin while the panel is open, else the already-committed pin.
  const current: Point | null = expanded ? pending : (hasCommittedPin ? { lat, lng } : null);

  const [serviceable, setServiceable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!current) { setServiceable(null); setChecking(false); return; }
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(() => {
      api.delivery.checkServiceability({ lat: current.lat, lng: current.lng })
        .then((r) => { if (!cancelled) setServiceable(r.serviceable); })
        .catch(() => { if (!cancelled) setServiceable(null); })
        .finally(() => { if (!cancelled) setChecking(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.lat, current?.lng]);

  const openMap = () => {
    if (hasCommittedPin) {
      setPending({ lat, lng });
      // pinSource unknown on reopen of an already-saved pin — leave as-is
      // (no precision claim rather than a guess).
    } else if (areaCentroid) {
      setPending({ lat: areaCentroid.lat, lng: areaCentroid.lng });
      setPinSource("area");
    } else {
      setPending(null);
      setPinSource(null);
    }
    setExpanded(true);
  };

  const cancelEdit = () => {
    setExpanded(false);
    setPending(hasCommittedPin ? { lat, lng } : null);
  };

  const confirmPin = () => {
    if (!pending) return;
    onChange(pending.lat, pending.lng);
    setExpanded(false);
  };

  const removePin = () => {
    onChange(null, null);
    setPending(null);
    setPinSource(null);
  };

  // Same handler as /merchant/storefront's useCurrentLocation — identical
  // geolocation options, identical intent (confirm the exact spot).
  const useCurrentLocation = () => {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation isn't supported on this device");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPending({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setPinSource("gps");
        setLocating(false);
        toast.success("Pinned to your current location");
      },
      (err) => { setLocating(false); toast.error(err?.message || "Could not access location"); },
      { timeout: 10000, enableHighAccuracy: true },
    );
  };

  // --------- Collapsed: no pin yet ---------
  if (!expanded && !hasCommittedPin) {
    return (
      <div data-testid="address-pin-prompt">
        <button
          type="button"
          onClick={openMap}
          data-testid="address-pin-open-btn"
          className="w-full flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 border-dashed border-[#E5E2DC] text-[#0A1F5C] hover:border-[#E68910] hover:bg-[#E68910]/[0.04] transition"
        >
          <MapPin size={16} className="text-[#E68910] shrink-0" />
          <span className="text-sm font-semibold text-left flex-1">Drop a pin for accurate delivery</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">Optional</span>
        </button>
      </div>
    );
  }

  // --------- Collapsed: pin already set ---------
  if (!expanded && hasCommittedPin) {
    return (
      <div data-testid="address-pin-confirmed" className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-[#E5E2DC] bg-[#FDFBF7]">
        <MapPin size={16} className="text-[#E68910] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#0A1F5C]">
            Pin set
            {pinSource === "area" && <span className="text-[#64748B] font-normal"> — approximate, based on your area</span>}
            {pinSource === "gps" && <span className="text-[#64748B] font-normal"> — your current location</span>}
          </p>
          <ServiceabilityNote checking={checking} serviceable={serviceable} compact />
        </div>
        <button type="button" onClick={openMap} data-testid="address-pin-change-btn" className="p-2 text-[#64748B] hover:text-[#0A1F5C]" aria-label="Change pin">
          <Pencil size={14} />
        </button>
        <button type="button" onClick={removePin} data-testid="address-pin-remove-btn" className="p-2 text-[#64748B] hover:text-rose-500" aria-label="Remove pin">
          <Trash2 size={14} />
        </button>
      </div>
    );
  }

  // --------- Expanded: geolocation confirm step (no map) ---------
  return (
    <div data-testid="address-pin-map-panel" className="border border-[#E5E2DC] rounded-2xl overflow-hidden p-4 space-y-3">
      <div>
        <p className="text-xs font-semibold text-[#0A1F5C]">Pin your exact delivery location</p>
        <p className="text-[11px] text-[#64748B] mt-0.5">
          Tap &quot;Use my current location&quot; when you&apos;re at the delivery address for accurate delivery.
          Otherwise we&apos;ll use your area.
        </p>
      </div>

      <button
        type="button"
        onClick={useCurrentLocation}
        disabled={locating}
        data-testid="address-pin-use-location-btn"
        className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-[#0A1F5C] text-white text-sm font-semibold disabled:opacity-60"
      >
        {locating ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />}
        {locating ? "Locating…" : "Use my current location"}
      </button>

      {pending ? (
        <div className="text-[11px] text-[#0A1F5C] bg-white border border-[#E5E2DC] rounded-xl px-3 py-2" data-testid="address-pin-readout">
          Pin set: <strong>{pending.lat.toFixed(5)}, {pending.lng.toFixed(5)}</strong>
          {pinSource === "area" && <span className="text-[#64748B]"> (approximate — based on your area)</span>}
          {pinSource === "gps" && <span className="text-[#64748B]"> (your current location)</span>}
        </div>
      ) : (
        <p className="text-[11px] text-[#94A3B8]">
          {pincode && pincode.trim().length === 6 && !areaCentroid
            ? "No area match for this pincode yet — use your current location to set a pin."
            : "Enter a pincode above, or use your current location, to set a pin."}
        </p>
      )}

      <ServiceabilityNote checking={checking} serviceable={serviceable} />

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={cancelEdit} data-testid="address-pin-cancel-btn"
          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full border border-[#E5E2DC] text-[#0A1F5C] text-sm font-semibold">
          <X size={14} /> Cancel
        </button>
        <button type="button" onClick={confirmPin} disabled={!pending} data-testid="address-pin-confirm-btn"
          className="flex-[2] inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-[#E68910] text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
          <Check size={14} /> Confirm pin location
        </button>
      </div>
    </div>
  );
}

function ServiceabilityNote({ checking, serviceable, compact }: { checking: boolean; serviceable: boolean | null; compact?: boolean }) {
  if (checking) {
    return (
      <p className={`inline-flex items-center gap-1.5 text-[11px] text-[#64748B] ${compact ? "" : ""}`} data-testid="address-pin-checking">
        <Loader2 size={11} className="animate-spin" /> Checking delivery area…
      </p>
    );
  }
  if (serviceable === true) {
    return (
      <p className={`inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#4F7363] ${compact ? "" : ""}`} data-testid="address-pin-serviceable">
        <CircleCheck size={12} /> Looks deliverable
      </p>
    );
  }
  if (serviceable === false) {
    return (
      <p className={`inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 ${compact ? "" : ""}`} data-testid="address-pin-unserviceable">
        <CircleAlert size={12} /> This location looks outside our delivery area — you can still save it
      </p>
    );
  }
  return null;
}
