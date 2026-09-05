"use client";

/**
 * LocationOnboardingGate — Phase 10. Mounted OUTSIDE ServiceabilityGate in
 * (shop)/layout.tsx (Home + category pages only — same scoping rationale
 * ServiceabilityGate itself already documents: account/orders/checkout/
 * search/PDP/stores stay reachable without first establishing a location).
 *
 *     (shop)/layout
 *         -> LocationOnboardingGate   (this file)
 *             -> ServiceabilityGate   (unchanged, untouched)
 *                 -> marketplace / UnserviceableArea
 *
 * Owns exactly one question this hook doesn't already answer on its own:
 * "has this session established ANY location signal yet." It reuses
 * useLocationServiceability() verbatim for that — "no-location" IS "no
 * signal established yet" — so there is no second serviceability system,
 * no new persisted "have I onboarded" flag, and no duplicated backend
 * call. A returning session's persisted lat/lng (or a logged-in
 * customer's confirmed saved address, or a previously-entered pincode)
 * already makes the hook report something other than "no-location", which
 * is exactly what lets this gate skip straight to {children} for them.
 *
 * State machine:
 *   "hydrating"          — zustand persist hasn't rehydrated on the client
 *                           yet (same one-tick-wait convention already
 *                           used elsewhere, e.g. AdminLayoutClient/
 *                           LocationChip's useMounted) — render the
 *                           interstitial's shell so there's no flash of
 *                           the wrong content while this resolves. For a
 *                           returning session this tick is imperceptibly
 *                           short (no artificial hold applied), so
 *                           "returning users don't see the interstitial"
 *                           holds in practice, not just in the reached-
 *                           after-1s case.
 *   "interstitial"        — ONLY entered when, post-hydration, status is
 *                           genuinely "no-location" — held for an
 *                           approximate minimum visual duration (not
 *                           forced longer than that; there's nothing else
 *                           async to wait on before the next step is
 *                           ready, since LocationRequiredState is a static
 *                           form, not a network call).
 *   "location-required"   — LocationRequiredState (Allow location / manual
 *                           pincode). Left automatically the moment the
 *                           hook's status moves off "no-location" — i.e.
 *                           the moment GPS or a pincode actually resolves
 *                           to a real answer.
 *   "ready"               — render {children} (ServiceabilityGate) as
 *                           normal, forever, until this component unmounts
 *                           (e.g. full page navigation away from (shop)).
 */
import { useEffect, useRef, useState } from "react";
import { useLocationServiceability } from "@/hooks/useLocationServiceability";
import { FirstLoadInterstitial } from "./FirstLoadInterstitial";
import { LocationRequiredState } from "./LocationRequiredState";

const MIN_INTERSTITIAL_MS = 1000;

type Phase = "hydrating" | "interstitial" | "location-required" | "ready";

export function LocationOnboardingGate({ children }: { children: React.ReactNode }) {
  const { status } = useLocationServiceability();
  const [hydrated, setHydrated] = useState(false);
  const [phase, setPhase] = useState<Phase>("hydrating");
  const interstitialStartedAt = useRef<number | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  // Resolve out of "hydrating" exactly once, based on the FIRST post-
  // hydration status read — a returning session (status !== "no-location")
  // skips straight to "ready"; a genuine no-location session enters
  // "interstitial" and starts its minimum-duration timer.
  useEffect(() => {
    if (!hydrated || phase !== "hydrating") return;
    if (status === "no-location") {
      interstitialStartedAt.current = Date.now();
      setPhase("interstitial");
    } else {
      setPhase("ready");
    }
    // Only ever fires the "hydrating" -> next transition once; later status
    // changes are handled by the effects below, not this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, phase]);

  // Hold the interstitial for its minimum visual duration, then reveal
  // the location-required step.
  useEffect(() => {
    if (phase !== "interstitial") return;
    const elapsed = Date.now() - (interstitialStartedAt.current ?? Date.now());
    const remaining = Math.max(0, MIN_INTERSTITIAL_MS - elapsed);
    const t = setTimeout(() => setPhase("location-required"), remaining);
    return () => clearTimeout(t);
  }, [phase]);

  // Once genuinely in location-required, only a DEFINITIVELY resolved
  // status — serviceable or unserviceable — means we're done onboarding.
  // "checking" (a pin/pincode request in flight) and "error" (it failed)
  // must NOT reveal the shell early — LocationRequiredState renders its
  // own loading/error sub-views for exactly those two statuses, so this
  // gate has nothing further to decide until the answer actually lands.
  useEffect(() => {
    if (phase === "location-required" && (status === "serviceable" || status === "unserviceable")) {
      setPhase("ready");
    }
  }, [phase, status]);

  if (phase === "hydrating" || phase === "interstitial") {
    return <FirstLoadInterstitial />;
  }
  if (phase === "location-required") {
    return <LocationRequiredState />;
  }
  return <>{children}</>;
}
