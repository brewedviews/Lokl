"use client";

/**
 * ComingSoonHeader — G15. Same sticky-glass shell and exact logo markup as
 * the real ConsumerHeader (frontend/src/components/consumer/ConsumerHeader.tsx),
 * but ConsumerHeader itself isn't reusable here: it assumes real shopping is
 * happening (location auto-detect, live search-suggest, wishlist count,
 * account link). None of that is real pre-launch, so this is a small,
 * separate, visually-matching header rather than a stripped-down prop on
 * the production one — only a logo, a merchant link, and a "Join the
 * waitlist" scroll-to-section CTA.
 */
export function ComingSoonHeader() {
  return (
    <header data-testid="coming-soon-header" className="sticky top-0 z-50 bf-glass border-b border-card-border">
      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-2.5 lg:py-3 flex items-center justify-between gap-3">
        <span className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-brand-primary">
          lokl<span className="text-brand-accent">.</span>
        </span>

        <div className="flex items-center gap-2 sm:gap-4">
          <a
            href="https://merchant.shoplokl.in"
            data-testid="header-merchant-link"
            className="hidden sm:inline text-sm font-semibold text-brand-primary/70 hover:text-brand-primary"
          >
            For Merchants
          </a>
          <a
            href="#waitlist"
            data-testid="header-waitlist-cta"
            className="inline-flex items-center rounded-full bg-brand-accent text-white text-xs sm:text-sm font-bold px-3.5 sm:px-4 py-2 active:scale-95 transition"
          >
            Join the waitlist
          </a>
        </div>
      </div>
    </header>
  );
}
