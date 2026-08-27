"use client";

/**
 * Store/PDP scroll-position bug — root cause: this app never touches
 * `history.scrollRestoration`, so it stays at the browser's own default
 * ("auto"). With "auto", the BROWSER (not Next.js) tries to restore the
 * exact scroll offset a given history entry last had — most visibly on a
 * hard refresh of a page the user had previously scrolled down on (the
 * browser scrolls back to that old offset mid-load, landing "in the
 * middle" instead of the top), and inconsistently on some client-side
 * navigations too, racing against Next.js App Router's own scroll-to-top
 * behavior for new routes.
 *
 * Fix: set `scrollRestoration = "manual"` once, app-wide, on mount. This
 * is the standard fix for this exact class of bug (not a workaround) —
 * it simply stops the browser from doing its own restoration, so:
 *   - A fresh navigation (new Store/PDP route) starts at the top, since
 *     nothing scrolls it away — Next.js's own default scroll-to-top for
 *     a new route (already correct, unmodified here) is no longer fought.
 *   - A hard refresh starts at the top, since the browser no longer
 *     replays a remembered offset for that history entry.
 *   - Back/forward navigation is NOT broken by this: Next.js's own App
 *     Router restores scroll position internally for its own soft
 *     client-side back/forward navigations, independent of this browser
 *     API flag — this only turns off the browser's SEPARATE, conflicting
 *     mechanism, it doesn't disable Next's.
 *
 * Mounted once in app/providers.tsx (same lazy-side-effect-only pattern
 * as SentryBoot) rather than added per-page — a per-page fix would have
 * to be repeated on every route and could still race with whichever
 * route the browser had cached a scroll offset for.
 */
import { useEffect } from "react";

export function ScrollRestorationManager() {
  useEffect(() => {
    if (typeof window === "undefined" || !("scrollRestoration" in window.history)) return;
    // Deliberately no cleanup/revert — this component lives for the whole
    // app session (mounted once in Providers, never unmounted by route
    // changes), so there's no scenario where reverting to "auto" mid-
    // session would be correct.
    window.history.scrollRestoration = "manual";
  }, []);

  return null;
}
