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
 * THE single delivery/opening-time element for the whole PDP — there used
 * to be four separate places restating this (a near-price "Available from
 * X" pill, this box, a "Closed" orange pill, and a specs-grid row). All the
 * others were removed; this box now owns both the open-store message
 * ("delivers to X in ~N min") and the closed-store message ("opens at X ·
 * delivers after it opens"), toggled by `isClosed` — never both at once,
 * never orange (that read as an alert; this is routine status).
 *
 * Styled as a compact ambient status line (hairline border, white bg, small
 * bare icon, single line) rather than a filled pill — it's secondary
 * context near the CTA, not something that should compete visually with it.
 */
import { useEffect, useState } from "react";
import { Bike, MapPin } from "lucide-react";
import { api } from "@/lib/api";
import { useCustomerAuthStore } from "@/stores";
import { isServiceablePincode } from "@/lib/serviceability";

export function DeliveryServiceability({
  etaMin,
  isClosed = false,
  opensAtLabel,
}: {
  etaMin: number;
  isClosed?: boolean;
  opensAtLabel?: string | null;
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

  const areaLabel = hasConfirmedAddress && area ? area : "Bhilai";

  // `opensAtLabel` arrives from the backend already as a full phrase
  // ("Opens at 9:30 AM" / "Opens tomorrow at 9:30 AM") — prefixing another
  // "opens at" in front of it was the duplicated-string bug ("opens at
  // Opens at 9:30 AM"). Strip the leading "Opens" so this component owns
  // the single lowercase "opens" that opens the sentence, whichever form
  // the backend sent.
  const opensAtTime = opensAtLabel ? opensAtLabel.replace(/^Opens\s+/, "").trim() : null;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-warm-gray-border"
      data-testid="pdp-delivery-line"
    >
      <Bike size={14} className="text-slate-gray shrink-0" />
      {isClosed ? (
        <span className="text-xs text-slate-gray">
          opens {opensAtTime || "soon"} · delivers after it opens
        </span>
      ) : (
        <span className="text-xs text-slate-gray">
          delivers to <span className="font-semibold text-ink-navy">{areaLabel}</span> in ~{etaMin} min
        </span>
      )}
    </div>
  );
}
