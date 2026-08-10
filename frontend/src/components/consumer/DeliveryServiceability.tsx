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
 */
import { useEffect, useState } from "react";
import { Bike, MapPin } from "lucide-react";
import { api } from "@/lib/api";
import { useCustomerAuthStore } from "@/stores";
import { isServiceablePincode } from "@/lib/serviceability";

export function DeliveryServiceability({ etaMin }: { etaMin: number }) {
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

  return (
    <div
      className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#F4F1E9]"
      data-testid="pdp-delivery-line"
    >
      <div className="w-8 h-8 rounded-full bg-[#0A1F5C]/8 flex items-center justify-center shrink-0">
        <Bike size={15} className="text-[#0A1F5C]" />
      </div>
      <span className="text-xs text-[#0A1F5C]">
        delivers to <span className="font-bold">{areaLabel}</span> in ~{etaMin} min
      </span>
    </div>
  );
}
