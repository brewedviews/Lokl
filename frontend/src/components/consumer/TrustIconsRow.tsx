/**
 * TrustIconsRow — compact PDP trust strip. Copy is checked against the real
 * policy, not generic template text: the return window is 24 HOURS
 * (RETURN_WINDOW_HOURS in backend/server.py — return_eligible items only),
 * not the more common "7 days" claim — this reads "24h returns", never
 * "7-day return". Try & Buy is the real try_at_doorstep capability, not a
 * per-product promise (gating this row on the flag would make the row
 * itself flicker between 2 and 3 items per product, which reads as a bug
 * more than a feature — the row is a platform-wide trust statement).
 *
 * "Genuine product" was dropped — it didn't say anything "Secure payments"
 * wasn't already implying, and 4 icon tiles at this weight (each with its
 * own background chip) took up roughly 4x the vertical space a single
 * hairline-bordered inline row needs to say the same thing.
 */
import { ShieldCheck, Shirt, PackageCheck } from "lucide-react";

const ITEMS = [
  { icon: ShieldCheck, label: "Secure payments" },
  { icon: Shirt, label: "Try & buy" },
  { icon: PackageCheck, label: "24h returns" },
] as const;

export function TrustIconsRow() {
  return (
    <div
      data-testid="trust-icons-row"
      className="flex flex-wrap items-center gap-x-5 gap-y-1.5 py-2.5 border-y border-warm-gray-border"
    >
      {ITEMS.map(({ icon: Icon, label }) => (
        <div key={label} className="flex items-center gap-1.5">
          <Icon size={15} className="text-ink-navy shrink-0" strokeWidth={1.75} />
          <span className="text-[12px] text-ink-navy">{label}</span>
        </div>
      ))}
    </div>
  );
}
