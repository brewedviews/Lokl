/**
 * End-of-page brand close — v2. Replaces the v1 redesign (a large flat
 * navy card with a 3-step icon row) after feedback that it leaned too
 * heavily on a big dark block. This version keeps the same real content
 * (brand tagline, the shop→order→delivery narrative, a CTA into /stores
 * and /try-and-buy) but on a warm cream ground, with the narrative as
 * three loosely "scattered" tilted cards over a sparse abstract dot-map
 * (an abstraction of neighbourhood store pins, not a literal map) instead
 * of a flat navy fill — the composition itself changed, not just the
 * colors.
 *
 * Rendered unconditionally as the last thing in <main> on both the
 * marketplace home (MarketplaceHomeClient) and every L1 category page
 * (L1PageClient). There is no page-level Footer (removed; StickyBottomNav
 * covers that role), so this IS the page's closing moment.
 */
import Link from "next/link";
import { Store, Smartphone, Bike, ArrowRight } from "lucide-react";

const CARDS = [
  { icon: Store, label: "A real shop", sub: "just around the corner", rotate: "-rotate-3" },
  { icon: Smartphone, label: "Now on Lokl", sub: "browse, then order", rotate: "rotate-2" },
  { icon: Bike, label: "At your door", sub: "in 45 minutes", rotate: "-rotate-2" },
] as const;

// Sparse, low-opacity "neighbourhood pin" scatter — an abstraction of store
// locations on a map, not literal cartography. Fixed positions (not
// randomized per-render) so the layout never shifts between server/client
// render or reloads.
const PINS: { top: string; left: string; size: number; tone: "navy" | "orange" }[] = [
  { top: "10%", left: "8%", size: 8, tone: "orange" },
  { top: "18%", left: "22%", size: 5, tone: "navy" },
  { top: "8%", left: "42%", size: 6, tone: "navy" },
  { top: "22%", left: "68%", size: 7, tone: "orange" },
  { top: "12%", left: "88%", size: 5, tone: "navy" },
  { top: "78%", left: "12%", size: 6, tone: "navy" },
  { top: "85%", left: "35%", size: 5, tone: "orange" },
  { top: "80%", left: "60%", size: 7, tone: "navy" },
  { top: "88%", left: "82%", size: 6, tone: "orange" },
  { top: "50%", left: "4%", size: 5, tone: "navy" },
  { top: "48%", left: "95%", size: 5, tone: "orange" },
];

export function TrustStickers() {
  return (
    <section className="max-w-7xl mx-auto px-4 pt-8 pb-8 sm:pb-6" data-testid="trust-stickers">
      <div className="relative overflow-hidden rounded-card-lg bg-surface-tint px-6 py-12 sm:px-14 sm:py-16">
        {/* Abstract neighbourhood-pin scatter — decorative, not literal map data */}
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          {PINS.map((p, i) => (
            <span
              key={i}
              className={`absolute rounded-full ${p.tone === "orange" ? "bg-brand-accent/20" : "bg-brand-primary/12"}`}
              style={{ top: p.top, left: p.left, width: p.size, height: p.size }}
            />
          ))}
        </div>

        <div className="relative text-center max-w-lg mx-auto">
          <p className="text-[11px] uppercase tracking-[0.2em] text-brand-accent font-bold mb-3">Made in Bhilai</p>
          <h2 className="font-display font-medium text-3xl sm:text-4xl tracking-tight leading-tight text-brand-primary">
            Your neighbourhood,<br /><span className="text-brand-accent">online.</span>
          </h2>
          <p className="mt-4 text-sm sm:text-base text-text-secondary max-w-sm mx-auto">
            Every store on Lokl is one you could walk into today — we just made it easier to find, browse and order from.
          </p>
        </div>

        <div className="relative mt-10 flex items-start justify-center gap-3 sm:gap-6 flex-wrap max-w-2xl mx-auto">
          {CARDS.map(({ icon: Icon, label, sub, rotate }) => (
            <div
              key={label}
              className={`${rotate} bg-card-surface rounded-card shadow-2 border border-card-border px-5 py-4 w-[136px] sm:w-[160px] text-center shrink-0`}
            >
              <span className="mx-auto w-10 h-10 rounded-full bg-brand-accent/10 flex items-center justify-center">
                <Icon size={18} className="text-brand-accent" />
              </span>
              <p className="mt-2.5 text-xs sm:text-sm font-bold text-brand-primary leading-tight">{label}</p>
              <p className="text-[10px] sm:text-xs text-text-muted mt-0.5">{sub}</p>
            </div>
          ))}
        </div>

        <div className="relative mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/stores"
            data-testid="trust-stickers-cta"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-brand-accent text-white text-sm font-semibold hover:bg-brand-accent/90 transition"
          >
            See stores near you <ArrowRight size={14} />
          </Link>
          <Link
            href="/try-and-buy"
            data-testid="trust-stickers-try-buy"
            className="text-xs sm:text-sm text-text-muted hover:text-brand-primary underline underline-offset-4 transition"
          >
            or try it on at your door, keep what you love
          </Link>
        </div>
      </div>
    </section>
  );
}
