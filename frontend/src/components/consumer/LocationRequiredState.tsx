"use client";

/**
 * LocationRequiredState — Phase 10. Shown by LocationOnboardingGate for a
 * genuinely first-time/no-location session, after the brand interstitial,
 * whenever useLocationServiceability() still reports "no-location" — i.e.
 * we have neither a GPS pin, a confirmed saved address, nor a manually-
 * entered pincode to check yet.
 *
 * "Location is required to enter the marketplace" does NOT mean "browser
 * GPS is mandatory" — this screen offers BOTH:
 *   - Allow location (useLocationStore.requestLocation(), the same action
 *     LocationChip's "Use current location" row already triggers — no
 *     second geolocation implementation), or
 *   - a manual pincode fallback, which sets useLocationStore.pincode and
 *     lets useLocationServiceability's own pincode tier check it via the
 *     SAME backend GET /api/delivery/check-serviceability endpoint every
 *     other tier already uses. No client-only serviceability logic exists
 *     here — this component only ever triggers a real check elsewhere and
 *     renders whatever status comes back.
 *
 * Once either path resolves the hook's status away from "no-location"
 * (serviceable, unserviceable, or a genuine error), LocationOnboardingGate
 * reacts and moves on — ServiceabilityGate (inside the real shell) takes
 * over from there exactly as it already does for every other entry point.
 *
 * If the browser has already denied permission (permission === "denied"),
 * browsers won't re-show the native prompt on another getCurrentPosition()
 * call anyway — so this leads with the pincode fallback instead of a
 * button that would silently no-op, and explains why in copy rather than
 * leaving the customer guessing.
 */
import { useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { useLocationStore } from "@/stores/location.store";
import { useLocationServiceability } from "@/hooks/useLocationServiceability";

export function LocationRequiredState() {
  const permission = useLocationStore((s) => s.permission);
  const requestLocation = useLocationStore((s) => s.requestLocation);
  const setPincode = useLocationStore((s) => s.setPincode);
  const { status, message, retry } = useLocationServiceability();

  const [requesting, setRequesting] = useState(false);
  const [pincodeInput, setPincodeInput] = useState("");
  const [pincodeError, setPincodeError] = useState("");

  const checking = status === "checking";
  const hasError = status === "error";
  const permissionDenied = permission === "denied";

  const handleAllowLocation = async () => {
    setRequesting(true);
    try {
      await requestLocation();
    } finally {
      setRequesting(false);
    }
  };

  const handlePincodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = pincodeInput.replace(/\D/g, "");
    if (digits.length !== 6) {
      setPincodeError("Enter a valid 6-digit pincode");
      return;
    }
    setPincodeError("");
    setPincode(digits);
  };

  return (
    <div
      data-testid="location-required-state"
      className="flex-1 min-h-screen bg-brand-bg flex flex-col items-center justify-center px-6 py-10 text-center"
    >
      <div className="w-full max-w-sm mx-auto">
        <div className="w-14 h-14 rounded-full bg-brand-accent/12 flex items-center justify-center mx-auto mb-5">
          <MapPin size={26} className="text-brand-accent" />
        </div>

        <h1 className="font-display font-bold text-brand-primary text-[22px] sm:text-[24px] leading-tight tracking-tight">
          Where should we deliver?
        </h1>
        <p className="mt-2.5 text-[14.5px] text-text-secondary leading-relaxed">
          We use your location to show the stores and products actually
          available near you.
        </p>

        {checking ? (
          <div
            data-testid="location-required-checking"
            className="mt-8 flex flex-col items-center gap-2 text-text-secondary"
          >
            <Loader2 size={22} className="animate-spin text-brand-accent" />
            <p className="text-sm">Checking delivery for your area…</p>
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            {!permissionDenied && (
              <button
                type="button"
                onClick={() => void handleAllowLocation()}
                disabled={requesting}
                data-testid="allow-location-cta"
                className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand-accent text-white text-[15px] font-bold px-8 py-4 active:scale-[0.98] transition disabled:opacity-70"
              >
                {requesting && <Loader2 size={16} className="animate-spin" />}
                Allow location
              </button>
            )}

            {permissionDenied && (
              <p
                data-testid="location-denied-explainer"
                className="text-[13px] text-text-secondary bg-white border border-card-border rounded-2xl px-4 py-3"
              >
                Location access is turned off in your browser. Enter your
                pincode below instead, or enable location in your browser
                settings and reload.
              </p>
            )}

            <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-wide text-text-secondary/70">
              <span className="flex-1 h-px bg-card-border" />
              {!permissionDenied && <span>or enter your pincode</span>}
              {permissionDenied && <span>Enter pincode</span>}
              <span className="flex-1 h-px bg-card-border" />
            </div>

            <form onSubmit={handlePincodeSubmit} data-testid="pincode-form" className="space-y-2.5">
              <input
                type="tel"
                inputMode="numeric"
                maxLength={6}
                value={pincodeInput}
                onChange={(e) => setPincodeInput(e.target.value)}
                placeholder="6-digit pincode"
                data-testid="pincode-input"
                className="w-full px-4 py-3.5 rounded-2xl border-[1.5px] border-card-border bg-white text-sm text-brand-primary text-center tracking-widest outline-none focus:border-brand-accent transition"
              />
              <button
                type="submit"
                data-testid="pincode-submit"
                className="w-full inline-flex items-center justify-center rounded-full border-2 border-brand-primary/15 text-brand-primary text-[14px] font-bold px-8 py-3.5 active:scale-[0.98] transition"
              >
                Check my area
              </button>
              {pincodeError && (
                <p className="text-xs text-red-500" data-testid="pincode-error">
                  {pincodeError}
                </p>
              )}
            </form>
          </div>
        )}

        {hasError && (
          <div className="mt-5" data-testid="location-required-error">
            <p className="text-[13px] text-text-secondary">
              {message || "Couldn't check delivery for your area."}
            </p>
            <button
              type="button"
              onClick={retry}
              data-testid="location-required-retry"
              className="mt-3 inline-flex items-center justify-center rounded-full bg-brand-accent text-white text-sm font-bold px-6 py-2.5 active:scale-95 transition"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
