"use client";

/**
 * Delivery + serviceability line for the product page. Pincode-based —
 * NOT GPS — via the shared useServiceability() hook (lib/serviceability.ts
 * under the hood), so this and checkout's own serviceability banner can
 * never disagree.
 *
 * Guests, and customers with no saved address yet, get a generic Bhilai-wide
 * line instead of a false "unserviceable" — a negative result only ever
 * shows once a real saved pincode has actually failed the check.
 *
 * redesign-plan 3.7 retrofit moved the happy-path ETA out of
 * ProductDetailPanel's store-info row and into a standalone card here, to
 * avoid two competing ETA surfaces. G11 §12 reverses that specific call —
 * the standalone "Delivers in ~45 min" card read as a separate product
 * selling point rather than store metadata — so the happy path renders
 * NOTHING here now; ProductDetailPanel's store-info row shows the real ETA
 * inline instead ("{store} · {area} · {eta} min delivery"), via the same
 * useServiceability() hook this component uses, so there is still only
 * ONE serviceability check and only one place ETA actually renders on the
 * happy path — it just moved back to metadata instead of a dedicated card.
 * This component remains the sole owner of the unserviceable-pincode and
 * closed-store messages, which G11 does not ask to change.
 *
 * The closed-state duplicated-string bug fix ("opens at Opens at 9:30 AM")
 * is unchanged — see the comment on opensAtTime below.
 */
import { Bike, MapPin } from "lucide-react";
import { useServiceability } from "@/hooks/useServiceability";

export function DeliveryServiceability({
  isClosed = false,
  isOffline = false,
  opensAtLabel,
}: {
  isClosed?: boolean;
  /** Store-Offline is a distinct state from Closed (see ProductDetailPanel's
   *  own isOffline/isClosed split) — offline gets no message here at all;
   *  the CTA row's own "Notify Me" state already covers that case. */
  isOffline?: boolean;
  opensAtLabel?: string | null;
}) {
  const { area, hasConfirmedAddress, serviceable } = useServiceability();

  if (hasConfirmedAddress && !serviceable) {
    return (
      <div
        className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-100 text-xs text-red-600 font-medium"
        data-testid="pdp-unserviceable"
      >
        <MapPin size={14} className="shrink-0" />
        not deliverable to {area || "your saved address"} yet — we&apos;re expanding soon
      </div>
    );
  }

  // Open + serviceable — the happy path. G11 §12: ETA now renders inline
  // in ProductDetailPanel's store-info row instead of a standalone card
  // here — see this file's own top comment.
  if (isOffline) return null;
  if (!isClosed) return null;

  // `opensAtLabel` arrives from the backend already as a full phrase
  // ("Opens at 9:30 AM" / "Opens tomorrow at 9:30 AM") — prefixing another
  // "opens at" in front of it was the duplicated-string bug ("opens at
  // Opens at 9:30 AM"). Strip the leading "Opens" so this component owns
  // the single "Opens" that starts the compressed label, whichever form
  // the backend sent.
  const opensAtTime = opensAtLabel ? opensAtLabel.replace(/^Opens\s+/, "").trim() : null;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-warm-gray-border"
      data-testid="pdp-delivery-line"
    >
      <Bike size={14} className="text-slate-gray shrink-0" />
      <span className="text-xs font-bold text-ink-navy">Opens {opensAtTime || "soon"}</span>
    </div>
  );
}
