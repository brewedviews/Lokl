"use client";

/**
 * ComingSoonHero — rebuilt from docs/design/lokl-coming-soon-redesign.html.
 * Solid navy panel, two-column (copy left, illustration right), matching
 * the reference's composition — no live ETA fetch, no delivery-time or
 * delivery-fee numbers (see the plan's claim-verification notes: neither
 * is a platform-wide truth). Primary CTA scrolls to the new #get-started
 * section; secondary CTA is a direct link to merchant.shoplokl.in (not a
 * tab-switch, per this brief). A scroll-down cue closes the section so the
 * hero reads as the start of the page, not the whole page.
 */
import { ComingSoonHeroArt } from "./ComingSoonHeroArt";

export function ComingSoonHero() {
  return (
    <section data-testid="coming-soon-hero" className="bg-brand-primary px-4 sm:px-8 pt-14 sm:pt-20 pb-2">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-12 items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/[0.18] text-white/90 text-[13px] font-semibold px-4 py-1.5 mb-6">
            <span className="w-[7px] h-[7px] rounded-full bg-[#4CAF50] animate-pulse" />
            Coming soon to Bhilai
          </div>

          <h1 className="font-display font-bold text-white leading-[1.06] tracking-tight text-[32px] sm:text-5xl lg:text-[54px]">
            Your neighbourhood,
            <span className="block text-brand-accent">coming online.</span>
          </h1>

          <p className="mt-4 text-white/60 text-base leading-relaxed max-w-md">
            Lokl is bringing the local stores you already know onto one app — so you can see what&apos;s actually in stock nearby, order from your phone, and have it brought to your door by someone from your own neighbourhood.
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-8">
            <a
              href="#get-started"
              data-testid="hero-waitlist-cta"
              className="inline-flex items-center rounded-full bg-brand-accent text-white text-sm font-bold px-6 py-3 active:scale-95 transition"
            >
              Join the waitlist
            </a>
            <a
              href="https://merchant.shoplokl.in"
              data-testid="hero-merchant-cta"
              className="inline-flex items-center rounded-full border border-white/25 text-white text-sm font-bold px-6 py-3 active:scale-95 transition"
            >
              Own a store in Bhilai?
            </a>
          </div>
        </div>

        <div className="pt-2 lg:pt-0">
          <ComingSoonHeroArt />
        </div>
      </div>

      <a
        href="#what-is-lokl"
        data-testid="hero-scroll-cue"
        className="flex flex-col items-center gap-1.5 pt-8 pb-6 text-white/40 text-[11px] font-semibold uppercase tracking-wide"
      >
        <span>Scroll to see what Lokl is building</span>
        <svg width="16" height="10" viewBox="0 0 16 10" fill="none" className="animate-bounce">
          <path d="M1 1l7 7 7-7" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    </section>
  );
}
