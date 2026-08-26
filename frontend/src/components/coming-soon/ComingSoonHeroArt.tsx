/**
 * ComingSoonHeroArt — adapted from docs/design/lokl-coming-soon-redesign.html's
 * hero illustration (orbit rings + central shopping-bag badge + 3 orbit
 * chips: location, fashion, pay-at-door). Recolored to Lokl's actual
 * design tokens (brand-primary #0A1F5C, brand-accent #E68910, brand-bg
 * #FDFBF7) instead of the reference's own off-palette navy/teal. The
 * reference's 4th "speed" chip carried a floating "45 MIN" sticker — an
 * unverified delivery-time claim — so that chip is now a plain speed/
 * motion icon with no number attached, and the sticker itself is dropped.
 *
 * This is bespoke vector art, not stock imagery: no existing repo asset
 * covers "neighbourhood + fashion + local delivery" (production uses real
 * photography for its hero, not illustration), so this is a new, small,
 * Coming-Soon-only visual rather than an invented stock photo.
 */
export function ComingSoonHeroArt() {
  return (
    <svg viewBox="0 0 440 440" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto max-w-[280px] sm:max-w-[360px] lg:max-w-[440px] mx-auto" aria-hidden="true">
      <defs>
        <radialGradient id="cs-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#E68910" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#E68910" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="220" cy="220" r="185" fill="url(#cs-glow)" />
      <circle cx="220" cy="220" r="175" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" strokeDasharray="3 7" />

      <g stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" strokeDasharray="2 6">
        <line x1="220" y1="220" x2="220" y2="52" />
        <line x1="220" y1="220" x2="388" y2="220" />
        <line x1="220" y1="220" x2="220" y2="388" />
        <line x1="220" y1="220" x2="52" y2="220" />
      </g>

      {/* central badge: shopping bag = lokl */}
      <rect x="145" y="145" width="150" height="150" rx="34" fill="#FDFBF7" />
      <path d="M188 214a32 26 0 0 1 64 0" stroke="#0A1F5C" strokeWidth="7" strokeLinecap="round" fill="none" />
      <rect x="182" y="212" width="76" height="60" rx="10" fill="#0A1F5C" />
      <line x1="182" y1="234" x2="258" y2="234" stroke="#FDFBF7" strokeWidth="2" opacity="0.5" />
      <circle cx="252" cy="200" r="6.5" fill="none" stroke="#E68910" strokeWidth="2.5" />
      <path d="M252 206.5 L243.5 221 L260.5 221 Z" fill="#E68910" />

      {/* orbit chip: location pin (top) */}
      <circle cx="220" cy="52" r="30" fill="#0A1F5C" />
      <path d="M220 38c-6 0-11 5-11 11 0 8 11 19 11 19s11-11 11-19c0-6-5-11-11-11Z" fill="#FDFBF7" />
      <circle cx="220" cy="49" r="3.6" fill="#0A1F5C" />

      {/* orbit chip: speed / motion (right) — no attached number */}
      <circle cx="388" cy="220" r="30" fill="#E68910" />
      <g stroke="#FDFBF7" strokeWidth="2.2" strokeLinecap="round">
        <line x1="374" y1="212" x2="388" y2="212" />
        <line x1="370" y1="220" x2="392" y2="220" />
        <line x1="376" y1="228" x2="386" y2="228" />
      </g>

      {/* orbit chip: hanger / fashion (bottom) */}
      <circle cx="220" cy="388" r="30" fill="#0A1F5C" />
      <circle cx="220" cy="374" r="4" fill="none" stroke="#FDFBF7" strokeWidth="2.2" />
      <path d="M220 378l-14 12h28l-14-12Z" fill="none" stroke="#FDFBF7" strokeWidth="2.2" strokeLinejoin="round" />

      {/* orbit chip: pay at the door (left) */}
      <circle cx="52" cy="220" r="30" fill="#E68910" />
      <text x="52" y="227" fontFamily="var(--font-display, sans-serif)" fontSize="20" fontWeight="800" fill="#FDFBF7" textAnchor="middle">₹</text>
    </svg>
  );
}
