/**
 * TrustIconsRow — 4-up PDP trust strip. Copy is checked against the real
 * policy, not generic template text: the return window is 24 HOURS
 * (RETURN_WINDOW_HOURS in backend/server.py — return_eligible items only),
 * not the more common "7 days" claim, so this reads "24-hour returns", not
 * "7 Days Return". Try & Buy is the real try_at_doorstep capability, not
 * a per-product promise (gating this row on the flag would make the row
 * itself flicker between 3 and 4 icons per product, which reads as a bug
 * more than a feature — the row is a platform-wide trust statement).
 */
import { ShieldCheck, BadgeCheck, RotateCcw, Undo2 } from "lucide-react";

const ITEMS = [
  { icon: ShieldCheck, label: ["Secure", "Payments"] },
  { icon: BadgeCheck, label: ["Genuine", "Product"] },
  { icon: RotateCcw, label: ["Try &", "Buy"] },
  { icon: Undo2, label: ["24-Hour", "Returns"] },
] as const;

export function TrustIconsRow() {
  return (
    <div data-testid="trust-icons-row" className="grid grid-cols-4 gap-2">
      {ITEMS.map(({ icon: Icon, label }) => (
        <div key={label.join(" ")} className="flex flex-col items-center gap-1.5 text-center">
          <div className="w-12 h-12 rounded-xl bg-cream-warm flex items-center justify-center">
            <Icon size={22} className="text-ink-navy" strokeWidth={1.75} />
          </div>
          <p className="text-[12px] leading-tight text-ink-navy">
            {label[0]}<br />{label[1]}
          </p>
        </div>
      ))}
    </div>
  );
}
