/**
 * ETAHeaderCard — the one shared ETA/delivery-status component
 * (redesign-plan 3.7), now used on Home (HeroV2's overlay), PDP
 * (DeliveryServiceability's happy path), and the Bag/Checkout screen.
 *
 * Two variants:
 *   - "card" (default) — opaque bordered white block, sits in normal
 *     document flow before any product content. Checkout/PDP's context.
 *   - "pill" — translucent white + backdrop-blur, no border, meant to sit
 *     as a floating overlay on top of a photo. Home's hero context; the
 *     caller controls absolute positioning via `className`, this component
 *     only owns its own internal look.
 *
 * Three sizes ("compact"/"default"/"roomy") — Home's hero alone needs two
 * of these simultaneously (a compact pill below `xl`, a roomier floating
 * card at `xl` and up), so sizing is a prop rather than baked in, matching
 * the "handle via a size/variant prop, not a separate component" rule.
 *
 * `statusBadge` is optional and only Home's hero currently uses it — PDP
 * and Checkout pass nothing and get none. Color decision made as part of
 * this retrofit, not preserved blindly (redesign-plan 2.4/item 6): the old
 * HeroV2 markup used the deprecated brand-accent-alt (#F59E0B) for the
 * icon-swatch background in the LIVE state AND, confusingly, for the
 * pulsing status dot too — while the AWAY dot used brand-accent (#E68910),
 * meaning LIVE and AWAY rendered as the same color family with only a
 * pulse animation telling them apart. Fixed here: the icon swatch is now
 * always the same neutral navy tint regardless of status (icon color isn't
 * a functional signal, so it shouldn't compete for the one functional
 * orange — color rule 2.1-2.3), and the status dot uses moss-green for
 * LIVE (a real positive-status signal, same family as the savings-line
 * green) vs orange for AWAY (a real caution signal) — two states that now
 * actually look different from each other.
 *
 * G11 §10 — the badge pill itself used to be `bg-[#0A1F5C]` (navy) with
 * white text, which put the dark-green LIVE dot on a dark navy background
 * — two dark colors, genuinely low contrast, confirmed by reading the
 * actual values rather than assumed. Flipped to a light pill (white +
 * a hairline navy border, navy text) so the dot reads clearly against it
 * regardless of tone — the DOT_TONE colors themselves are unchanged, only
 * the pill's own background/text flipped from dark to light.
 *
 * Phase G5: `size="micro"` — a single-line, no-circle, no-subtitle variant
 * for the persistent global header (ConsumerHeader), which is rendered on
 * every route and has far less vertical room than the hero or PDP/Checkout
 * contexts the other three sizes were built for. Handled as an early,
 * fully separate return so it can't regress the existing card/pill
 * rendering the three other sizes (and their three existing call sites)
 * already rely on.
 */
import type { ComponentType } from "react";
import { Bike } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatusBadge {
  label: string;
  /** "live" -> moss-green dot, "away" -> orange dot, "muted" -> gray, no pulse. */
  tone: "live" | "away" | "muted";
}

interface ETAHeaderCardProps {
  icon?: ComponentType<{ size?: number; className?: string }>;
  title: string;
  subtitle?: string;
  loading?: boolean;
  variant?: "card" | "pill";
  size?: "compact" | "default" | "roomy" | "micro";
  /** Dims the title/icon when the underlying status is a scheduled/closed
   *  state rather than "loading" — PDP/Checkout never set this. */
  muted?: boolean;
  statusBadge?: StatusBadge | null;
  className?: string;
  testId?: string;
}

const SIZE = {
  compact: { circle: "w-8 h-8", icon: 14, title: "text-sm", subtitle: "text-[10px]", pad: "px-3 py-2", gap: "gap-2.5" },
  default: { circle: "w-9 h-9", icon: 18, title: "text-sm", subtitle: "text-xs", pad: "px-4 py-3", gap: "gap-3" },
  roomy: { circle: "w-11 h-11", icon: 18, title: "text-lg", subtitle: "text-[11px]", pad: "p-3.5", gap: "gap-3" },
} as const;

const DOT_TONE: Record<StatusBadge["tone"], string> = {
  live: "bg-[#1E5631] animate-pulse",
  away: "bg-[#E68910] animate-pulse",
  muted: "bg-[#94A3B8]",
};

export function ETAHeaderCard({
  icon: Icon = Bike,
  title,
  subtitle,
  loading = false,
  variant = "card",
  size = "default",
  muted = false,
  statusBadge,
  className = "",
  testId = "eta-header",
}: ETAHeaderCardProps) {
  if (size === "micro") {
    return (
      <div data-testid={testId} className={cn("inline-flex items-center gap-1.5 min-w-0", className)}>
        <Icon size={13} className={cn("shrink-0", muted ? "text-[#94A3B8]" : "text-[#0A1F5C]")} />
        {loading ? (
          <span className="h-3 w-16 rounded bg-[#E5E2DC] animate-pulse" />
        ) : (
          <span className={cn(
            "text-[11px] font-bold leading-none truncate",
            muted ? "text-[#64748B]" : "text-[#0A1F5C]",
          )}>
            {title}
          </span>
        )}
        {statusBadge && !loading && (
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", DOT_TONE[statusBadge.tone])} aria-hidden="true" />
        )}
      </div>
    );
  }

  const s = SIZE[size];
  const shell = variant === "pill"
    ? "bg-white/95 backdrop-blur-sm shadow-md rounded-2xl"
    : "bg-white border border-[#E5E2DC] rounded-2xl";

  return (
    <div data-testid={testId} className={cn("inline-flex items-center", s.gap, s.pad, shell, className)}>
      <div className={`${s.circle} rounded-full bg-[#0A1F5C]/8 grid place-items-center shrink-0`}>
        <Icon size={s.icon} className="text-[#0A1F5C]" />
      </div>
      <div className={statusBadge ? "min-w-0 flex-1" : "min-w-0"}>
        {loading ? (
          <div className="h-4 w-32 bg-[#E5E2DC] rounded animate-pulse" />
        ) : (
          <p className={`font-display leading-tight ${s.title} ${muted ? "font-semibold text-[#64748B]" : "font-bold text-[#0A1F5C]"}`}>
            {title}
          </p>
        )}
        {!loading && subtitle && (
          <p className={`text-[#64748B]/80 truncate mt-0.5 ${s.subtitle}`}>{subtitle}</p>
        )}
      </div>
      {statusBadge && !loading && (
        <span className="px-2 py-0.5 rounded-full bg-white border border-[#0A1F5C]/15 text-[#0A1F5C] text-[9px] font-bold flex items-center gap-1 shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${DOT_TONE[statusBadge.tone]}`} />
          {statusBadge.label}
        </span>
      )}
    </div>
  );
}
