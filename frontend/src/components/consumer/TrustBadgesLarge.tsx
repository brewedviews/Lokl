/**
 * TrustBadgesLarge — tier 2 of the PDP's two-tier trust signal split. Two
 * larger, centered, illustrated badges near the specs/description
 * section — more visually prominent than TrustSignalsCompact's quick-scan
 * rows near the delivery info, since these are doing reassurance work at
 * the point of deepest consideration (a shopper reading specs/description
 * is closer to deciding, not skimming).
 *
 * Labels are NOT the literal "Genuine product" / "Quality checked" text
 * originally suggested — checked against real backend policy first, per
 * instruction, and substituted with claims actually backed by data:
 *   - "Quality checked" has no backing at all — no per-product inspection
 *     or QC workflow exists anywhere in this codebase. Using it would be
 *     fabricating a claim, which this app's copy has consistently avoided
 *     elsewhere (see TrustSignalsCompact's own doc comment
 *     on the 24h-not-7-day return window for the same discipline).
 *   - "Genuine product" is replaced by "Verified Seller", backed by a real,
 *     always-true platform rule: every store's kyc_status must be
 *     "approved" before it's published/visible at all (see
 *     _visible_store_filter() in backend/server.py) — every product a
 *     shopper can see already comes from a KYC-checked merchant.
 *   - The second badge reuses "Made in Bhilai" / "your neighbour's shop,
 *     not a faraway warehouse" — the same real, platform-wide claim
 *     already established on the homepage (TrustStickers), for brand
 *     consistency rather than inventing a new one.
 */
import { BadgeCheck, MapPin } from "lucide-react";

const BADGES = [
  {
    icon: BadgeCheck,
    label: "Verified Seller",
    description: "Every Lokl store passes KYC verification before going live",
  },
  {
    icon: MapPin,
    label: "Made in Bhilai",
    description: "Real shops in your neighbourhood, not a faraway warehouse",
  },
] as const;

export function TrustBadgesLarge() {
  return (
    <div data-testid="trust-badges-large" className="grid grid-cols-2 gap-4 px-4 md:px-0 py-6">
      {BADGES.map(({ icon: Icon, label, description }) => (
        <div key={label} className="flex flex-col items-center text-center gap-2">
          <div className="w-14 h-14 rounded-full bg-cream-warm flex items-center justify-center">
            <Icon size={28} className="text-ink-navy" strokeWidth={1.5} />
          </div>
          <p className="text-[13px] font-bold text-ink-navy">{label}</p>
          <p className="text-[11px] text-slate-gray leading-snug">{description}</p>
        </div>
      ))}
    </div>
  );
}
