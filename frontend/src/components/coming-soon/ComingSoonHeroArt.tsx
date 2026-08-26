/**
 * ComingSoonHeroArt — a fine-line, hand-drawn-feeling doodle telling one
 * story left to right: a neighbourhood storefront -> a Lokl rider on a
 * scooter carrying a branded delivery box -> a Bhilai home. Rebuilt from
 * the previous flat-vector version (solid navy/orange shapes, a separate
 * unconnected home) after it was flagged as the weakest, most "AI
 * generated" element on the page.
 *
 * Almost everything here is stroke, not fill — thin navy outlines (1.7-2px,
 * rounded caps/joins), with the Lokl delivery box as the one deliberately
 * solid orange shape (the single accent that makes the scene feel alive,
 * per the brief's own "enough colour to feel alive" note). No skyline
 * blocks, no gradients, no decorative filler — just the three story beats
 * and the route connecting them.
 *
 * Still bespoke vector art, not stock imagery — no repo asset covers this
 * motif (checked frontend/public/ and the rider app; production uses real
 * photography for its own hero, not illustration).
 */
const NAVY = "#0A1F5C";
const ORANGE = "#E68910";

export function ComingSoonHeroArt() {
  return (
    <svg viewBox="0 0 640 300" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto max-w-[340px] sm:max-w-[460px] lg:max-w-[580px] mx-auto" aria-hidden="true">
      {/* ground line */}
      <path d="M14 254 Q320 262 626 254" fill="none" stroke="#E5E2DC" strokeWidth="2" />

      {/* ---- storefront (origin) ---- */}
      <g transform="translate(24 90)">
        <path d="M2 34 8 6h74l6 28" fill="none" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 33c1 5 5 9 10 8 4-1 7-4 8-8 1 5 5 8 9 8 5 0 9-4 9-8 1 5 5 8 9 8 5 0 9-4 9-8 1 5 5 8 9 8s8-3 9-8" fill="none" stroke={NAVY} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M6 40v72h76V40" fill="none" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="16" y="50" width="20" height="22" rx="1.5" fill="none" stroke={NAVY} strokeWidth="1.6" />
        <path d="M35 51 17 71M17 51l18 20" stroke={NAVY} strokeWidth="1" opacity="0.5" />
        <path d="M38 112V88c0-3 2.5-5.5 6-5.5h6c3.5 0 6 2.5 6 5.5v24" fill="none" stroke={NAVY} strokeWidth="1.7" strokeLinecap="round" />
        <rect x="58" y="52" width="20" height="18" rx="1.5" fill="none" stroke={NAVY} strokeWidth="1.6" />
        <circle cx="68" cy="61" r="2.2" fill={ORANGE} />
      </g>

      {/* route from store to home */}
      <path d="M124 220 C 220 246, 300 246, 340 224 S 470 190, 560 216" fill="none" stroke={NAVY} strokeOpacity="0.28" strokeWidth="1.6" strokeDasharray="1 9" strokeLinecap="round" />

      {/* motion lines behind the scooter */}
      <g stroke={NAVY} strokeOpacity="0.3" strokeWidth="2.2" strokeLinecap="round">
        <path d="M198 190q14 1 24 0" />
        <path d="M194 204q18 1.5 30 0" />
        <path d="M202 217q11 1 19 0" />
      </g>

      {/* ---- rider + scooter ---- */}
      <g transform="translate(232 60)">
        {/* wheels — slightly uneven, hand-drawn feel */}
        <path d="M28 172a17 16.5 4 1 0 .3 0Z" fill="none" stroke={NAVY} strokeWidth="1.9" />
        <path d="M141 172a17 16.5 -4 1 0 .3 0Z" fill="none" stroke={NAVY} strokeWidth="1.9" />
        {/* scooter body */}
        <path d="M20 176c-2-16 8-30 24-32h56c18 0 22 14 22 26v6" fill="none" stroke={NAVY} strokeWidth="2" strokeLinecap="round" />
        <path d="M46 144h9M97 96q3 26 3 48" fill="none" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M92 96q6-1 11 1" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M46 144q-2-26 22-30" fill="none" stroke={NAVY} strokeWidth="2" strokeLinecap="round" />
        {/* rider body */}
        <path d="M50 138q-14-3-19 12" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <path d="M78 133q13-4 20 16" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <path d="M52 92q-3 3-3 20t3 24q2 6 12 6h8q10 0 12-6t3-24-3-20" fill="#FDFBF7" stroke={NAVY} strokeWidth="1.9" strokeLinejoin="round" />
        <circle cx="69" cy="80" r="13.5" fill="none" stroke={NAVY} strokeWidth="1.9" />
        <path d="M55 79q1-15 15-16t15 12q-8-6-15-3t-15 7Z" fill={NAVY} />
        <path d="M60 70q9-3 18 0" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* ---- delivery box, the one solid accent ---- */}
      <g transform="translate(232 60)">
        <rect x="100" y="88" width="46" height="52" rx="7" fill={ORANGE} />
        <text x="123" y="120" fontFamily="var(--font-display, sans-serif)" fontSize="13" fontWeight="800" fill="#FDFBF7" textAnchor="middle">lokl</text>
        <path d="M132 92q3-6 8-4" stroke="#FDFBF7" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.7" />
      </g>

      {/* ---- home (destination) ---- */}
      <g transform="translate(538 108)">
        <path d="M2 44 44 6l42 38" fill="none" stroke={NAVY} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 40v58h70V40" fill="none" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M35 98V70q0-4 4-4h10q4 0 4 4v28" fill="none" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="40" cy="84" r="1.4" fill={NAVY} />
        <rect x="55" y="58" width="16" height="14" rx="1.4" fill="none" stroke={NAVY} strokeWidth="1.5" />
        <path d="M55 58l16 14M71 58 55 72" stroke={NAVY} strokeWidth="0.9" opacity="0.5" />
      </g>
      <g transform="translate(618 176)">
        <path d="M0 0c-3.2 0-5.8 2.6-5.8 5.8 0 4.3 5.8 10 5.8 10s5.8-5.7 5.8-10C5.8 2.6 3.2 0 0 0Z" fill={ORANGE} />
        <circle cx="0" cy="5.8" r="2" fill="#FDFBF7" />
      </g>

      {/* small tree beside the home, single line */}
      <path d="M520 210v34M520 214q-9-2-10 8t9 10q1-9 1-18Z" fill="none" stroke={NAVY} strokeOpacity="0.4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
