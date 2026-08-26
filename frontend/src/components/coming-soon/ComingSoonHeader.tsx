"use client";

/**
 * ComingSoonHeader — rebuilt from docs/design/lokl-coming-soon-redesign.html's
 * nav, with the location treatment made more prominent per the brief: a
 * static pin + "Bhilai" / "Chhattisgarh" block next to the logo. This is
 * plain text, not a location picker — there's nothing to select on a
 * pre-launch page, unlike the production ConsumerHeader's LocationChip
 * (auto-detect + saved-address popover), which isn't reusable here for
 * that reason.
 */
export function ComingSoonHeader() {
  return (
    <header data-testid="coming-soon-header" className="sticky top-0 z-50 bf-glass border-b border-card-border">
      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-2.5 lg:py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
          <span className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-brand-primary shrink-0">
            lokl<span className="text-brand-accent">.</span>
          </span>
          <div className="flex items-center gap-1.5 pl-2.5 sm:pl-3.5 border-l border-card-border min-w-0" data-testid="header-location">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="shrink-0">
              <path d="M12 22s7-7.58 7-13A7 7 0 1 0 5 9c0 5.42 7 13 7 13Z" stroke="#0A1F5C" strokeWidth="1.8" />
              <circle cx="12" cy="9" r="2.4" fill="#E68910" />
            </svg>
            <div className="leading-tight min-w-0">
              <div className="text-[13px] font-bold text-brand-primary truncate">Bhilai</div>
              <div className="text-[10px] text-brand-primary/50 font-medium hidden sm:block">Chhattisgarh</div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
          <a
            href="https://merchant.shoplokl.in"
            data-testid="header-merchant-link"
            className="hidden sm:inline text-sm font-semibold text-brand-primary/70 hover:text-brand-primary"
          >
            For Merchants
          </a>
          <span className="inline-flex items-center rounded-full bg-brand-primary text-white text-[11px] sm:text-sm font-bold px-3 sm:px-4 py-1.5 sm:py-2 whitespace-nowrap">
            Bhilai — Coming soon
          </span>
        </div>
      </div>
    </header>
  );
}
