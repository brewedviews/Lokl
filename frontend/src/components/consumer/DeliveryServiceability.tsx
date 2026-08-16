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
 * Handles the unserviceable-pincode alert and the closed-store "Opens X"
 * message. The open-store happy-path ETA ("~45 min") used to render here
 * too, but moved into the store info row at the top of the page instead
 * (ProductDetailPanel's store-name line — "{store} · {area} · ~45 min")
 * so it reads as a continuation of the store's own identity rather than a
 * separate box; this component now renders NOTHING in the normal
 * open+serviceable case; only for the two states that actually need their
 * own callout.
 *
 * The closed-state duplicated-string bug fix ("opens at Opens at 9:30 AM")
 * is unchanged — see the comment on opensAtTime below.
 *
 * Styled as a compact ambient status line (hairline border, white bg, small
 * bare icon, single line) rather than a filled pill — it's secondary
 * context, not something that should compete visually with the CTA.
 */
import { useEffect, useState } from "react";
import { Bike, MapPin } from "lucide-react";
import { api } from "@/lib/api";
import { useCustomerAuthStore } from "@/stores";
import { isServiceablePincode } from "@/lib/serviceability";

export function DeliveryServiceability({
  isClosed = false,
  opensAtLabel,
}: {
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

  // Open + serviceable — the happy path. Nothing to show here anymore; the
  // ETA lives in the store info row instead (see this file's own doc
  // comment).
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
