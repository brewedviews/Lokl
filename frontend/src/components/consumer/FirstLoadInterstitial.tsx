/**
 * FirstLoadInterstitial — Phase 10. The minimal first-visit brand moment
 * shown (via LocationOnboardingGate) only for a genuinely first-time/
 * no-location browsing session, before the location-required step.
 *
 * Presentation only — no timing logic, no location logic, no state of its
 * own. LocationOnboardingGate owns how long this stays mounted (holds it
 * for an approximate minimum visual duration, never mounts it at all for
 * a returning user with an already-known location).
 *
 * Reuses the SAME "lokl." wordmark treatment ConsumerHeader already uses
 * (font-display, brand-primary + brand-accent dot) at a larger size —
 * no separate logo asset exists in the repo (checked), and none is
 * introduced here.
 *
 * Accessibility: a real `<h1>` carries the wordmark text (not a decorative
 * image with empty alt), so screen readers announce something meaningful
 * rather than being silently skipped. Nothing here is focusable, so there
 * is nothing for focus to get trapped in. The fade-in is gated behind
 * `@media (prefers-reduced-motion: no-preference)` (see globals.css'
 * `.first-load-fade-in` utility) — a reduced-motion user gets the finished
 * state immediately, no animation at all.
 */
export function FirstLoadInterstitial() {
  return (
    <div
      data-testid="first-load-interstitial"
      className="fixed inset-0 z-[70] bg-white flex flex-col items-center justify-center"
    >
      <div className="first-load-fade-in flex flex-col items-center">
        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-brand-primary">
          lokl<span className="text-brand-accent">.</span>
        </h1>
        <p className="mt-3 text-sm sm:text-base text-text-secondary tracking-wide">
          your neighbourhood online
        </p>
      </div>
    </div>
  );
}
