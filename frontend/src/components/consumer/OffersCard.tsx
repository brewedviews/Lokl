"use client";

/**
 * OffersCard — PDP offers block. Self-fetches currently-active, redeemable
 * coupons (GET /api/coupons/active) — real codes, not fabricated ones.
 * Coupons are order-level (no per-product/category targeting exists on the
 * backend today), so "discounted price" here is illustrative — what this
 * product's price would look like with the code applied — not a promise
 * the coupon is guaranteed to apply at checkout (min-order-value gated).
 *
 * Renders nothing if there are no active coupons — no placeholder/fake
 * offer is ever shown.
 */
import { useEffect, useState } from "react";
import { Percent, Copy, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ActiveCoupon } from "@/lib/api";

function formatInr(n: number): string {
  return `₹${Math.round(Math.max(0, n)).toLocaleString("en-IN")}`;
}

function discountedPrice(price: number, c: ActiveCoupon): number {
  return c.discount_type === "percent"
    ? price - (price * c.discount_value) / 100
    : price - c.discount_value;
}

function benefitCopy(c: ActiveCoupon): string {
  const amount = c.discount_type === "percent" ? `${c.discount_value}% off` : `${formatInr(c.discount_value)} off`;
  return c.min_order_value > 0 ? `${amount} on orders above ${formatInr(c.min_order_value)}` : `${amount} on this order`;
}

function OfferRow({ price, coupon }: { price: number; coupon: ActiveCoupon }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(coupon.code);
      setCopied(true);
      toast.success("Code copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy code");
    }
  };

  return (
    <div className="space-y-2" data-testid={`offer-row-${coupon.code}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-bold text-ink-navy">{formatInr(discountedPrice(price, coupon))}</span>
            <span className="text-xs text-slate-gray line-through">{formatInr(price)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          data-testid={`offer-copy-${coupon.code}`}
          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-dashed border-orange-200 bg-white text-ink-navy text-xs font-bold tracking-wide"
        >
          {coupon.code}
          {copied ? <Check size={12} className="text-moss-green" /> : <Copy size={12} />}
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center rounded-full bg-moss-green-tint text-moss-green text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">
          Top steal
        </span>
        <span className="text-[11px] text-slate-gray">{benefitCopy(coupon)}</span>
      </div>
    </div>
  );
}

export function OffersCard({ price }: { price: number }) {
  const [coupons, setCoupons] = useState<ActiveCoupon[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api.catalog.activeCoupons(5).then(setCoupons).catch(() => setCoupons([]));
  }, []);

  if (!coupons || coupons.length === 0) return null;

  const first = coupons[0]!;
  const rest = coupons.slice(1);

  return (
    <div
      data-testid="offers-card"
      className="rounded-xl border border-warm-gray-border bg-cream-warm px-4 py-3.5"
    >
      {/* Row 1 */}
      <div className="flex items-center gap-2">
        <Percent size={16} className="text-moss-green" />
        <span className="text-sm font-bold text-ink-navy">Offers</span>
      </div>

      <div className="h-px bg-warm-gray-border my-3" />

      {/* Row 2 + 3 — first/best offer */}
      <OfferRow price={price} coupon={first} />

      {rest.length > 0 && (
        <>
          <div className="h-px bg-warm-gray-border my-3" />
          {expanded && (
            <div className="space-y-3 mb-3">
              {rest.map((c) => (
                <OfferRow key={c.id} price={price} coupon={c} />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            data-testid="offers-view-more"
            className="w-full flex items-center justify-center gap-1 text-xs font-bold text-ink-navy"
          >
            {expanded ? "View less offers" : `View ${rest.length} more offer${rest.length > 1 ? "s" : ""}`}
            <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </>
      )}
    </div>
  );
}
