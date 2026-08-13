"use client";

/**
 * AddressPinPicker — Group C2 (frontend for the C1 backend, address pin
 * coordinates + polygon serviceability). Lets a customer, after typing an
 * address, optionally drop/adjust a precise delivery PIN on a Mapbox map.
 *
 * SAFETY — read before touching this file: the pin this component produces
 * is the DELIVERY ADDRESS's own coordinate, saved as address.lat/address.lng.
 * It is never the shopper's live device GPS, and it never feeds any location
 * store used for that purpose (useLocationStore, customer_lat/customer_lng on
 * the order payload). We've shipped and reverted the shopper-GPS-as-
 * serviceability-gate bug three times — keep those two concepts apart. The
 * "use my current location" button below is a CONVENIENCE that seeds the pin
 * with the browser's geolocation reading, exactly like any other way of
 * placing the pin (dragging, tapping) — it's the customer choosing their
 * delivery spot, not a device-location check.
 *
 * Pinning is OPTIONAL. Skipping it (or Mapbox being unconfigured) leaves
 * lat/lng null and the address still saves fine — serviceability falls back
 * to the pincode whitelist server-side (_address_is_serviceable).
 *
 * Mapbox GL JS is loaded via dynamic import inside an effect, client-side
 * only — it touches WebGL/window at construction time and must never run
 * during SSR.
 */
import { useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, LocateFixed, Check, X, Loader2, CircleCheck, CircleAlert, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

// Bhilai centroid — same value as backend server.py's BHILAI_LAT/BHILAI_LNG
// and the checkout page's own constant. Used ONLY to center the map before
// a pin exists; it is never sent anywhere as a serviceability input.
const BHILAI_LAT = 21.1938;
const BHILAI_LNG = 81.3509;

interface Point { lat: number; lng: number }

interface AddressPinPickerProps {
  lat: number | null | undefined;
  lng: number | null | undefined;
  onChange: (lat: number | null, lng: number | null) => void;
}

export function AddressPinPicker({ lat, lng, onChange }: AddressPinPickerProps) {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const hasCommittedPin = lat != null && lng != null;

  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<Point | null>(hasCommittedPin ? { lat, lng } : null);
  const [locating, setLocating] = useState(false);
  const [mapError, setMapError] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  // The point currently being evaluated for serviceability feedback: the
  // in-progress pin while the map is open, else the already-committed pin.
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

  // Mount the Mapbox map once expanded. Unmounts on collapse so we don't
  // keep a live WebGL context around for a form that isn't showing it.
  useEffect(() => {
    if (!expanded || !mapboxToken || !containerRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const mod = await import("mapbox-gl");
        const mapboxgl = mod.default;
        if (cancelled || !containerRef.current) return;
        mapboxgl.accessToken = mapboxToken;

        const start = pending ?? { lat: BHILAI_LAT, lng: BHILAI_LNG };
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: "mapbox://styles/mapbox/streets-v12",
          center: [start.lng, start.lat],
          zoom: pending ? 16 : 13,
        });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
        // Auth/config failures (bad or missing token) surface as an async
        // 'error' event, not a thrown exception — a transient single tile
        // 404 at the edge of the map is normal and NOT fatal, so only treat
        // 401/403 (token rejected) as "map unusable."
        map.on("error", (e) => {
          const status = (e.error as unknown as { status?: number } | undefined)?.status;
          if (status === 401 || status === 403) setMapError(true);
        });

        const marker = new mapboxgl.Marker({ color: "#E68910", draggable: true })
          .setLngLat([start.lng, start.lat])
          .addTo(map);

        const commitFromMarker = () => {
          const { lat: mLat, lng: mLng } = marker.getLngLat();
          setPending({ lat: mLat, lng: mLng });
        };
        marker.on("dragend", commitFromMarker);
        // Tap-to-place: tapping anywhere on the map moves the pin there too.
        map.on("click", (e) => {
          marker.setLngLat(e.lngLat);
          commitFromMarker();
        });

        mapRef.current = map;
        markerRef.current = marker;
      } catch {
        if (!cancelled) setMapError(true);
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, mapboxToken]);

  const openMap = () => {
    setPending(hasCommittedPin ? { lat, lng } : null);
    setMapError(false);
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
  };

  const useCurrentLocation = () => {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation isn't supported on this device — drag the pin instead");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next: Point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPending(next);
        if (mapRef.current && markerRef.current) {
          markerRef.current.setLngLat([next.lng, next.lat]);
          mapRef.current.flyTo({ center: [next.lng, next.lat], zoom: 16 });
        }
        setLocating(false);
        toast.success("Pin set to your current location — drag to fine-tune");
      },
      (err) => { setLocating(false); toast.error(err?.message || "Couldn't access your location"); },
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
          disabled={!mapboxToken}
          data-testid="address-pin-open-btn"
          className="w-full flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 border-dashed border-[#E5E2DC] text-[#0A1F5C] hover:border-[#E68910] hover:bg-[#E68910]/[0.04] transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <MapPin size={16} className="text-[#E68910] shrink-0" />
          <span className="text-sm font-semibold text-left flex-1">Drop a pin for accurate delivery</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">Optional</span>
        </button>
        {!mapboxToken && (
          <p className="text-[11px] text-[#94A3B8] mt-1.5">Map preview isn&apos;t available right now — your pincode still works fine.</p>
        )}
      </div>
    );
  }

  // --------- Collapsed: pin already set ---------
  if (!expanded && hasCommittedPin) {
    return (
      <div data-testid="address-pin-confirmed" className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-[#E5E2DC] bg-[#FDFBF7]">
        <MapPin size={16} className="text-[#E68910] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#0A1F5C]">Pin set</p>
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

  // --------- Expanded: the map ---------
  return (
    <div data-testid="address-pin-map-panel" className="border border-[#E5E2DC] rounded-2xl overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[#0A1F5C]">Drag the pin to your exact location</p>
        <button type="button" onClick={useCurrentLocation} disabled={locating} data-testid="address-pin-use-location-btn"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#E68910] disabled:opacity-50">
          {locating ? <Loader2 size={12} className="animate-spin" /> : <LocateFixed size={12} />}
          Use my current location
        </button>
      </div>

      {!mapboxToken || mapError ? (
        <div className="mx-4 mb-3 py-10 text-center bg-[#FDFBF7] rounded-xl border border-[#E5E2DC]">
          <p className="text-sm text-[#64748B]">Map preview isn&apos;t available right now.</p>
          <p className="text-xs text-[#94A3B8] mt-1">You can still save this address — we&apos;ll use your pincode.</p>
        </div>
      ) : (
        <div ref={containerRef} data-testid="address-pin-mapbox-canvas" className="w-full h-64 sm:h-72 bg-[#E5E2DC]" />
      )}

      <div className="px-4 pt-2.5 pb-1">
        <ServiceabilityNote checking={checking} serviceable={serviceable} />
      </div>

      <div className="flex gap-2 px-4 py-3">
        <button type="button" onClick={cancelEdit} data-testid="address-pin-cancel-btn"
          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full border border-[#E5E2DC] text-[#0A1F5C] text-sm font-semibold">
          <X size={14} /> Cancel
        </button>
        <button type="button" onClick={confirmPin} disabled={!pending} data-testid="address-pin-confirm-btn"
          className="flex-[2] inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-[#E68910] text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
          <Check size={14} /> {pending ? "Confirm pin location" : "Drag or tap to place the pin"}
        </button>
      </div>
    </div>
  );
}

function ServiceabilityNote({ checking, serviceable, compact }: { checking: boolean; serviceable: boolean | null; compact?: boolean }) {
  if (checking) {
    return (
      <p className={`inline-flex items-center gap-1.5 text-[11px] text-[#64748B] ${compact ? "" : "mb-1"}`} data-testid="address-pin-checking">
        <Loader2 size={11} className="animate-spin" /> Checking delivery area…
      </p>
    );
  }
  if (serviceable === true) {
    return (
      <p className={`inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#4F7363] ${compact ? "" : "mb-1"}`} data-testid="address-pin-serviceable">
        <CircleCheck size={12} /> Looks deliverable
      </p>
    );
  }
  if (serviceable === false) {
    return (
      <p className={`inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 ${compact ? "" : "mb-1"}`} data-testid="address-pin-unserviceable">
        <CircleAlert size={12} /> This location looks outside our delivery area — you can still save it
      </p>
    );
  }
  return null;
}
