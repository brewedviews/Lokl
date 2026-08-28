"use client";

/**
 * Store/PDP scroll-position bug, G24 → follow-up fix.
 *
 * G24 diagnosed the REFRESH case correctly (the browser's native
 * `history.scrollRestoration="auto"` replaying a remembered offset on
 * reload) and fixed it by setting `scrollRestoration="manual"` below.
 * That part was right and stays.
 *
 * What G24 got wrong: it assumed Next.js App Router's own "scroll to top
 * on a new route" behavior was already correct and unmodified. Verified
 * directly (temporarily disabling this component's `scrollRestoration`
 * line and re-testing) that this is NOT the case — with or without that
 * line, a real `<Link>` click from an already-scrolled page (Home → a
 * Store card, a PDP → another product in "More from this Store") lands
 * the new route at approximately the OLD page's scroll offset (clamped
 * to the new, usually shorter, page's max scrollable height — e.g.
 * scrolled to 2045px on Home, landing at 984px on the new Store page,
 * exactly that page's own scroll ceiling) instead of at the top. So
 * `ScrollRestorationManager` was never the cause of this bug — it fixed
 * a real, separate problem (refresh) and simply didn't cover this one.
 *
 * The actual gap: nothing in this app — not Next's router, not the
 * browser (scrollRestoration="manual" explicitly tells it not to touch
 * scroll at all now) — ever calls `scrollTo(0, 0)` for a same-layout,
 * client-side PUSH navigation. Next.js's own automatic reset for this
 * exact "new page under the same persistent layout" shape isn't
 * reliable enough to depend on here (confirmed by direct reproduction
 * across three different navigation sources — SellerCard, ProductCard,
 * and a plain product-to-product link — all under the same
 * `(consumer)/layout.tsx`), so this now does it explicitly and
 * deterministically instead of guessing at why the framework's own
 * attempt sometimes doesn't take effect before the swap.
 *
 * Fix, at the navigation layer (not per-page):
 *   - Track `pathname` (next/navigation's `usePathname`) — the one thing
 *     that reliably changes for a real new-route navigation.
 *   - Distinguish PUSH (new navigation — Home→Store, PDP→PDP, etc.) from
 *     POP (browser Back/Forward) via a `popstate` listener. `popstate`
 *     fires synchronously on Back/Forward, strictly before React
 *     processes the resulting route change and runs this component's
 *     effects — so by the time the pathname-change effect below runs,
 *     the flag is already set correctly for that render.
 *   - On PUSH: `scrollTo(0, 0)` — deterministic, no timeout. `usePathname`
 *     only updates AFTER the new route's tree has committed, so the
 *     effect runs against the already-mounted new page; there's no
 *     "content not ready yet" race to work around with a delay.
 *   - On POP: restore the REMEMBERED scrollY for the pathname being
 *     returned to (see the in-memory `scrollMemory` map below), instead
 *     of leaving scroll untouched. Verified this app has no existing
 *     back/forward scroll memory of its own to preserve: before this
 *     addition, a Back navigation didn't restore anything either — it
 *     just left scrollY at whatever raw pixel value it happened to be
 *     the instant before the pop (same "nothing repositions it" gap as
 *     the forward-nav bug, just manifesting on the other direction), so
 *     adding real memory here is additive, not a change in existing
 *     behavior that needed protecting.
 *   - The very first mount (fresh load/hard refresh) is skipped for the
 *     PUSH branch — that's the `scrollRestoration="manual"` line's job,
 *     already verified working; this effect only reacts to a CHANGE in
 *     pathname.
 *
 * `scrollMemory` is populated by a passive `scroll` listener (no
 * throttle needed — it's a single Map.set per event, not a re-render)
 * that records the live scrollY continuously, keyed by
 * `window.location.pathname` — read directly from the browser, NOT from
 * a React ref kept in sync via its own `useEffect([pathname])`. That was
 * the first version of this fix, and it had a real race: at the exact
 * moment of a navigation, a scroll event can fire (e.g. as a side effect
 * of the PUSH branch's own `scrollTo(0, 0)` below) while a React-derived
 * "current pathname" ref still reflects the OLD route, because the
 * effect that updates such a ref runs on its own commit and can trail
 * the browser's actual location change — just enough for that stray
 * event to record `0` under the OLD page's key, silently erasing the
 * real value this whole mechanism exists to remember (confirmed with a
 * temporary debug hook: the map showed the outgoing page's key
 * overwritten to `0` right as the new page loaded). `window.location.
 * pathname` has no such lag — it's updated by the same browser
 * navigation that everything else keys off, never one render behind.
 * Keying by pathname (not a synthetic per-history-entry id) is
 * intentional and sufficient here: every route in this app (a given
 * `/store/{id}` or `/product/{id}`) always renders the same content for
 * the same pathname, so "the last scroll position recorded for this
 * pathname" is exactly "this entity's last scroll position."
 *
 * Mounted once in app/providers.tsx (same lazy-side-effect-only pattern
 * as SentryBoot), not per-page — the whole point is one navigation-layer
 * fix instead of a `window.scrollTo(0,0)` scattered into every card/page
 * that can initiate a route change.
 */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function ScrollRestorationManager() {
  useEffect(() => {
    if (typeof window === "undefined" || !("scrollRestoration" in window.history)) return;
    // Deliberately no cleanup/revert — this component lives for the whole
    // app session (mounted once in Providers, never unmounted by route
    // changes), so there's no scenario where reverting to "auto" mid-
    // session would be correct.
    window.history.scrollRestoration = "manual";
  }, []);

  const pathname = usePathname();
  const isPopRef = useRef(false);
  const isFirstRenderRef = useRef(true);
  const scrollMemory = useRef(new Map<string, number>());

  useEffect(() => {
    const onPopState = () => { isPopRef.current = true; };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    // Keyed off `window.location.pathname` directly, NOT a React ref kept
    // in sync via its own `useEffect([pathname])`. Verified (via a debug
    // build) that during the moment a navigation actually happens, a
    // scroll event can fire while a React-derived "current pathname" ref
    // still reflects the OLD route — React's effect that updates such a
    // ref runs on its own commit, which can trail the browser's actual
    // location change by enough for a stray scroll event to land in
    // between and record 0 under the wrong (old) key, silently erasing
    // the real remembered position. `window.location.pathname` has no
    // such lag — it's the same live browser value the URL bar shows,
    // never one render behind.
    const onScroll = () => { scrollMemory.current.set(window.location.pathname, window.scrollY); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (isFirstRenderRef.current) {
      // Initial mount — not a navigation, nothing to reset.
      isFirstRenderRef.current = false;
      return;
    }
    if (isPopRef.current) {
      isPopRef.current = false;
      const remembered = scrollMemory.current.get(pathname);
      window.scrollTo(0, remembered ?? 0);
      return;
    }
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
