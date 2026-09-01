/**
 * Homepage/L1-page closing moment — v3. Replaces TrustStickers (which had
 * accumulated a subtext line, a 3-card narrative and a CTA across two
 * earlier redesigns) with something deliberately much smaller in scope:
 * the brand tagline, set in Lokl's own display type, over an original
 * illustrated neighbourhood street — inspired by (not copied from) a
 * reference the founder shared, simplified to strip every card/CTA/icon-
 * chip/marketing line back out. No button, no subtext, no benefit list —
 * the illustration and the two-line headline are the whole section.
 *
 * The illustration is hand-built inline SVG, not an imported asset or a
 * generated image — flat geometric silhouettes (solid shapes + cream
 * "cutout" windows/doors, the classic papercut-silhouette technique,
 * since SVG has no real boolean subtraction) rather than an attempt at
 * the reference's loose sketch style, which would need real illustration
 * skill to pull off and risks looking worse than doing nothing. Only
 * three colors are used anywhere in it: brand-primary navy (every
 * building/tree-trunk/lamppost), moss-green (tree canopies — an existing
 * PDP token, not a new color), and brand-accent orange used exactly
 * once, on the one shop's awning — everything else stays monochrome so
 * the orange in "online." below still reads as the singular accent, not
 * one of several.
 *
 * Rendered unconditionally as the last thing in <main> on both the
 * marketplace home (MarketplaceHomeClient) and every L1 category page
 * (L1PageClient). There is no page-level Footer (removed; StickyBottomNav
 * covers that role), so this IS the page's closing moment.
 */

export function HomepageEnder() {
  return (
    <section
      className="max-w-7xl mx-auto px-4 pt-10 pb-2 sm:pt-14 sm:pb-4"
      data-testid="homepage-ender"
    >
      <h2 className="text-center font-display font-medium text-4xl sm:text-6xl tracking-tight leading-[1.05] text-brand-primary">
        Your neighbourhood,
        <br />
        <span className="text-brand-accent">online.</span>
      </h2>

      <svg
        className="w-full h-auto mt-6 sm:mt-10"
        viewBox="0 0 1200 340"
        fill="none"
        role="img"
        aria-label="An illustrated street in a Bhilai neighbourhood, with local homes and a corner shop"
      >
        <line x1="0" y1="300" x2="1200" y2="300" stroke="#E7E1D3" strokeWidth="2" />

        {/* ---------- left cluster: two houses + tree + lamppost ---------- */}
        <rect x="140" y="185" width="100" height="90" fill="#0A1F5C" fillOpacity="0.14" />
        <polygon points="140,185 190,140 240,185" fill="#0A1F5C" fillOpacity="0.14" />

        <g stroke="#0A1F5C" strokeOpacity="0.35" strokeWidth="3">
          <line x1="30" y1="300" x2="30" y2="155" />
        </g>
        <circle cx="30" cy="146" r="8" fill="#0A1F5C" fillOpacity="0.35" />

        <rect x="280" y="210" width="9" height="68" fill="#0A1F5C" />
        <circle cx="284.5" cy="196" r="34" fill="#1E5631" />

        <rect x="55" y="155" width="155" height="120" fill="#0A1F5C" />
        <polygon points="47,155 132.5,90 218,155" fill="#0A1F5C" />
        <rect x="78" y="182" width="24" height="24" fill="#E68910" />
        <rect x="170" y="182" width="24" height="24" fill="#FDFBF7" />
        <rect x="118" y="222" width="34" height="53" fill="#FDFBF7" />

        {/* ---------- right cluster: corner shop + house + tree + lamppost ---------- */}
        <rect x="965" y="200" width="85" height="78" fill="#0A1F5C" fillOpacity="0.14" />
        <polygon points="965,200 1007.5,163 1050,200" fill="#0A1F5C" fillOpacity="0.14" />

        <rect x="855" y="218" width="9" height="64" fill="#0A1F5C" />
        <circle cx="859.5" cy="202" r="31" fill="#1E5631" />

        <rect x="978" y="142" width="190" height="19" fill="#E68910" />
        <rect x="986" y="161" width="174" height="110" fill="#0A1F5C" />
        <rect x="1006" y="185" width="32" height="27" fill="#FDFBF7" />
        <rect x="1120" y="185" width="32" height="27" fill="#FDFBF7" />
        <rect x="1058" y="210" width="40" height="61" fill="#FDFBF7" />

        <g stroke="#0A1F5C" strokeOpacity="0.35" strokeWidth="3">
          <line x1="1170" y1="300" x2="1170" y2="158" />
        </g>
        <circle cx="1170" cy="149" r="8" fill="#0A1F5C" fillOpacity="0.35" />

        {/* ---------- a few birds, well clear of the headline above ---------- */}
        <g stroke="#0A1F5C" strokeOpacity="0.4" strokeWidth="3" strokeLinecap="round">
          <path d="M 460 95 q 10 -10 20 0 q 10 -10 20 0" />
          <path d="M 700 65 q 9 -9 18 0 q 9 -9 18 0" />
          <path d="M 636 112 q 8 -8 16 0 q 8 -8 16 0" />
        </g>
      </svg>
    </section>
  );
}
