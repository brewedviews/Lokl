"use client";

/**
 * ComingSoonHeader — G17, rebuilt from docs/design/coming-soon-v2.html's
 * nav: logo + a "Bhilai — Coming soon" pill badge, no search/location/
 * account/wishlist/marketplace nav. The reference's own nav has no
 * merchant link at all; keeping one small "For Merchants" text link here
 * so merchants who want to self-serve land on the real onboarding flow
 * (https://merchant.shoplokl.in) rather than only reaching the embedded
 * waitlist form's merchant tab.
 */
export function ComingSoonHeader() {
  return (
    <header data-testid="coming-soon-header" className="sticky top-0 z-50 bf-glass border-b border-card-border">
      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-2.5 lg:py-3 flex items-center justify-between gap-3">
        <span className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-brand-primary">
          lokl<span className="text-brand-accent">.</span>
        </span>

        <div className="flex items-center gap-3 sm:gap-4">
          <a
            href="https://merchant.shoplokl.in"
            data-testid="header-merchant-link"
            className="hidden sm:inline text-sm font-semibold text-brand-primary/70 hover:text-brand-primary"
          >
            For Merchants
          </a>
          <span className="inline-flex items-center rounded-full bg-brand-primary text-white text-xs sm:text-sm font-bold px-3.5 sm:px-4 py-2">
            Bhilai — Coming soon
          </span>
        </div>
      </div>
    </header>
  );
}
