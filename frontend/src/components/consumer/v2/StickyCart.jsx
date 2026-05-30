import React from "react";
import { Link, useLocation } from "react-router-dom";
import { ShoppingBag, ArrowRight } from "lucide-react";
import { useCart } from "../../../contexts/CartContext";

/** Sticky cart pill — appears after first add. Mobile-only floating button.
 *  Hidden on /cart and /checkout so it doesn't sit on top of the page that
 *  IS the cart. */
export default function StickyCart() {
  const { items, total } = useCart();
  const { pathname } = useLocation();
  const count = (items || []).reduce((s, i) => s + (i.qty || 1), 0);
  if (count === 0) return null;
  if (pathname.startsWith("/cart") || pathname.startsWith("/checkout")) return null;
  return (
    <Link
      to="/cart"
      data-testid="sticky-cart-pill"
      className="md:hidden fixed left-4 right-4 z-30 bottom-[4.25rem] flex items-center justify-between gap-3 px-5 py-3 rounded-full bg-[#0A1F5C] text-white shadow-[0_16px_48px_rgba(10,31,92,0.32)] v2-pop-in"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <span className="inline-flex items-center gap-2 text-sm font-semibold">
        <ShoppingBag size={16} /> {count} {count === 1 ? "item" : "items"} · ₹{Number(total || 0).toLocaleString()}
      </span>
      <span className="inline-flex items-center gap-1 text-sm font-bold">View cart <ArrowRight size={14} /></span>
    </Link>
  );
}
