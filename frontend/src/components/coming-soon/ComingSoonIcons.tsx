/**
 * ComingSoonIcons — a small, shared family of hand-drawn-feeling doodle
 * icons, used by both the hero benefit strip and the "Why Lokl" section so
 * the same concept (e.g. Try & Buy) reads as the same mark in both places
 * — one consistent stroke language across the page instead of a different
 * icon style per section. Thin navy outlines (stroke, not fill) with a
 * single small orange accent each, deliberately not pixel-perfect
 * geometric icon-font glyphs (slightly open shapes, uneven curves) to
 * read as sketched rather than generated.
 */
const STROKE = "#0A1F5C";
const ACCENT = "#E68910";

function Base({ children }: { children: React.ReactNode }) {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export function IconStorefront() {
  return (
    <Base>
      <path d="M4 10.5 5.3 4h15.4l1.3 6.5" stroke={STROKE} strokeWidth="1.8" />
      <path d="M4 10.3c.3 1.6 1.8 2.7 3.3 2.4 1.3-.2 2.3-1.3 2.4-2.6.1 1.4 1.2 2.5 2.6 2.6 1.4.1 2.6-1 2.8-2.5.1 1.4 1.3 2.5 2.7 2.5 1.4 0 2.6-1.1 2.7-2.5" stroke={STROKE} strokeWidth="1.8" />
      <path d="M5.5 12.5V21h15v-8.5" stroke={STROKE} strokeWidth="1.8" />
      <path d="M10.5 21v-5.3c0-.7.6-1.2 1.3-1.2h2.4c.7 0 1.3.5 1.3 1.2V21" stroke={ACCENT} strokeWidth="1.8" />
    </Base>
  );
}

export function IconSearch() {
  return (
    <Base>
      <circle cx="11" cy="11" r="6.4" stroke={STROKE} strokeWidth="1.8" />
      <path d="M15.7 15.8 21 21" stroke={STROKE} strokeWidth="1.9" />
      <circle cx="11" cy="11" r="1.4" fill={ACCENT} />
    </Base>
  );
}

export function IconTimer() {
  return (
    <Base>
      <circle cx="13" cy="14" r="8" stroke={STROKE} strokeWidth="1.8" />
      <path d="M13 9v5l3.6 2" stroke={ACCENT} strokeWidth="1.9" />
      <path d="M10 3h6M13 3v2.2" stroke={STROKE} strokeWidth="1.8" />
    </Base>
  );
}

export function IconTryBuy() {
  return (
    <Base>
      <path d="M4.5 8.5 13 4l8.5 4.5L13 13 4.5 8.5Z" stroke={STROKE} strokeWidth="1.8" />
      <path d="M4.5 8.5v9L13 22V13M21.5 8.5v9L13 22" stroke={STROKE} strokeWidth="1.8" />
      <circle cx="18" cy="6.2" r="2" stroke={ACCENT} strokeWidth="1.7" />
    </Base>
  );
}

export function IconWallet() {
  return (
    <Base>
      <path d="M4 8c0-1.4 1.1-2.5 2.5-2.5H20a1 1 0 0 1 1 1V9" stroke={STROKE} strokeWidth="1.8" />
      <rect x="4" y="8" width="18" height="12" rx="2.2" stroke={STROKE} strokeWidth="1.8" />
      <path d="M15.5 14a2 2 0 1 0 0 4H21v-4h-5.5Z" fill={ACCENT} stroke={ACCENT} strokeWidth="0.5" />
    </Base>
  );
}

export function IconReturn() {
  return (
    <Base>
      <rect x="4.5" y="10.5" width="14" height="11" rx="1.6" stroke={STROKE} strokeWidth="1.8" />
      <path d="M8 10.5V8a2 2 0 0 1 2-2h0" stroke={STROKE} strokeWidth="1.7" />
      <path d="M17 3.5c2.6.8 4.4 3.2 4.4 6 0 3.5-2.8 6.3-6.3 6.3h-1.6" stroke={ACCENT} strokeWidth="1.8" />
      <path d="M15.3 13.6 13 15.8l2.3 2.4" stroke={ACCENT} strokeWidth="1.8" />
    </Base>
  );
}
