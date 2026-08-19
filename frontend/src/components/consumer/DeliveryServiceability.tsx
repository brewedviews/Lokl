"use client";

/**
 * Delivery + serviceability line for the product page, positioned near the
 * CTA. Pincode-based — NOT GPS — reusing the exact same isServiceablePincode()
 * check checkout uses (lib/serviceability.ts) against the logged-in
 * customer's default (first) saved address, so this line and checkout's own
 * serviceability banner can never disagree.
 *
 * Guests, and customers with no saved address yet, get a generic Bhilai-wide
 * line instead of a false "unserviceable" — a negative result only ever
 * shows once a real saved pincode has actually failed the check.
 *
 * redesign-plan 3.7 retrofit: the open+serviceable happy path used to render
 * NOTHING here — the ETA lived instead as an inline text fragment inside
 * ProductDetailPanel's store-identity row ("{store} · {area} · ~45 min"),
 * specifically to avoid a second competing ETA box. Retrofitting the shared
 * ETAHeaderCard component here (per 3.7) would have recreated exactly that
 * duplication if the inline fragment stayed — so this component is now the
 * SINGLE owner of ETA display on the PDP for every state (happy path,
 * closed, unserviceable), and the inline store-row fragment was removed
 * (see ProductDetailPanel's own store-info-row comment). Same resolution
 * checkout already uses: one ETA surface per page, not two.
 *
 * The closed-state duplicated-string bug fix ("opens at Opens at 9:30 AM")
 * is unchanged — see the comment on opensAtTime below.
 */
import { useEffect, useState } from "react";
import { Bike, MapPin } from "lucide-react";
import { api } from "@/lib/api";
import { useCustomerAuthStore } from "@/stores";
import { isServiceablePincode } from "@/lib/serviceability";
import { ETAHeaderCard } from "./ETAHeaderCard";

export function DeliveryServiceability({
  isClosed = false,
  isOffline = false,
  opensAtLabel,
  etaMin,
}: {
  isClosed?: boolean;
  /** Store-Offline is a distinct state from Closed (see ProductDetailPanel's
   *  own isOffline/isClosed split) — the happy-path ETA card must not show
   *  "Delivers in ~N min" for a store that's offline, same as the original
   *  inline fragment this replaced explicitly excluded it too
   *  (`!isClosed && !isOffline`). Offline gets no message here at all; the
   *  CTA row's own "Notify Me" state already covers that case. */
  isOffline?: boolean;
  opensAtLabel?: string | null;
  /** Only used for the happy-path ETAHeaderCard — closed/unserviceable
   *  states have their own dedicated messages that don't need it. */
  etaMin?: number | null;
}) {
  const phone = useCustomerAuthStore((s) => s.phone);
  const [area, setArea] = useState<string | null>(null);
  const [pincode, setPincode] = useState<string | null>(null);

  useEffect(() => {
    if (!phone) return;
    api.customers.get(phone)
      .then(({ customer }) => {
        const addr = customer.addresses?.[0];
        if (!addr) return;
        setArea(addr.label || addr.city || null);
        setPincode(addr.pincode || null);
      })
      .catch(() => {});
  }, [phone]);

  const hasConfirmedAddress = !!pincode;
  const serviceable = hasConfirmedAddress ? isServiceablePincode(pincode) : true;

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

  // Open + serviceable — the happy path. Now the one place the PDP's ETA
  // renders at all (redesign-plan 3.7 retrofit — see this file's doc
  // comment for why the old inline store-row fragment was removed instead
  // of kept alongside this).
  if (isOffline) return null;
  if (!isClosed) {
    return (
      <ETAHeaderCard
        variant="card"
        size="compact"
        testId="pdp-delivery-line"
        icon={Bike}
        title={`Delivers in ~${etaMin || 45} min`}
      />
    );
  }

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
