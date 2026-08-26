/**
 * ComingSoonMerchantArt — a small doodle: a local shop owner behind their
 * storefront counter, with their products now reaching a phone screen —
 * "your store, online." Same fine-line stroke language as
 * ComingSoonHeroArt (thin navy outlines, one orange accent), kept small
 * and restrained since the merchant section is copy-led, not another
 * hero moment.
 */
const NAVY = "#0A1F5C";
const ORANGE = "#E68910";

export function ComingSoonMerchantArt() {
  return (
    <svg viewBox="0 0 260 180" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto max-w-[220px] mx-auto" aria-hidden="true">
      {/* counter */}
      <path d="M10 150h100" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18 150v-24h84v24" fill="none" stroke={NAVY} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 126h76" stroke={NAVY} strokeOpacity="0.4" strokeWidth="1.3" />
      {/* folded clothes on counter, simple */}
      <rect x="30" y="112" width="20" height="12" rx="2" fill="none" stroke={NAVY} strokeWidth="1.4" />
      <rect x="56" y="110" width="18" height="14" rx="2" fill={ORANGE} opacity="0.85" />

      {/* shop owner */}
      <g transform="translate(6 34)">
        <path d="M20 76q-2-20 2-30" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <path d="M9 44q-1 2-1 18t3 22q2 5 10 5h6q8 0 10-5t3-22-1-18" fill="#FDFBF7" stroke={NAVY} strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="21" cy="26" r="12.5" fill="none" stroke={NAVY} strokeWidth="1.8" />
        <path d="M9 25q1-13 13-13.5T34 22q-6-5-12-3t-13 6Z" fill={NAVY} />
        <path d="M2 58q-4 8-3 18" stroke={NAVY} strokeWidth="1.6" strokeLinecap="round" fill="none" />
        <path d="M40 56q5 7 4 17" stroke={NAVY} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </g>

      {/* route from counter to a phone screen — "going online" */}
      <path d="M96 96q30-10 56-2" fill="none" stroke={NAVY} strokeOpacity="0.3" strokeWidth="1.5" strokeDasharray="1 8" strokeLinecap="round" />

      {/* phone / screen showing the store is now online */}
      <g transform="translate(160 40)">
        <rect x="0" y="0" width="58" height="96" rx="9" fill="none" stroke={NAVY} strokeWidth="1.8" />
        <path d="M20 0h18" stroke={NAVY} strokeWidth="2.4" strokeLinecap="round" />
        <rect x="8" y="14" width="42" height="30" rx="3" fill="none" stroke={NAVY} strokeWidth="1.4" />
        <rect x="8" y="14" width="42" height="30" rx="3" fill={ORANGE} opacity="0.14" />
        <path d="M14 60h30M14 68h22M14 76h26" stroke={NAVY} strokeOpacity="0.35" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="29" cy="88" r="2.4" fill={ORANGE} />
      </g>
    </svg>
  );
}
