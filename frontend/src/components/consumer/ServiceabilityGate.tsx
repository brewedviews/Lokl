"use client";

/**
 * ServiceabilityGate — Phase 9C. Mounted once in the (shop) route group's
 * layout (Home + every /c/[slug] category page — see that layout's own
 * doc comment for why this scope, not the whole (consumer) tree: account,
 * orders, search, checkout, PDP, stores etc. all stay reachable regardless
 * of serviceability, matching the audit's "don't rely exclusively on
 * checkout" instruction without also blocking pages a customer may
 * legitimately need from an unserviceable location, e.g. past orders).
 *
 * Pure routing between the FOUR things a shop-scoped page can show. The
 * actual decision lives entirely in useLocationServiceability() — this
 * component owns no serviceability logic of its own, only the render
 * branch:
 *
 *   "no-location"                → the marketplace (existing behavior,
 *                                   unchanged — nothing to check yet)
 *   "serviceable"                → the marketplace
 *   "checking"                   → a lightweight loading state (Phase 9C
 *                                   review pass — previously this fell
 *                                   through to the marketplace, which
 *                                   could silently read as "deliverable
 *                                   here" before we actually knew)
 *   "error"                      → a lightweight retry state (Phase 9C
 *                                   review pass — previously a failed
 *                                   check also fell through to the
 *                                   marketplace; a check that FAILED must
 *                                   never be presented as "so it's fine")
 *   "unserviceable"              → UnserviceableArea
 *
 * Backend Phase 9B's POST /api/orders serviceability enforcement is
 * completely untouched and remains the sole authority for whether an
 * order can be created — this gate only ever changes what's shown, never
 * what's allowed.
 */
import { Loader2 } from "lucide-react";
import { useLocationServiceability } from "@/hooks/useLocationServiceability";
import { UnserviceableArea } from "./UnserviceableArea";

export function ServiceabilityGate({ children }: { children: React.ReactNode }) {
  const { status, lat, lng, area, message, retry } = useLocationServiceability();

  if (status === "unserviceable") {
    return <UnserviceableArea lat={lat} lng={lng} area={area} />;
  }

  if (status === "checking") {
    return <CheckingState />;
  }

  if (status === "error") {
    return <ErrorState onRetry={retry} message={message} />;
  }

  return <>{children}</>;
}

// Lightweight, Lokl-styled — not a full skeleton (Phase 9B/9C: the
// underlying check is a fast local API call; a heavier loading UI would
// itself feel like more of a "something's wrong" signal than the brief
// moment it's actually up for).
function CheckingState() {
  return (
    <div
      data-testid="serviceability-checking"
      className="flex-1 flex flex-col items-center justify-center py-24 text-center"
    >
      <Loader2 size={24} className="animate-spin text-brand-accent" />
      <p className="mt-3 text-sm text-text-secondary">Checking delivery for your area…</p>
    </div>
  );
}

function ErrorState({ onRetry, message }: { onRetry: () => void; message: string | null }) {
  return (
    <div
      data-testid="serviceability-error"
      className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center"
    >
      <p className="text-sm font-bold text-brand-primary">Couldn&apos;t check delivery for your area</p>
      <p className="mt-1 text-[13px] text-text-secondary">
        {message || "Check your connection and try again."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        data-testid="serviceability-retry"
        className="mt-4 inline-flex items-center justify-center rounded-full bg-brand-accent text-white text-sm font-bold px-6 py-2.5 active:scale-95 transition"
      >
        Retry
      </button>
    </div>
  );
}
