"use client";

/**
 * ComingSoonHero — G17, rebuilt from docs/design/coming-soon-v2.html.
 *
 * Deliberate deviation from G15/16: this is a solid navy two-column panel
 * (copy left, waitlist form right), not an editorial-photo hero — matching
 * the reference exactly rather than reusing HeroCarousel's photo-hero
 * architecture. No live ETA fetch either way; the "Launching in Bhilai"
 * badge and the ₹0/30 min/0% stats row are static copy, not live data.
 */
import { ComingSoonWaitlistForm } from "./ComingSoonWaitlistForm";

type Tab = "customer" | "merchant";

export function ComingSoonHero({ activeTab, onTabChange }: { activeTab: Tab; onTabChange: (t: Tab) => void }) {
  return (
    <section data-testid="coming-soon-hero" className="bg-brand-primary px-4 sm:px-8 py-14 sm:py-20">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/[0.18] text-white/90 text-[13px] font-semibold px-4 py-1.5 mb-6">
            <span className="w-[7px] h-[7px] rounded-full bg-[#4CAF50] animate-pulse" />
            Launching in Bhilai
          </div>

          <h1 className="font-display font-bold text-white leading-[1.07] tracking-tight text-[34px] sm:text-5xl lg:text-[58px]">
            Your favourite stores.{" "}
            <span className="text-brand-accent">Delivered in 30 min.</span>
          </h1>

          <p className="mt-4 text-white/60 text-base leading-relaxed max-w-md">
            Browse kurtas, jeans, sneakers and more from real stores near you in Bhilai. Order online, pay at the door.
          </p>

          <div className="flex gap-9 mt-11 pt-9 border-t border-white/10">
            <div>
              <strong className="block font-display font-black text-[26px] text-brand-accent tracking-tight">&#8377;0</strong>
              <span className="text-[11px] text-white/45 font-semibold uppercase tracking-wide mt-0.5 block">Delivery fee</span>
            </div>
            <div>
              <strong className="block font-display font-black text-[26px] text-brand-accent tracking-tight">30 min</strong>
              <span className="text-[11px] text-white/45 font-semibold uppercase tracking-wide mt-0.5 block">Avg delivery</span>
            </div>
            <div>
              <strong className="block font-display font-black text-[26px] text-brand-accent tracking-tight">0%</strong>
              <span className="text-[11px] text-white/45 font-semibold uppercase tracking-wide mt-0.5 block">Commission</span>
            </div>
          </div>
        </div>

        <ComingSoonWaitlistForm activeTab={activeTab} onTabChange={onTabChange} />
      </div>
    </section>
  );
}
