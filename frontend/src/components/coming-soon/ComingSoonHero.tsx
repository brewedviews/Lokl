"use client";

/**
 * ComingSoonHero — light cream background; navy is ink/text color here,
 * not a dark backdrop. The rider-delivering-home illustration
 * (ComingSoonHeroArt) is the dominant visual element. The benefit strip
 * is five items sharing the same doodle-icon family as "Why Lokl"
 * (ComingSoonIcons) — one coherent visual strip, not five SaaS cards: on
 * mobile it's a centered 2-up wrap (the 5th item centers itself on its
 * own row), on larger screens a single evenly-spaced row. Nothing here is
 * a live number — all five are static product facts, and "24-hour
 * returns" is now a full strip item (not a separate footnote line) so it
 * carries the same visual weight as the other four.
 */
import { IconTimer, IconSearch, IconTryBuy, IconWallet, IconReturn } from "./ComingSoonIcons";
import { ComingSoonHeroArt } from "./ComingSoonHeroArt";

const BENEFITS = [
  { Icon: IconTimer, title: "45 minutes", body: "From local stores" },
  { Icon: IconSearch, title: "Browse & order online", body: "See what's available nearby" },
  { Icon: IconTryBuy, title: "Try & Buy", body: "Try before you decide" },
  { Icon: IconWallet, title: "Pay at delivery", body: "Cash or UPI" },
  { Icon: IconReturn, title: "24-hour returns", body: "On eligible items" },
];

export function ComingSoonHero() {
  return (
    <section data-testid="coming-soon-hero" className="bg-brand-bg px-5 sm:px-8 pt-10 sm:pt-16">
      <div className="max-w-5xl mx-auto text-center">
        <h1 className="font-display font-bold text-brand-primary leading-[1.05] tracking-tight text-[34px] sm:text-6xl lg:text-[68px]">
          Your neighbourhood,
          <span className="block text-brand-accent">now online.</span>
        </h1>
        <p className="mt-3 text-brand-primary/55 text-[15px] sm:text-base font-medium">
          Coming soon to Bhilai.
        </p>

        <div className="mt-4 sm:mt-6">
          <ComingSoonHeroArt />
        </div>

        <div className="flex flex-col items-center gap-3 mt-2 sm:mt-4 sm:flex-row sm:justify-center">
          <a
            href="#get-started"
            data-testid="hero-waitlist-cta"
            className="inline-flex items-center justify-center w-full sm:w-auto rounded-full bg-brand-accent text-white text-[15px] font-bold px-8 py-4 active:scale-95 transition"
          >
            Join the waitlist
          </a>
          <a
            href="#merchants"
            data-testid="hero-merchant-cta"
            className="inline-flex items-center justify-center w-full sm:w-auto rounded-full border border-brand-primary/15 text-brand-primary/70 text-[13.5px] font-semibold px-6 py-2.5 active:scale-95 transition"
          >
            Own a store in Bhilai?
          </a>
        </div>
      </div>

      <div className="max-w-3xl mx-auto mt-10 sm:mt-14 pt-9 border-t border-dashed border-card-border">
        <div className="flex flex-wrap justify-center gap-x-7 gap-y-7 sm:gap-x-8">
          {BENEFITS.map(({ Icon, title, body }) => (
            <div key={title} className="flex flex-col items-center text-center basis-[38%] sm:basis-auto">
              <Icon />
              <div className="font-bold text-brand-primary text-[12.5px] sm:text-sm leading-tight mt-2.5">{title}</div>
              <div className="text-[10.5px] sm:text-xs text-brand-primary/45 mt-0.5 leading-snug">{body}</div>
            </div>
          ))}
        </div>
      </div>

      <a
        href="#what-is-lokl"
        data-testid="hero-scroll-cue"
        className="flex flex-col items-center gap-1.5 pt-9 pb-7 text-brand-primary/35 text-[11px] font-semibold uppercase tracking-wide"
      >
        <svg width="16" height="10" viewBox="0 0 16 10" fill="none" className="animate-bounce">
          <path d="M1 1l7 7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Scroll to explore</span>
      </a>
    </section>
  );
}
