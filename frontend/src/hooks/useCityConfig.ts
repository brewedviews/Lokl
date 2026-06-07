/**
 * useCityConfig — fetches & caches delivery_config for a city once per
 * session. Backs `useDeliveryEta` and any other client-side delivery math.
 *
 * Backend: GET /api/v1/cities/{slug}
 */
import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";

export interface DeliveryTier {
  tier_name: string;
  min_km: number;
  max_km: number;
  base_fee: number;
  per_km_fee: number;
  free_above_order_value: number;
}
export interface EtaConfig {
  base_prep_minutes: number;
  per_km_minutes: number;
  peak_hours?: string[];
  peak_multiplier?: number;
}
export interface CityConfig {
  city_slug: string;
  city_name: string;
  state?: string;
  is_active?: boolean;
  max_delivery_radius_km?: number;
  delivery_tiers?: DeliveryTier[];
  eta_config?: EtaConfig;
}

// Module-level cache — once a city has been fetched it stays available to
// every card/store/page for the rest of the session.
const cache = new Map<string, CityConfig>();

export function useCityConfig(slug: string = "bhilai"): CityConfig | null {
  const [config, setConfig] = useState<CityConfig | null>(cache.get(slug) ?? null);

  useEffect(() => {
    if (cache.has(slug)) { setConfig(cache.get(slug)!); return; }
    let alive = true;
    apiClient.get<CityConfig>(`/api/v1/cities/${slug}`)
      .then((r) => { if (!alive) return; cache.set(slug, r.data); setConfig(r.data); })
      .catch(() => { /* silent — caller falls back to static eta */ });
    return () => { alive = false; };
  }, [slug]);

  return config;
}
