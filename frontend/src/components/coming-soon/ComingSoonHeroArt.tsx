/**
 * ComingSoonHeroArt — a Lokl rider on a scooter delivering to a home in a
 * Bhilai neighbourhood. Adapted from the rider-on-scooter illustration
 * found in an earlier revision of the user's own reference file
 * (docs/design/lokl-coming-soon-redesign.html's predecessor had a real
 * rider+delivery-box SVG before a later revision replaced it with an
 * abstract orbit/badge concept) — recolored for a light hero background
 * instead of dark navy, and extended with an explicit home/doorway
 * destination + a connecting route line, since the original only showed
 * the rider against a skyline with no destination. This tells "local
 * store → rider → your door," not an abstract diagram.
 *
 * No repo asset covers this motif (production uses real photography for
 * its own hero, not illustration), and no rider/delivery artwork exists
 * anywhere else in the codebase (checked frontend/public/ and the rider
 * app) — so this is new, bespoke, brand-colored vector art, not stock
 * imagery.
 */
export function ComingSoonHeroArt() {
  return (
    <svg viewBox="0 0 600 420" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto max-w-[320px] sm:max-w-[440px] lg:max-w-[560px] mx-auto" aria-hidden="true">
      {/* ground line / road */}
      <line x1="30" y1="360" x2="570" y2="360" stroke="#E5E2DC" strokeWidth="2" />
      <ellipse cx="230" cy="368" rx="120" ry="10" fill="#0A1F5C" opacity="0.08" />

      {/* route from rider to the front door — the "neighbourhood" cue */}
      <path d="M275 330 Q 360 270 420 300" fill="none" stroke="#0A1F5C" strokeOpacity="0.22" strokeWidth="2" strokeDasharray="2 8" strokeLinecap="round" />
      <g transform="translate(414 282)">
        <path d="M6 0c-3.3 0-6 2.7-6 6 0 4.5 6 10.5 6 10.5s6-6 6-10.5c0-3.3-2.7-6-6-6Z" fill="#E68910" />
        <circle cx="6" cy="6" r="2" fill="#FDFBF7" />
      </g>

      {/* home */}
      <g transform="translate(430 200)">
        <path d="M0 60 L60 20 L120 60 L120 130 L0 130 Z" fill="#FDFBF7" stroke="#E5E2DC" strokeWidth="2" />
        <path d="M-6 62 L60 18 L126 62" fill="none" stroke="#0A1F5C" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="50" y="88" width="24" height="42" rx="2" fill="#0A1F5C" />
        <circle cx="70" cy="109" r="1.6" fill="#FDFBF7" />
        <rect x="16" y="78" width="22" height="20" rx="2" fill="#F4F1E9" stroke="#0A1F5C" strokeWidth="1.6" />
        <rect x="82" y="78" width="22" height="20" rx="2" fill="#F4F1E9" stroke="#0A1F5C" strokeWidth="1.6" />
        <circle cx="93" cy="88" r="3" fill="#E68910" opacity="0.85" />
      </g>

      {/* small trees beside the home, kept simple */}
      <g transform="translate(392 260)">
        <rect x="6" y="34" width="6" height="26" fill="#0A1F5C" opacity="0.35" />
        <circle cx="9" cy="24" r="16" fill="#E68910" opacity="0.18" />
      </g>

      {/* motion lines behind the scooter */}
      <g stroke="#0A1F5C" strokeOpacity="0.18" strokeWidth="4" strokeLinecap="round">
        <line x1="60" y1="300" x2="100" y2="300" />
        <line x1="50" y1="325" x2="105" y2="325" />
        <line x1="65" y1="348" x2="95" y2="348" />
      </g>

      {/* scooter */}
      <g transform="translate(120 0)">
        <circle cx="80" cy="335" r="26" fill="#0A1F5C" />
        <circle cx="80" cy="335" r="9" fill="#FDFBF7" />
        <circle cx="225" cy="335" r="26" fill="#0A1F5C" />
        <circle cx="225" cy="335" r="9" fill="#FDFBF7" />
        <path d="M76 339 Q80 288 122 284 L188 284 Q220 284 220 318 L220 339 L76 339 Z" fill="#E68910" />
        <rect x="70" y="282" width="9" height="48" rx="4" fill="#0A1F5C" />
        <path d="M68 282 Q68 256 96 253" stroke="#0A1F5C" strokeWidth="8" strokeLinecap="round" fill="none" />
      </g>

      {/* rider */}
      <g transform="translate(120 0)">
        <path d="M104 260 Q90 256 82 273" stroke="#C88B5A" strokeWidth="10" strokeLinecap="round" fill="none" />
        <path d="M172 258 Q190 254 200 288" stroke="#C88B5A" strokeWidth="10" strokeLinecap="round" fill="none" />
        <rect x="118" y="222" width="50" height="72" rx="20" fill="#FDFBF7" stroke="#0A1F5C" strokeWidth="2.5" />
        <circle cx="145" cy="196" r="24" fill="#C88B5A" />
        <path d="M121 194a24 21 0 0 1 48 -3 Q145 176 121 194Z" fill="#0A1F5C" />
        <ellipse cx="145" cy="174" rx="26" ry="14" fill="#0A1F5C" />
        <rect x="133" y="168" width="24" height="6" rx="3" fill="#E68910" />
      </g>

      {/* delivery box, branded */}
      <g transform="translate(120 0)">
        <rect x="196" y="196" width="70" height="78" rx="12" fill="#0A1F5C" />
        <text x="231" y="242" fontFamily="var(--font-display, sans-serif)" fontSize="15" fontWeight="800" fill="#FDFBF7" textAnchor="middle">lokl</text>
        <circle cx="252" cy="208" r="5" fill="none" stroke="#E68910" strokeWidth="2.2" />
        <path d="M252 213 L246 224 L258 224 Z" fill="#E68910" />
      </g>
    </svg>
  );
}
