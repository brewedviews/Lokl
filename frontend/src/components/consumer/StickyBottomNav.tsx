"use client";

/**
 * Mobile-only sticky bottom navigation. Hidden on /merchant + /admin + /rider
 * routes (the rider PWA has its own minimal top-bar chrome, see
 * app/rider/layout.tsx — this check is redundant with /rider living outside
 * the (consumer) route group, but kept explicit for the same belt-and-braces
 * reason /merchant and /admin already are).
 *
 *   [ Home ] [ Categories ] [ All ] [ Stores ] [ Profile ]
 *
 * Wishlist moved into the account page (its own boxed section, matching
 * the address box) — the standalone /wishlist route still works, it's
 * just no longer the primary entry point. Search lives in the pinned bar
 * in ConsumerHeader (its own in-place top sheet), not here — cart already
 * lives top-right in the consumer header too, so neither doubles up.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Grid3x3, Store, ShoppingBag, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { trackNavClick } from "@/lib/analytics";

export function StickyBottomNav() {
  const pathname = usePathname();

  if (pathname.startsWith("/merchant") || pathname.startsWith("/admin") || pathname.startsWith("/rider")) return null;

  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav
      data-testid="sticky-bottom-nav"
      className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-white border-t border-card-border shadow-[0_-2px_12px_rgba(10,31,92,0.06)]"
      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
    >
      <ul className="grid grid-cols-5 px-1 pt-1">
        <li className="flex items-center justify-center">
          <Link href="/" data-testid="nav-home" onClick={() => { try { trackNavClick("home"); } catch {} }} className={cn("w-full flex flex-col items-center gap-1 px-2 py-2 rounded-2xl transition", isActive("/") ? "text-brand-accent-alt" : "text-slate-600")}>
            <Home size={20} />
            <span className="text-[10px] font-medium">Home</span>
          </Link>
        </li>
        <li className="flex items-center justify-center">
          <Link href="/categories" data-testid="nav-categories" onClick={() => { try { trackNavClick("categories"); } catch {} }} className={cn("w-full flex flex-col items-center gap-1 px-2 py-2 rounded-2xl transition", isActive("/categories") ? "text-brand-accent-alt" : "text-slate-600")}>
            <Grid3x3 size={20} />
            <span className="text-[10px] font-medium">Categories</span>
          </Link>
        </li>
        <li className="flex items-center justify-center">
          <Link href="/products" data-testid="nav-all-products" onClick={() => { try { trackNavClick("all"); } catch {} }} className={cn("w-full flex flex-col items-center gap-1 px-2 py-2 rounded-2xl transition", isActive("/products") ? "text-brand-accent-alt" : "text-slate-600")}>
            <ShoppingBag size={20} />
            <span className="text-[10px] font-medium">All</span>
          </Link>
        </li>
        <li className="flex items-center justify-center">
          <Link href="/stores" data-testid="nav-stores" onClick={() => { try { trackNavClick("stores"); } catch {} }} className={cn("w-full flex flex-col items-center gap-1 px-2 py-2 rounded-2xl transition", isActive("/stores") ? "text-brand-accent-alt" : "text-slate-600")}>
            <Store size={20} />
            <span className="text-[10px] font-medium">Stores</span>
          </Link>
        </li>
        <li className="flex items-center justify-center">
          <Link href="/account" data-testid="nav-profile" onClick={() => { try { trackNavClick("profile"); } catch {} }} className={cn("w-full flex flex-col items-center gap-1 px-2 py-2 rounded-2xl transition", isActive("/account") ? "text-brand-accent-alt" : "text-slate-600")}>
            <User size={20} />
            <span className="text-[10px] font-medium">Profile</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
