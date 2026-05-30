import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Home, Grid3x3, Heart, Wallet as WalletIcon, User } from "lucide-react";
import { toast } from "sonner";

// 5-tab bottom nav. The Wallet tile is intentionally non-clickable and shows
// a "coming soon" toast — it occupies the slot between Wishlist and Profile
// so users don't navigate away accidentally before launch.
const ITEMS = [
  { to: "/", label: "Home", icon: Home, test: "nav-home" },
  { to: "/categories", label: "Categories", icon: Grid3x3, test: "nav-categories" },
  { to: "/wishlist", label: "Wishlist", icon: Heart, test: "nav-wishlist" },
  { to: null, label: "Wallet", icon: WalletIcon, test: "nav-wallet", soon: true },
  { to: "/account", label: "Profile", icon: User, test: "nav-profile" },
];

export default function StickyBottomNav() {
  const loc = useLocation();
  if (loc.pathname.startsWith("/merchant") || loc.pathname.startsWith("/admin")) return null;
  return (
    <nav
      data-testid="sticky-bottom-nav"
      className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-white border-t border-slate-200 shadow-[0_-2px_12px_rgba(10,31,92,0.06)]"
      style={{
        transform: "translateZ(0)",
        WebkitTransform: "translateZ(0)",
        paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))",
      }}
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
          return (
            <li key={it.to} className="flex items-center justify-center">
              <NavLink
                to={it.to}
                data-testid={it.test}
                end={it.to === "/"}
                className={({ isActive }) =>
                  `w-full flex flex-col items-center gap-1 px-2 py-2 rounded-2xl ${isActive ? "text-[#F59E0B]" : "text-slate-600"}`
                }
              >
                <Icon size={20} />
                <span className="text-[10px] font-medium">{it.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
