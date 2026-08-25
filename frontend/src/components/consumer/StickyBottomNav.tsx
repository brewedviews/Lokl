"use client";

/**
 * Mobile-only sticky bottom navigation. Hidden on /merchant + /admin + /rider
 * routes (the rider PWA has its own minimal top-bar chrome, see
 * app/rider/layout.tsx — this check is redundant with /rider living outside
 * the (consumer) route group, but kept explicit for the same belt-and-braces
 * reason /merchant and /admin already are).
 *
 * `/product/` routes ARE shown again — this went back and forth: originally
 * excluded, briefly re-enabled with a merged fixed price+CTA bar stacked
 * above it (reverted — read as two competing fixed-chrome models), then
 * excluded again. It's back now on its own, without any fixed CTA bar
 * alongside it — the PDP's Buy now/Add to bag row (see ProductDetailPanel's
 * PdpCtaRow) stays in normal document flow, not fixed. This nav is the
 * only persistent chrome on the PDP.
 *
 *   [ Home ] [ Categories ] [ Search ] [ Bag ] [ Profile ]
 *
 * Wishlist moved into the account page (its own boxed section, matching
 * the address box) — the standalone /wishlist route still works, it's
 * just no longer the primary entry point.
 *
 * G9 §16 — the Search tab is now a plain `<Link href="/search">`, same
 * `isActive()` pathname pattern every other tab already uses. It used to
 * be a button calling `useSearchOverlay.show()`, opening `MobileSearchSheet`
 * (a header-anchored overlay in ConsumerHeader.tsx) — that overlay's own
 * recent/suggestion/trending logic has been ported into `/search/page.tsx`
 * itself (see that file's own top comment), so nothing was lost, only
 * relocated to a real, back-navigable, directly-linkable page. `/products`
 * itself is still reachable the same way it always was (desktop header's
 * "Products" nav link, Home's category tiles) — this tab was never it.
 *
 * G9 label change — "Add to Cart" -> "Bag" (text only; same useCartStore,
 * same /checkout destination, same badge/item-count source below).
 * Stores itself isn't orphaned: desktop keeps its unchanged header
 * nav-stores link (≥lg), and mobile finds it via the "Browse Stores"
 * quick-link now on `/search`'s own idle state — still one tap from this
 * same Search tab.
 *
 * /checkout (the merged Bag/Checkout screen, formerly two pages) is
 * EXCLUDED — it has its own sticky bottom price+CTA bar, and stacking that
 * on top of this generic 5-tab nav is exactly the "two competing
 * fixed-chrome models" the PDP already tried and reverted once (see the
 * /product/ note above) — same resolution applied here instead of
 * repeating that mistake. (Also means the new Cart tab never has to render
 * "active" on the very page it links to.)
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Grid3x3, ShoppingBag, Search, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { trackNavClick } from "@/lib/analytics";
import { useCartStore } from "@/stores";
import { useMounted } from "@/hooks/useMounted";

export function StickyBottomNav() {
  const pathname = usePathname();
  const mounted = useMounted();
  const cartCount = useCartStore((s) => s.getItemCount());

  if (pathname.startsWith("/merchant") || pathname.startsWith("/admin") || pathname.startsWith("/rider") || pathname.startsWith("/checkout")) return null;

  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav
      data-testid="sticky-bottom-nav"
      className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-white border-t border-card-border shadow-[0_-2px_12px_rgba(10,31,92,0.06)]"
      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
    >
      <ul className="grid grid-cols-5 px-1 pt-1">
        <li className="flex items-center justify-center">
          <Link href="/" data-testid="nav-home" onClick={() => { try { trackNavClick("home"); } catch {} }} className={cn("w-full flex flex-col items-center gap-1 px-2 py-2 rounded-2xl transition", isActive("/") ? "text-brand-accent" : "text-slate-600")}>
            <Home size={20} />
            <span className="text-[10px] font-medium">Home</span>
          </Link>
        </li>
        <li className="flex items-center justify-center">
          <Link href="/categories" data-testid="nav-categories" onClick={() => { try { trackNavClick("categories"); } catch {} }} className={cn("w-full flex flex-col items-center gap-1 px-2 py-2 rounded-2xl transition", isActive("/categories") ? "text-brand-accent" : "text-slate-600")}>
            <Grid3x3 size={20} />
            <span className="text-[10px] font-medium">Categories</span>
          </Link>
        </li>
        <li className="flex items-center justify-center">
          <Link href="/search" data-testid="nav-search" onClick={() => { try { trackNavClick("search"); } catch {} }} className={cn("w-full flex flex-col items-center gap-1 px-2 py-2 rounded-2xl transition", isActive("/search") ? "text-brand-accent" : "text-slate-600")}>
            <Search size={20} />
            <span className="text-[10px] font-medium">Search</span>
          </Link>
        </li>
        <li className="flex items-center justify-center">
          <Link href="/checkout" data-testid="nav-cart" onClick={() => { try { trackNavClick("cart"); } catch {} }} className={cn("relative w-full flex flex-col items-center gap-1 px-2 py-2 rounded-2xl transition", isActive("/checkout") ? "text-brand-accent" : "text-slate-600")}>
            <span className="relative inline-flex">
              <ShoppingBag size={20} />
              {mounted && cartCount > 0 && (
                <span
                  data-testid="cart-badge"
                  className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-brand-accent text-white text-[9px] font-bold leading-4 text-center"
                >
                  {cartCount}
                </span>
              )}
            </span>
            <span className="text-[10px] font-medium">Bag</span>
          </Link>
        </li>
        <li className="flex items-center justify-center">
          <Link href="/account" data-testid="nav-profile" onClick={() => { try { trackNavClick("profile"); } catch {} }} className={cn("w-full flex flex-col items-center gap-1 px-2 py-2 rounded-2xl transition", isActive("/account") ? "text-brand-accent" : "text-slate-600")}>
            <User size={20} />
            <span className="text-[10px] font-medium">Profile</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
