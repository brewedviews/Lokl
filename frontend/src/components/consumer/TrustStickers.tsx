/**
 * End-of-page brand close — replaces the old "sticker badge" trio (Made in
 * Bhilai / 45 mins delivery / Try & Buy as three decorative tilted chips)
 * with an editorial closing statement: the brand tagline, a connected
 * 3-step visual narrative (neighbourhood store → browse on Lokl → at your
 * door), and a real CTA into the thing being described — rather than
 * badges that said things without pointing anywhere.
 *
 * Rendered unconditionally as the last thing in <main> on both the
 * marketplace home (MarketplaceHomeClient) and every L1 category page
 * (L1PageClient) — see those files. There is no page-level Footer (removed;
 * StickyBottomNav covers that role), so this IS the page's closing moment.
 */
import Link from "next/link";
import { Store, Smartphone, Bike, ArrowRight } from "lucide-react";

const STEPS = [
  { icon: Store, label: "A real shop", sub: "just around the corner" },
  { icon: Smartphone, label: "Now on Lokl", sub: "browse, then order" },
  { icon: Bike, label: "At your door", sub: "in 45 minutes" },
] as const;

export function TrustStickers() {
  return (
    <section className="max-w-7xl mx-auto px-4 pt-8 pb-8 sm:pb-6" data-testid="trust-stickers">
      <div className="relative overflow-hidden rounded-card-lg bg-brand-primary text-white px-6 py-10 sm:px-14 sm:py-14">
        <div aria-hidden className="absolute -right-12 -top-12 w-48 h-48 rounded-full bg-brand-accent/10 pointer-events-none" />
        <div aria-hidden className="absolute -left-16 -bottom-16 w-56 h-56 rounded-full bg-white/[0.04] pointer-events-none" />

        <div className="relative text-center max-w-lg mx-auto">
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/50 font-semibold mb-3">Made in Bhilai</p>
          <h2 className="font-display font-medium text-3xl sm:text-4xl tracking-tight leading-tight">
            Your neighbourhood,<br /><span className="text-brand-accent">online.</span>
          </h2>
          <p className="mt-4 text-sm sm:text-base text-white/70 max-w-sm mx-auto">
            Every store on Lokl is one you could walk into today — we just made it easier to find, browse and order from.
          </p>
        </div>

        <div className="relative mt-10 max-w-2xl mx-auto">
          <div aria-hidden className="absolute top-6 left-[16%] right-[16%] h-px bg-white/15" />
          <div className="relative grid grid-cols-3 gap-2 sm:gap-6">
            {STEPS.map(({ icon: Icon, label, sub }) => (
              <div key={label} className="flex flex-col items-center text-center">
                <span className="w-12 h-12 rounded-full bg-brand-primary border border-white/20 flex items-center justify-center">
                  <Icon size={18} className="text-brand-accent" />
                </span>
                <span className="mt-3 text-xs sm:text-sm font-semibold text-white">{label}</span>
                <span className="text-[10px] sm:text-xs text-white/50 mt-0.5">{sub}</span>
              </div>
            ))}
          </div>
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
            className="text-xs sm:text-sm text-white/60 hover:text-white/90 underline underline-offset-4 transition"
          >
            or try it on at your door, keep what you love
          </Link>
        </div>
      </div>
    </section>
  );
}
