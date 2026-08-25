"use client";

/**
 * useServiceability — pincode-based (NOT GPS) serviceability check against
 * the logged-in customer's default (first) saved address, reusing the
 * exact same isServiceablePincode() check checkout uses (lib/
 * serviceability.ts) so this and checkout's own serviceability banner can
 * never disagree.
 *
 * Guests, and customers with no saved address yet, resolve as serviceable
 * — a negative result only ever shows once a real saved pincode has
 * actually failed the check, never a false "unserviceable" default.
 *
 * G11 §12 — extracted out of DeliveryServiceability.tsx (which used to be
 * the sole owner of this check) so ProductDetailPanel.tsx can ALSO read
 * it, to decide whether the store-info row should show inline ETA text
 * ("{store} · {area} · {eta} min delivery") on the happy path. Same
 * check, same one source of truth — not a second, divergent serviceability
 * system.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useCustomerAuthStore } from "@/stores";
import { isServiceablePincode } from "@/lib/serviceability";

export function useServiceability() {
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

  return { area, hasConfirmedAddress, serviceable };
}
