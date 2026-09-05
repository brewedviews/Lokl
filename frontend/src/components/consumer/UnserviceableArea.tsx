"use client";

/**
 * UnserviceableArea — Phase 9C. The full "Lokl isn't here yet" screen,
 * shown instead of the marketplace when useLocationServiceability()
 * confirms the customer's current location is outside Lokl's delivery
 * footprint. Presentation only — see ServiceabilityGate.tsx for where the
 * decision to render this is made, and useLocationServiceability.ts for
 * how that decision (and the `area` label below) is reached (the
 * backend's own _address_is_serviceable, never a duplicated frontend
 * polygon).
 *
 * `lat`/`lng`/`area` are passed down from ServiceabilityGate's ONE call to
 * useLocationServiceability() rather than this component calling the hook
 * again — calling it twice would fire a second, redundant
 * check-serviceability request and risk the two independently-resolving
 * copies briefly disagreeing.
 *
 * Reuses, rather than re-implements:
 *   - LocationChip (ConsumerHeader.tsx, variant="block") for the current-
 *     location display AND the "Change location" action — same saved-
 *     address list, same detect-current-location, same picker sheet/
 *     dropdown the header itself uses. Tapping it is the ONLY location-
 *     change entry point on this screen; there is no second flow. Its
 *     `label` prop is set to the resolved `area` (see file doc comment
 *     above) so this screen never shows LocationChip's own default
 *     resolution, which can read "Bhilai" for a point confirmed outside
 *     Bhilai (Phase 9C review pass fix — see ConsumerHeader.tsx's own
 *     doc comment on that prop for the root cause).
 *   - api.site.joinWaitlist() (existing /api/waitlist, already used by the
 *     pre-launch coming-soon page) for "Request Lokl in your area" — a
 *     real, already-admin-visible (GET /admin/waitlist) demand-capture
 *     mechanism, extended with optional area/lat/lng/source fields (Phase
 *     9C) rather than a new endpoint. Dedup is free: the backend's
 *     existing phone+type unique key already prevents a repeat request
 *     from creating a second row.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useCustomerAuthStore } from "@/stores";
import { LocationChip } from "./ConsumerHeader";
import { UnserviceableAreaArt } from "./UnserviceableAreaArt";

export function UnserviceableArea({
  lat, lng, area,
}: {
  lat: number | null;
  lng: number | null;
  area: string | null;
}) {
  const phone = useCustomerAuthStore((s) => s.phone);
  const displayLabel = area || "your area";

  return (
    <div
      data-testid="unserviceable-area"
      className="flex-1 flex flex-col items-center px-5 sm:px-8 pt-6 pb-12 sm:pb-16"
    >
      <div className="w-full max-w-sm mx-auto">
        <LocationChip phone={phone} variant="block" label={displayLabel} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center max-w-sm mx-auto w-full">
        <div className="mt-4 mb-2">
          <UnserviceableAreaArt />
        </div>

        <h1 className="font-display font-bold text-brand-primary text-[26px] sm:text-[30px] leading-tight tracking-tight mt-2">
          Lokl isn&apos;t here yet
        </h1>
        <p className="mt-2.5 text-[14.5px] text-text-secondary leading-relaxed">
          We&apos;re growing across Bhilai, one neighbourhood at a time —
          and yours could be next.
        </p>

        <div className="w-full mt-7">
          <RequestAreaCTA lat={lat} lng={lng} area={area} />
        </div>

        <p className="mt-4 text-[12.5px] text-text-secondary/80">
          Already serviceable nearby? Use{" "}
          <span className="font-semibold text-brand-primary">Change</span>{" "}
          above to switch your location.
        </p>
      </div>
    </div>
  );
}

// ─── Request-in-your-area CTA ────────────────────────────────────────────
// Not a fake button — posts to the real, already-admin-visible waitlist
// mechanism (see file doc comment). Mirrors ComingSoonGetStarted's
// CustomerCard interaction shape (phone → submit → inline success), the
// established Lokl pattern for this exact kind of one-field demand capture,
// but skips the phone field entirely for an already-logged-in customer.
function RequestAreaCTA({
  lat, lng, area,
}: {
  lat: number | null;
  lng: number | null;
  area: string | null;
}) {
  const phone = useCustomerAuthStore((s) => s.phone);

  const [expanded, setExpanded] = useState(false);
  const [guestPhone, setGuestPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const submit = async (targetPhone: string) => {
    setStatus("submitting");
    setError("");
    try {
      await api.site.joinWaitlist({
        phone: targetPhone,
        type: "customer",
        area: area || undefined,
        lat,
        lng,
        source: "unserviceable_area",
      });
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Something went wrong — please try again.");
    }
  };

  if (status === "done") {
    return (
      <div
        data-testid="request-area-success"
        className="flex items-center justify-center gap-2 text-sm font-bold text-[#2E7D32] bg-[#E8F5E9] rounded-2xl px-5 py-4"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 13l4 4L19 7" stroke="#2E7D32" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        You&apos;re on the list — we&apos;ll let you know
      </div>
    );
  }

  if (phone) {
    return (
      <div className="w-full">
        <button
          type="button"
          onClick={() => void submit(phone)}
          disabled={status === "submitting"}
          data-testid="request-area-cta"
          className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand-accent text-white text-[15px] font-bold px-8 py-4 active:scale-[0.98] transition disabled:opacity-70"
        >
          {status === "submitting" && <Loader2 size={16} className="animate-spin" />}
          Request Lokl in your area
        </button>
        {status === "error" && (
          <p className="text-xs text-red-500 mt-2 text-center" data-testid="request-area-error">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        data-testid="request-area-cta"
        className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand-accent text-white text-[15px] font-bold px-8 py-4 active:scale-[0.98] transition"
      >
        Request Lokl in your area
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const digits = guestPhone.replace(/\D/g, "");
        if (digits.length < 10) {
          setError("Enter a valid 10-digit phone number");
          return;
        }
        void submit(digits);
      }}
      data-testid="request-area-form"
      className="w-full"
    >
      <input
        type="tel"
        inputMode="numeric"
        maxLength={10}
        value={guestPhone}
        onChange={(e) => setGuestPhone(e.target.value)}
        placeholder="WhatsApp number"
        data-testid="request-area-phone-input"
        className="w-full px-4 py-3.5 rounded-2xl border-[1.5px] border-card-border bg-brand-bg text-sm text-brand-primary outline-none focus:border-brand-accent focus:bg-white transition mb-2.5"
        autoFocus
      />
      <button
        type="submit"
        disabled={status === "submitting"}
        data-testid="request-area-submit"
        className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand-accent text-white text-[15px] font-bold px-8 py-4 active:scale-[0.98] transition disabled:opacity-70"
      >
        {status === "submitting" && <Loader2 size={16} className="animate-spin" />}
        Notify me
      </button>
      {error && (
        <p className="text-xs text-red-500 mt-2 text-center" data-testid="request-area-error">
          {error}
        </p>
      )}
    </form>
  );
}
