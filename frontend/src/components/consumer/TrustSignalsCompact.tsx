/**
 * TrustSignalsCompact — tier 1 of the PDP's two-tier trust signal split.
 * Replaces the old single-row 3-icon strip (Secure payments / Try & buy /
 * 24h returns, all inline) with a stacked list: small icon (left) + bold
 * headline + one-line description below it, near the delivery info this
 * quick-scan logistics content already lives next to.
 *
 * Tier 2 — larger illustrated badges ("Verified Seller" / "Made in
 * Bhilai") — lives separately, near the specs/description section (see
 * page.tsx's TrustBadgesLarge), doing reassurance work at the point of
 * deepest consideration rather than quick-scan logistics.
 *
 * Copy is checked against the real policy, same discipline as the old
 * strip: the return window is 24 HOURS (RETURN_WINDOW_HOURS in
 * backend/server.py — return_eligible items only), never a fabricated
 * "7 days". Try & Buy was dropped from this pair — it's already its own
 * dedicated callout above (try_at_doorstep, per-product) when the product
 * actually has it, so restating it here as a platform-wide claim would be
 * true for some products and misleading for others.
 */
import { ShieldCheck, PackageCheck } from "lucide-react";

const ITEMS = [
  {
    icon: ShieldCheck,
    headline: "Secure payments",
    description: "UPI, cards, and cash on delivery accepted",
  },
  {
    icon: PackageCheck,
    headline: "24-hour returns",
    description: "Free exchange if it doesn't fit — return within 24h of delivery",
  },
] as const;

export function TrustSignalsCompact() {
  return (
    <div data-testid="trust-signals-compact" className="space-y-3">
      {ITEMS.map(({ icon: Icon, headline, description }) => (
        <div key={headline} className="flex items-start gap-3">
          <Icon size={18} className="text-ink-navy shrink-0 mt-0.5" strokeWidth={1.75} />
          <div className="min-w-0">
            <p className="text-[12px] font-bold text-ink-navy leading-tight">{headline}</p>
            <p className="text-[11px] text-slate-gray leading-snug mt-0.5">{description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
