"use client";

/**
 * ComingSoonHero — light cream background, not the previous solid-navy
 * panel (that was explicitly called out as one of the things to change —
 * navy becomes the ink/text color here, matching Lokl's own cream-
 * dominant palette elsewhere, not a dark backdrop). The rider-delivering-
 * to-a-home illustration (ComingSoonHeroArt) is the dominant visual
 * element, not a small side decoration. The benefit strip below the
 * headline is plain icon+text, not a card grid or a stats row — nothing
 * here is a live number, all four are static product facts.
 */
import { Timer, ScanSearch, PackageCheck, Wallet } from "lucide-react";
import { ComingSoonHeroArt } from "./ComingSoonHeroArt";

const BENEFITS = [
  { icon: Timer, title: "45 minutes", body: "From local stores" },
  { icon: ScanSearch, title: "Browse & order online", body: "See what's available nearby" },
  { icon: PackageCheck, title: "Try & Buy", body: "Try before you decide" },
  { icon: Wallet, title: "Pay at delivery", body: "Cash or UPI" },
];

export function ComingSoonHero() {
  return (
    <section data-testid="coming-soon-hero" className="bg-brand-bg px-4 sm:px-8 pt-10 sm:pt-16">
      <div className="max-w-5xl mx-auto text-center">
        <h1 className="font-display font-bold text-brand-primary leading-[1.05] tracking-tight text-[36px] sm:text-6xl lg:text-[68px]">
          Your Neighbourhood,
          <span className="block text-brand-accent">now online.</span>
        </h1>
        <p className="mt-3 text-brand-primary/55 text-[15px] sm:text-base font-medium">
          Coming soon to Bhilai.
        </p>

        <div className="mt-2 sm:mt-4">
          <ComingSoonHeroArt />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 mt-4 sm:mt-6">
          <a
            href="#get-started"
            data-testid="hero-waitlist-cta"
            className="inline-flex items-center rounded-full bg-brand-accent text-white text-sm font-bold px-7 py-3.5 active:scale-95 transition"
          >
            Join the waitlist
          </a>
          <a
            href="#merchants"
            data-testid="hero-merchant-cta"
            className="inline-flex items-center rounded-full border border-brand-primary/20 text-brand-primary text-sm font-bold px-7 py-3.5 active:scale-95 transition"
          >
            Own a store in Bhilai?
          </a>
        </div>
      </div>

      <div className="max-w-4xl mx-auto mt-10 sm:mt-14 pt-8 border-t border-card-border">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-7 text-center sm:text-left">
          {BENEFITS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex flex-col sm:flex-row items-center sm:items-start gap-2 sm:gap-3">
              <div className="w-9 h-9 rounded-full bg-brand-accent/10 flex items-center justify-center shrink-0">
                <Icon size={16} className="text-brand-accent" />
              </div>
              <div>
                <div className="font-bold text-brand-primary text-[13px] sm:text-sm leading-tight">{title}</div>
                <div className="text-[11px] sm:text-xs text-brand-primary/50 mt-0.5">{body}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-[12px] text-brand-primary/45 mt-6">
          Plus 24-hour returns on eligible items.
        </p>
      </div>

      <a
        href="#what-is-lokl"
        data-testid="hero-scroll-cue"
        className="flex flex-col items-center gap-1.5 pt-8 pb-6 text-brand-primary/35 text-[11px] font-semibold uppercase tracking-wide"
      >
        <svg width="16" height="10" viewBox="0 0 16 10" fill="none" className="animate-bounce">
          <path d="M1 1l7 7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Scroll to explore</span>
      </a>
    </section>
  );
}
