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
 *   [ Home ] [ Categories ] [ Search ] [ Add to Cart ] [ Profile ]
 *
 * Wishlist moved into the account page (its own boxed section, matching
 * the address box) — the standalone /wishlist route still works, it's
 * just no longer the primary entry point.
 *
 * Redesign Phase B: the middle slot used to be "All" (a Link to
 * /products); ConsumerHeader's persistent pinned search bar was removed in
 * the same pass, so this slot is now Search's entry point instead — a
 * button (not a Link; it doesn't navigate) that opens the exact same
 * useSearchOverlay-driven sheet the header bar used to open, via the same
 * store. /products itself is still reachable (desktop header's own
 * "Products" nav link, Home's category/price-band tiles, etc.) — it's just
 * no longer a single-tap mobile bottom-nav destination; this is an
 * intentional trade-off, not an oversight — see the redesign notes.
 *
 * Redesign Phase G5: the Stores slot is replaced by Add to Cart — same
 * cart store (useCartStore, already used by the checkout/PDP/bag flows),
 * same /checkout destination the header's own removed cart button used
 * to link to, same item-count source (getItemCount()). Stores itself
 * isn't orphaned: desktop keeps its unchanged header nav-stores link
 * (≥lg), and mobile now finds it via a "Browse Stores" quick-link added
 * to the Search tab's idle sheet (ConsumerHeader's MobileSearchSheet) —
 * this same Search tab, unchanged below, is still one tap away.
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
import { useSearchOverlay, useCartStore } from "@/stores";
import { useMounted } from "@/hooks/useMounted";

export function StickyBottomNav() {
  const pathname = usePathname();
  const searchOpen = useSearchOverlay((s) => s.open);
  const openSearch = useSearchOverlay((s) => s.show);
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
          <button type="button" onClick={() => { try { trackNavClick("search"); } catch {} openSearch(); }} data-testid="nav-search" className={cn("w-full flex flex-col items-center gap-1 px-2 py-2 rounded-2xl transition", searchOpen ? "text-brand-accent" : "text-slate-600")}>
            <Search size={20} />
            <span className="text-[10px] font-medium">Search</span>
          </button>
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
            <span className="text-[10px] font-medium">Add to Cart</span>
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
