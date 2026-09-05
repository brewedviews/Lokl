"use client";

/**
 * useLocationServiceability — Phase 9C (hardened in the Phase 9C review
 * pass). Answers ONE question for the marketplace-wide "are we even
 * showing this customer the shop?" gate: is their CURRENT location inside
 * Lokl's delivery footprint.
 *
 * This is deliberately a different question, and a different hook, from
 * useServiceability.ts (which checks the logged-in customer's SAVED
 * ADDRESS, pincode-only, purely for the product-page delivery banner).
 * This hook instead reads useLocationStore — the same store ConsumerHeader's
 * LocationChip already reads/writes (device GPS via "Use current location",
 * or whichever saved address the customer taps in that picker) — because
 * that store is what the rest of the app already treats as "where the
 * customer effectively is right now" for browsing purposes (nearby-stores
 * distance sorting, etc.), guest or logged-in.
 *
 * Authoritative source: the SAME backend endpoint AddressPinPicker.tsx
 * already calls for live pin feedback, GET /api/delivery/check-serviceability
 * (backend's _address_is_serviceable — polygon-with-pincode-fallback,
 * hardened fail-closed in Phase 9B). No polygon math, whitelist, or
 * serviceability decision is duplicated in JS here — this hook is a thin
 * client for that one backend decision, exactly like AddressPinPicker.
 *
 * A note on "never pass device GPS" — _address_is_serviceable's own
 * docstring warns against substituting the shopper's live device GPS for
 * a delivery ADDRESS's pin at ORDER-CREATION time (that exact substitution
 * caused three shipped-and-reverted bugs there). This hook does not create
 * orders and never feeds POST /api/orders — it's discovery-time-only, and
 * checking a browsing location's serviceability is precisely what
 * check-serviceability already exists for (AddressPinPicker uses it the
 * same way, live, as the customer drags a pin). Phase 9B's backend gate at
 * order time is untouched and remains the sole authority for any order.
 *
 * STATUS MODEL (revised in the Phase 9C review pass — the previous version
 * folded "no location to check" and "a check that FAILED" into the same
 * "unknown" bucket, which silently let the marketplace render even when a
 * check had genuinely been attempted and errored):
 *
 *   "no-location"   — nothing to check at all: no location-store pin, no
 *                      confirmed saved address, and no manually-entered
 *                      pincode. There's no signal a check could even run
 *                      against. The gate preserves today's existing
 *                      behavior here — normal browsing — exactly as it
 *                      did before any of this existed.
 *   "checking"       — a check is genuinely in flight for a real pin. The
 *                      gate shows a lightweight loading state; it must
 *                      NEVER present the marketplace as if serviceability
 *                      were already confirmed.
 *   "serviceable"    — backend confirmed the pin (or, in the no-pin
 *                      fallback below, the saved address) is deliverable.
 *   "unserviceable"  — backend confirmed it is NOT deliverable.
 *   "error"          — a check WAS attempted (we had a real pin) and the
 *                      request itself failed. This is deliberately its
 *                      OWN state, distinct from "no-location" — we asked
 *                      the question and don't have an answer, which must
 *                      never be silently read as "so it must be fine."
 *                      The gate shows a lightweight retry state instead of
 *                      the marketplace.
 *
 * The no-pin saved-address FALLBACK (useServiceability()) has no error/
 * loading state of its own to surface — its own internal fetch already
 * swallows failures into "no confirmed address" (see that hook's own
 * source), which maps cleanly onto "no-location" here without needing to
 * touch that hook. Only the pin-based primary path (the one that performs
 * a real, awaited network call from THIS hook) gets the "checking"/"error"
 * treatment — deliberately scoped this way rather than reaching into
 * useServiceability.ts, which is shared by other, unrelated call sites.
 *
 * PRIORITY (Phase 10 adds the third tier): a location-store PIN > a
 * logged-in customer's confirmed SAVED ADDRESS > a manually-entered
 * PINCODE (useLocationStore.pincode, set by LocationRequiredState's
 * fallback input when GPS isn't available/granted) > "no-location". The
 * manual pincode gets its own "checking"/"error" treatment for the same
 * reason the pin does — it performs a real, awaited network call
 * (deliveryApi.checkServiceability({ pincode }), the SAME endpoint and
 * SAME backend decision as every other tier — no second serviceability
 * algorithm), so a failed request must surface as "error", never as
 * "no-location" or "serviceable".
 *
 * `area` — a best-effort, DISPLAY-ONLY human label for the current
 * location (e.g. "Sector 6", "Bengaluru") — never used for any
 * serviceability decision. This exists because useLocationStore's own
 * cluster/cityName fields are unreliable for this purpose: setLocation()
 * hardcodes cluster to the literal string "Bhilai" regardless of where
 * the point actually is (a pre-existing bug found during the Phase 9C
 * screenshot review — out of scope to fix at its source, see this hook's
 * own resolution instead). Two sources, in priority order, matching the
 * task's own guidance ("if existing data already has it, use it; otherwise
 * use the existing cities/detect mechanism"):
 *   1. No pin, resolved via the saved-address fallback → useServiceability()
 *      already fetched and exposes `area` (the address's own label/city) —
 *      reused as-is, zero extra network cost.
 *   2. A pin resolved to "unserviceable" → GET /api/v1/cities/detect, the
 *      SAME endpoint LocationBanner.tsx already calls for this exact
 *      purpose (reverse-geocoding a point to a friendly city name) — only
 *      fired once we know the answer is "unserviceable" (no point
 *      resolving a label for a location we're not going to show a label
 *      for), and only ONE call site now (previously this lookup was
 *      duplicated inside the "Request Lokl in your area" CTA at submit
 *      time — consolidated here so every consumer reads the same value).
 */
import { useCallback, useEffect, useState } from "react";
import { useLocationStore } from "@/stores/location.store";
import { useServiceability } from "@/hooks/useServiceability";
import { deliveryApi } from "@/lib/api/delivery";
import { apiClient } from "@/lib/api-client";

export type LocationServiceabilityStatus =
  | "no-location"
  | "checking"
  | "serviceable"
  | "unserviceable"
  | "error";

export interface LocationServiceabilityResult {
  status: LocationServiceabilityStatus;
  isUnserviceable: boolean;
  message: string | null;
  /** The lat/lng this determination was made against, when we had one —
   *  handed straight through to the "Request Lokl in your area" CTA so it
   *  doesn't need to re-read the location store itself. */
  lat: number | null;
  lng: number | null;
  /** Best-known human label for the current location — DISPLAY ONLY, see
   *  file doc comment. Null while unresolved/unavailable; callers should
   *  fall back to a generic phrase ("your area"), never to a guessed name. */
  area: string | null;
  /** Re-runs the pin-based check against the SAME lat/lng — only
   *  meaningful (and only ever needed) from the "error" state. */
  retry: () => void;
}

export function useLocationServiceability(): LocationServiceabilityResult {
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const pincode = useLocationStore((s) => s.pincode);
  const savedAddress = useServiceability(); // { hasConfirmedAddress, serviceable, area }

  const [pinStatus, setPinStatus] = useState<"checking" | "serviceable" | "unserviceable" | "error">("checking");
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const retry = useCallback(() => setRetryToken((t) => t + 1), []);

  // Manual-pincode tier (Phase 10) — only relevant once there's no pin and
  // no confirmed saved address (see priority note above); its own effect
  // so it doesn't race the pin-based one.
  const hasNoPinOrAddress = lat == null && lng == null && !savedAddress.hasConfirmedAddress;
  const [pincodeStatus, setPincodeStatus] = useState<"checking" | "serviceable" | "unserviceable" | "error">("checking");
  const [pincodeMessage, setPincodeMessage] = useState<string | null>(null);
  const [pincodeRetryToken, setPincodeRetryToken] = useState(0);
  const retryPincode = useCallback(() => setPincodeRetryToken((t) => t + 1), []);

  useEffect(() => {
    if (lat == null || lng == null) return; // nothing to check — the no-pin branch below governs
    let alive = true;
    setPinStatus("checking");
    setPinMessage(null);
    deliveryApi
      .checkServiceability({ lat, lng })
      .then((r) => {
        if (!alive) return;
        setPinStatus(r.serviceable ? "serviceable" : "unserviceable");
        setPinMessage(r.message || null);
      })
      .catch(() => {
        // The request itself failed — this is "error", never "serviceable"
        // and never silently "no-location". See file doc comment.
        if (!alive) return;
        setPinStatus("error");
        setPinMessage(null);
      });
    return () => {
      alive = false;
    };
  }, [lat, lng, retryToken]);

  // Best-effort reverse-geocoded label for a pin that resolved unserviceable
  // — only fires once we actually need a name to show. A failure here just
  // leaves `area` null; callers fall back to a generic phrase, never a
  // guessed/wrong one (no useLocationStore.cluster/cityName involved).
  const [pinArea, setPinArea] = useState<string | null>(null);
  useEffect(() => {
    if (pinStatus !== "unserviceable" || lat == null || lng == null) {
      setPinArea(null);
      return;
    }
    let alive = true;
    apiClient
      .get<{ city_name?: string | null }>("/api/v1/cities/detect", { params: { lat, lng } })
      .then((r) => {
        if (alive) setPinArea(r.data.city_name || null);
      })
      .catch(() => {
        if (alive) setPinArea(null);
      });
    return () => {
      alive = false;
    };
  }, [pinStatus, lat, lng]);

  useEffect(() => {
    if (!hasNoPinOrAddress || !pincode) {
      return; // nothing to check — either a stronger tier already answers this, or no pincode was entered
    }
    let alive = true;
    setPincodeStatus("checking");
    setPincodeMessage(null);
    deliveryApi
      .checkServiceability({ pincode })
      .then((r) => {
        if (!alive) return;
        setPincodeStatus(r.serviceable ? "serviceable" : "unserviceable");
        setPincodeMessage(r.message || null);
      })
      .catch(() => {
        if (!alive) return;
        setPincodeStatus("error");
        setPincodeMessage(null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNoPinOrAddress, pincode, pincodeRetryToken]);

  // A single retry() re-runs whichever tier is actually active — bumping
  // the OTHER tier's token is inert (its effect's own guard clause keeps
  // it from running when that tier isn't the one in use), so callers never
  // need to know which tier they're retrying.
  const combinedRetry = useCallback(() => {
    retry();
    retryPincode();
  }, [retry, retryPincode]);

  // A location-store pin (present or in flight) always takes priority over
  // the saved-address fallback — it's the more precise, more current
  // signal. Only fall back when there's genuinely no pin to check at all,
  // so the two async sources never race/flicker against each other.
  if (lat != null && lng != null) {
    return {
      status: pinStatus,
      isUnserviceable: pinStatus === "unserviceable",
      message: pinMessage,
      lat,
      lng,
      area: pinArea,
      retry: combinedRetry,
    };
  }

  if (savedAddress.hasConfirmedAddress) {
    const status: LocationServiceabilityStatus = savedAddress.serviceable ? "serviceable" : "unserviceable";
    return {
      status,
      isUnserviceable: !savedAddress.serviceable,
      message: null,
      lat: null,
      lng: null,
      area: savedAddress.area,
      retry: combinedRetry,
    };
  }

  if (pincode) {
    return {
      status: pincodeStatus,
      isUnserviceable: pincodeStatus === "unserviceable",
      message: pincodeMessage,
      lat: null,
      lng: null,
      area: pincode,
      retry: combinedRetry,
    };
  }

  return { status: "no-location", isUnserviceable: false, message: null, lat: null, lng: null, area: null, retry: combinedRetry };
}
