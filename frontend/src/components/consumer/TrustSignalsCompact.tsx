/**
 * TrustSignalsCompact — the PDP's full trust-signal list, one consistent
 * style for all four items: small left-aligned icon + bold headline + one-
 * line gray description, stacked. Used to be split across two visually
 * different tiers (this compact list for Secure payments/24h returns, plus
 * a separate large-centered-circle-icon TrustBadgesLarge component near
 * specs/description for Verified Seller/Made in Bhilai) — user testing
 * called that inconsistent, reading as two different treatments rather
 * than one trust block. TrustBadgesLarge is deleted; all four items render
 * here now, together, near the delivery/store info area.
 *
 * Copy is checked against the real policy, same discipline throughout this
 * file's history:
 *   - the return window is 24 HOURS (RETURN_WINDOW_HOURS in
 *     backend/server.py — return_eligible items only), never a fabricated
 *     "7 days".
 *   - "Quality checked" was never used — no per-product inspection or QC
 *     workflow exists anywhere in this codebase, and fabricating it would
 *     break this app's established never-fabricate copy discipline.
 *   - "Verified Seller" is backed by a real, always-true platform rule:
 *     every store's kyc_status must be "approved" before it's
 *     published/visible at all (see _visible_store_filter() in
 *     backend/server.py) — every product a shopper can see already comes
 *     from a KYC-checked merchant.
 *   - "Made in Bhilai" is a real, platform-wide claim (every store here
 *     genuinely is Bhilai-based) — kept consistent with how the rest of
 *     the app talks about locality, rather than inventing a new claim.
 *   - Try & Buy is intentionally NOT in this list — it's already its own
 *     dedicated callout above (try_at_doorstep, per-product) when the
 *     product actually has it, so restating it here as a platform-wide
 *     claim would be true for some products and misleading for others.
 */
import { ShieldCheck, PackageCheck, BadgeCheck, MapPin } from "lucide-react";

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
  {
    icon: BadgeCheck,
    headline: "Verified Seller",
    description: "Every Lokl store passes KYC verification before going live",
  },
  {
    icon: MapPin,
    headline: "Made in Bhilai",
    description: "Real shops in your neighbourhood, not a faraway warehouse",
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
