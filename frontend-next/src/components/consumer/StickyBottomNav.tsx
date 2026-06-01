"use client";

/**
 * StickyBottomNav — ported from legacy v2 component.
 * Mobile-only, hidden on /merchant + /admin routes.
 * Cart badge is sourced from useCartStore instead of legacy CartContext.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Grid3x3, Heart, Wallet, User } from "lucide-react";
import { toast } from "sonner";
import { useCartStore } from "@/stores";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string | null;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  test: string;
  soon?: boolean;
}

const ITEMS: readonly NavItem[] = [
  { to: "/",           label: "Home",       icon: Home,     test: "nav-home" },
  { to: "/categories", label: "Categories", icon: Grid3x3,  test: "nav-categories" },
  { to: "/wishlist",   label: "Wishlist",   icon: Heart,    test: "nav-wishlist" },
  { to: null,          label: "Wallet",     icon: Wallet,   test: "nav-wallet", soon: true },
  { to: "/account",    label: "Profile",    icon: User,     test: "nav-profile" },
];

export function StickyBottomNav() {
  const pathname = usePathname();
  const count = useCartStore((s) => s.getItemCount());

  if (pathname.startsWith("/merchant") || pathname.startsWith("/admin")) return null;

  return (
    <nav
      data-testid="sticky-bottom-nav"
      className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-white border-t border-card-border shadow-[0_-2px_12px_rgba(10,31,92,0.06)]"
      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
    >
      <ul className="grid grid-cols-5 px-1 pt-1">
        {ITEMS.map((it) => {
          const Icon = it.icon;
          if (it.soon) {
            return (
              <li key={it.test} className="flex items-center justify-center">
                <button
                  type="button"
                  data-testid={it.test}
                  onClick={() => toast.message("Lokl Wallet — coming soon")}
                  className="w-full flex flex-col items-center gap-1 px-2 py-2 rounded-2xl text-slate-500 hover:text-slate-700 transition"
                >
                  <span className="relative">
                    <Icon size={20} />
                    <span className="absolute -top-1.5 -right-3 bg-slate-400 text-white text-[7px] font-bold px-1 py-[1px] rounded-full uppercase tracking-wider">Soon</span>
                  </span>
                  <span className="text-[10px] font-medium">{it.label}</span>
                </button>
              </li>
            );
          }
          const target = it.to ?? "/";
          const isActive = target === "/" ? pathname === "/" : pathname.startsWith(target);
          return (
            <li key={it.test} className="flex items-center justify-center">
              <Link
                href={target}
                data-testid={it.test}
                className={cn(
                  "w-full flex flex-col items-center gap-1 px-2 py-2 rounded-2xl transition",
                  isActive ? "text-brand-accent-alt" : "text-slate-600",
                )}
              >
                <span className="relative">
                  <Icon size={20} />
                  {it.label === "Wishlist" && count > 0 && (
                    <span className="absolute -top-1 -right-2 bg-brand-accent text-white text-[9px] font-bold px-1.5 rounded-full" data-testid="cart-badge">
                      {count}
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-medium">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
