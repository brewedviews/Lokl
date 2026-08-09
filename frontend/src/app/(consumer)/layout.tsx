import { Toaster } from "sonner";
import { ConsumerHeader } from "@/components/consumer/ConsumerHeader";
import { StickyBottomNav } from "@/components/consumer/StickyBottomNav";
import { LocationBanner } from "@/components/consumer/LocationBanner";
import { SearchOverlayHost } from "@/components/consumer/SearchOverlayHost";
import { ActiveOrderPill } from "@/components/consumer/ActiveOrderPill";

/**
 * Consumer route-group layout. Wraps every public-facing page with the
 * sticky header (sourced from Zustand stores) + mobile bottom nav, plus the
 * global Sonner toaster.
 *
 * Bottom-nav clearance is applied ONCE here, on the `{children}` wrapper,
 * via the `bottom-nav-safe` utility (padding-bottom: 6rem + the iPhone
 * safe-area inset — see globals.css) — every page under this layout gets it
 * automatically, including any future one. This used to be a per-page
 * opt-in and pages routinely forgot it (account, all seven policy pages,
 * search, stores, cart, order detail, category pages, ...) — a page
 * literally cannot ship without this padding now, since it's not that
 * page's code that's responsible for it. Do NOT re-add `bottom-nav-safe`
 * (or an equivalent manual `pb-24`/`pb-*` "just in case") to an individual
 * page's own root — it stacks with this wrapper's padding and produces a
 * double gap at the bottom instead of fixing anything.
 *
 * Iter-45 — `LocationBanner` mounts directly under the header; it's a no-op
 * for shoppers in the Bhilai footprint and surfaces a soft warning otherwise.
 *
 * The `flex-1 flex flex-col` wrapper around `{children}` matters: html/body
 * have no explicit height (see globals.css), so a page root using `h-full`
 * has no percentage basis to resolve against and silently falls back to
 * `auto`. Making this wrapper an actual flex column lets each page's root
 * use `flex-1` (flex-grow) instead — that's resolvable with no percentage
 * involved, so its content can fill the true bottom of the viewport on
 * short pages instead of leaving dead space above the sticky bottom nav.
 * Pages must pair this with their own `flex-1 flex flex-col` root — see
 * stores/page.tsx. (No page-level Footer exists anymore — the bottom nav
 * covers that role; the homepage additionally ends with TrustStickers.)
 */
export default function ConsumerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen">
      <Toaster position="top-center" richColors />
      <ConsumerHeader />
      <LocationBanner />
      <div className="flex-1 flex flex-col bottom-nav-safe">{children}</div>
      <ActiveOrderPill />
      <StickyBottomNav />
      <SearchOverlayHost />
    </div>
  );
}
