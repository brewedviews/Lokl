/**
 * UnserviceableAreaArt — Phase 9C. A small original illustration for the
 * "Lokl isn't here yet" screen, built in the SAME fine-line grammar as
 * ComingSoonHeroArt.tsx (that file's own doc comment: thin navy strokes,
 * ~1.7-2px, rounded caps/joins, no fills except ONE deliberate solid-orange
 * accent, no gradients, no skyline blocks) — a new composition, not a
 * copy: a small neighbourhood row (the destination we haven't reached yet)
 * with the same solid-orange location pin motif ComingSoonHeroArt already
 * uses at its own "home" end, now the dominant element here, plus two
 * short dashed arcs reusing that file's "motion lines" technique to read
 * as "on the way" rather than "closed"/"error".
 *
 * Deliberately not literally reused from ComingSoonHeroArt (that scene's
 * rider-in-transit story doesn't fit this one — the pin here is planted
 * and waiting, nothing is mid-delivery) — but built from the same hand,
 * checked against the same file for stroke widths/colors so the two never
 * clash if seen back to back.
 */
const NAVY = "#0A1F5C";
const ORANGE = "#E68910";

export function UnserviceableAreaArt() {
  return (
    <svg
      viewBox="0 0 320 220"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto max-w-[220px] sm:max-w-[260px] mx-auto"
      aria-hidden="true"
    >
      {/* ground line — same treatment as ComingSoonHeroArt's own */}
      <path d="M10 190Q160 198 310 190" fill="none" stroke="#E5E2DC" strokeWidth="2" />

      {/* ---- neighbourhood row (three simple houses) ---- */}
      <g transform="translate(46 108)">
        {/* left, small */}
        <g opacity="0.55">
          <path d="M0 40 22 20l22 20" fill="none" stroke={NAVY} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 38v36h36V38" fill="none" stroke={NAVY} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* center, larger — the pin's anchor */}
        <g transform="translate(46 -10)">
          <path d="M0 46 30 14l30 32" fill="none" stroke={NAVY} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 44v46h50V44" fill="none" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M22 90V64q0-4 4-4h8q4 0 4 4v26" fill="none" stroke={NAVY} strokeWidth="1.7" strokeLinecap="round" />
          <rect x="40" y="52" width="12" height="11" rx="1.2" fill="none" stroke={NAVY} strokeWidth="1.4" />
        </g>
        {/* right, small */}
        <g opacity="0.55" transform="translate(104 6)">
          <path d="M0 34 20 16l20 18" fill="none" stroke={NAVY} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 32v32h34V32" fill="none" stroke={NAVY} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>

      {/* short "on the way" arcs — reuses ComingSoonHeroArt's dashed
          motion-line technique, oriented toward the pin instead of a rider */}
      <g stroke={NAVY} strokeOpacity="0.28" strokeWidth="1.6" strokeDasharray="1 8" strokeLinecap="round" fill="none">
        <path d="M18 60q30-24 66-26" />
        <path d="M280 74q-26-18-58-18" />
      </g>

      {/* ---- the pin — the one solid accent, planted above the neighbourhood ---- */}
      <g transform="translate(160 26)">
        <path
          d="M0 0c-15.5 0-28 12.4-28 27.7C-28 50 0 82 0 82s28-32 28-54.3C28 12.4 15.5 0 0 0Z"
          fill={ORANGE}
        />
        <circle cx="0" cy="27" r="10.5" fill="#FDFBF7" />
        <circle cx="0" cy="27" r="4" fill={ORANGE} />
      </g>
    </svg>
  );
}
