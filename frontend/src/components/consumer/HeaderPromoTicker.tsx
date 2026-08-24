"use client";

/**
 * HeaderPromoTicker (redesign Phase G5) — small auto-cycling text+icon
 * callout for the space the header's cart button used to occupy. Fixed,
 * hardcoded message set — reuses two of the exact three value props
 * TrustStickers.tsx already puts at the end of the homepage ("Try & Buy",
 * "Made in Bhilai"), rather than inventing new marketing copy or a second
 * source of truth for it. The third ("45 mins delivery") is deliberately
 * NOT repeated here — this same header row already carries a PERSISTENT
 * ETAHeaderCard(micro) showing live delivery time, so rotating that exact
 * claim through this ticker too would be redundant next to it, not a
 * second useful message. No backend/CMS: the task calls for a small fixed
 * set here, same reasoning PRICE_BANDS_SEED's three fixed bands or
 * L1_CATEGORIES' fixed list don't get a CMS either when the set is this
 * small and this stable.
 *
 * Auto-cycles every 4s — long enough to read a 2-3 word phrase
 * comfortably, short enough that all three are seen within one typical
 * page dwell. Fixed-height wrapper (no layout jump between messages of
 * different lengths); the fade/rise transition is skipped under
 * prefers-reduced-motion (see header-promo-fade-in in globals.css) —
 * messages still rotate, they just swap instantly instead of animating.
 */
import { useEffect, useState } from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const CYCLE_MS = 4000;

const MESSAGES = [
  { icon: RotateCcw, text: "Try & Buy" },
  { icon: Sparkles, text: "Made in Bhilai" },
] as const;

export function HeaderPromoTicker({ className }: { className?: string }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIdx((i) => (i + 1) % MESSAGES.length), CYCLE_MS);
    return () => clearInterval(timer);
  }, []);

  const current = MESSAGES[idx] ?? MESSAGES[0];
  const Icon = current.icon;

  return (
    <div
      data-testid="header-promo-ticker"
      className={cn("h-5 overflow-hidden flex items-center min-w-0", className)}
    >
      <div key={idx} className="header-promo-fade-in flex items-center gap-1.5 min-w-0 text-[#0A1F5C]">
        <Icon size={13} className="text-[#E68910] shrink-0" aria-hidden="true" />
        <span className="text-[11px] font-semibold truncate">{current.text}</span>
      </div>
    </div>
  );
}
