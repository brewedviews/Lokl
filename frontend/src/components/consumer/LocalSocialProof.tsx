"use client";

/**
 * Hyperlocal social proof — "N people in {area} bought this recently."
 * Self-fetches the shopper's own saved pincode (same pattern
 * DeliveryServiceability uses) and queries GET /api/products/{id}/local-proof,
 * which counts real orders for this product delivered to that pincode in
 * the last 14 days (LOCAL_PROOF_WINDOW_DAYS in backend/server.py).
 *
 * Gated at count >= 5 — below that, this renders nothing. "1 person bought
 * this" reads as a product nobody wants, not proof of demand; a low count
 * shown as if it were meaningful undermines trust rather than building it.
 *
 * Also renders nothing for guests / customers with no saved address (no
 * pincode to query against) and for products outside the known Bhilai
 * pincode table (no area name to attribute the count to).
 *
 * Window is 14 days, not "this week" — the copy says "in the last 2 weeks"
 * rather than "this week" so it doesn't overstate recency the data doesn't
 * back.
 */
import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { api } from "@/lib/api";
import { useCustomerAuthStore } from "@/stores";
import { findBhilaiAreaByPincode } from "@/data/bhilai-areas";

const THRESHOLD = 5;

export function LocalSocialProof({ productId }: { productId: string }) {
  const phone = useCustomerAuthStore((s) => s.phone);
  const [count, setCount] = useState<number | null>(null);
  const [areaName, setAreaName] = useState<string | null>(null);

  useEffect(() => {
    if (!phone) return;
    let cancelled = false;
    api.customers.get(phone)
      .then(({ customer }) => {
        const pincode = customer.addresses?.[0]?.pincode;
        if (!pincode) return;
        const area = findBhilaiAreaByPincode(pincode);
        if (!area) return; // unknown pincode — no area name to attribute the count to
        return api.products.localProof(productId, pincode).then((r) => {
          if (cancelled) return;
          setCount(r.count);
          setAreaName(area.label);
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [phone, productId]);

  if (!count || count < THRESHOLD || !areaName) return null;

  return (
    <div
      data-testid="local-social-proof"
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-moss-green-tint"
    >
      <Users size={14} className="text-moss-green shrink-0" />
      <span className="text-xs text-moss-green">
        <span className="font-bold">{count} people</span> in {areaName} bought this in the last 2 weeks
      </span>
    </div>
  );
}
