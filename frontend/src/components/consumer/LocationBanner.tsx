"use client";

/**
 * Soft serviceability banner. When the customer has granted a location
 * outside the Bhilai delivery footprint, we surface a friendly, dismissable
 * banner instead of blocking discovery. Checkout already enforces the
 * Bhilai-only rule server-side; this is purely a UX nudge.
 *
 * Backend: GET /api/v1/cities/detect?lat=…&lng=…
 */
import { useEffect, useState } from "react";
import { MapPin, X } from "lucide-react";
import { useLocationStore } from "@/stores/location.store";
import { apiClient } from "@/lib/api-client";

const DISMISS_KEY = "lokl_loc_banner_dismissed_v1";

export function LocationBanner() {
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const cityName = useLocationStore((s) => s.cityName);
  const [outOfService, setOutOfService] = useState<{ slug: string; name?: string } | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);

  // Hydrate the dismissed flag on mount only — SSR-safe.
  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === "1"); } catch { /* private-mode */ }
  }, []);

  useEffect(() => {
    if (lat == null || lng == null) { setOutOfService(null); return; }
    let alive = true;
    apiClient.get<{ city_slug: string; city_name?: string | null }>(
      `/api/v1/cities/detect?lat=${lat}&lng=${lng}`,
    )
      .then((r) => {
        if (!alive) return;
        const slug = r.data.city_slug;
        if (slug === "bhilai") { setOutOfService(null); return; }
        setOutOfService({ slug, name: r.data.city_name || undefined });
      })
      .catch(() => { if (alive) setOutOfService(null); });
    return () => { alive = false; };
  }, [lat, lng]);

  if (!outOfService || dismissed) return null;

  return (
    <div data-testid="location-banner" role="status"
      className="bg-[#E68910]/15 border-b border-[#E68910]/30 text-[#0A1F5C]">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-3 text-xs">
        <MapPin size={14} className="text-[#E68910] shrink-0" />
        <span className="flex-1">
          We don&apos;t deliver to <strong>{outOfService.name || "your area"}</strong> yet —
          you&apos;re browsing <strong>{cityName || "Bhilai"}</strong> for now.
        </span>
        <button
          onClick={() => {
            try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private-mode */ }
            setDismissed(true);
          }}
          data-testid="location-banner-dismiss"
          className="shrink-0 p-1 rounded-full hover:bg-[#E68910]/20"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
