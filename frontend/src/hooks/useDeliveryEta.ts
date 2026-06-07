/**
 * useDeliveryEta — compute live ETA minutes for a store the customer is
 * looking at. Uses the city `eta_config.base_prep_minutes` + `per_km_minutes`
 * when we know the distance, with `peak_multiplier` applied during peak
 * hours. Falls back to a static `fallback` minute count when we have no
 * distance (e.g., listings without a granted location).
 *
 * The hook NEVER blocks rendering — it returns the static fallback until
 * the city config lands, then re-renders with the dynamic number. That way
 * cards never go blank during boot.
 */
import { useMemo } from "react";
import { useCityConfig, type CityConfig } from "./useCityConfig";

const PEAK_RE = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function isPeak(config: CityConfig): boolean {
  const hours = config.eta_config?.peak_hours ?? [];
  const now = nowMinutes();
  for (const span of hours) {
    const m = PEAK_RE.exec(span);
    if (!m) continue;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const end = Number(m[3]) * 60 + Number(m[4]);
    if (now >= start && now <= end) return true;
  }
  return false;
}

export function useDeliveryEta(opts: {
  distanceKm?: number | null;
  fallback?: number;
  citySlug?: string;
}): number {
  const fallback = opts.fallback ?? 45;
  const cfg = useCityConfig(opts.citySlug ?? "bhilai");

  return useMemo(() => {
    if (!cfg || !cfg.eta_config) return fallback;
    if (opts.distanceKm == null || Number.isNaN(opts.distanceKm)) return fallback;
    // Out-of-footprint distances (e.g., a Delhi customer browsing Bhilai
    // stores) yield nonsense ETAs like 3,600 min. We treat those as
    // out-of-service and return the static fallback the card was seeded with.
    const maxKm = cfg.max_delivery_radius_km ?? 15;
    if (opts.distanceKm > maxKm) return fallback;
    const base = cfg.eta_config.base_prep_minutes;
    const perKm = cfg.eta_config.per_km_minutes;
    let minutes = base + perKm * opts.distanceKm;
    if (isPeak(cfg)) minutes *= cfg.eta_config.peak_multiplier ?? 1;
    return Math.max(10, Math.round(minutes));
  }, [cfg, opts.distanceKm, fallback]);
}
