import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Home, Grid3x3, Heart, Receipt, User } from "lucide-react";

const ITEMS = [
  { to: "/", label: "Home", icon: Home, test: "nav-home" },
  { to: "/categories", label: "Categories", icon: Grid3x3, test: "nav-categories" },
  { to: "/account?tab=wishlist", label: "Wishlist", icon: Heart, test: "nav-wishlist" },
  { to: "/account?tab=orders", label: "Orders", icon: Receipt, test: "nav-orders" },
  { to: "/account", label: "Profile", icon: User, test: "nav-profile" },
];

export default function StickyBottomNav() {
  const { pathname } = useLocation();
  // Hide on merchant / admin / rider routes
  if (pathname.startsWith("/merchant") || pathname.startsWith("/admin") || pathname.startsWith("/rider")) return null;
  return (
    <nav
      data-testid="sticky-bottom-nav"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200"
      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
    >
      <ul className="grid grid-cols-5">
        {ITEMS.map((it) => {
          const Icon = it.icon;
          return (
            <li key={it.test}>
              <NavLink
                to={it.to}
                end={it.to === "/"}
                data-testid={it.test}
                className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition ${isActive ? "text-[#F59E0B]" : "text-[#64748B]"}`}
              >
                {({ isActive }) => (
                  <>
                    <Icon size={20} strokeWidth={isActive ? 2.4 : 1.9} />
                    {it.label}
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
