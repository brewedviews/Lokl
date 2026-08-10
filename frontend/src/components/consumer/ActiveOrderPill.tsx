"use client";

/**
 * Floating "active order" tracker pill — Swiggy/Zepto-style persistent
 * status bar shown across every consumer page while the signed-in
 * customer has a live (in-progress) order. Mounted once in
 * (consumer)/layout.tsx, sibling to StickyBottomNav, so it survives
 * navigation instead of being a per-page concern.
 *
 * Data: reuses GET /api/customer/{phone} — the SAME endpoint the account
 * page already calls for its order list — rather than adding a new
 * endpoint. Polled every 45s, and only while authenticated; a signed-out
 * visitor never triggers a single request.
 *
 * "Active" = the order's global status (server.py's _derive_global_status,
 * the same FSM every other order-status UI reads) is still in-progress:
 * not delivered, not cancelled/rejected/returned. Pickup orders are
 * excluded — "Arriving in ~45 min" doesn't apply to a store pickup
 * reservation, which has its own code/flow on the product page.
 *
 * No per-order computed ETA exists on the order document (server.py
 * never stores one — confirmed by grep), so this shows the same
 * standard "~45 min" the order tracking page's own status badge already
 * uses, rather than inventing a fake countdown.
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useCustomerAuthStore } from "@/stores";
import type { Order, OrderStatus } from "@/types";

const ACTIVE_STATUSES: OrderStatus[] = [
  "awaiting_payment", "pending_merchant", "accepted", "handed_off", "on_the_way",
];

const STATUS_LABEL: Partial<Record<OrderStatus, string>> = {
  awaiting_payment: "Order placed",
  pending_merchant: "Order placed",
  accepted: "Order accepted",
  handed_off: "Out for delivery",
  on_the_way: "Out for delivery",
};

const POLL_MS = 45_000;

export function ActiveOrderPill() {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthenticated = useCustomerAuthStore((s) => s.isAuthenticated);
  const phone = useCustomerAuthStore((s) => s.phone);
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !phone) { setOrder(null); return; }
    let cancelled = false;

    const fetchActive = () => {
      apiClient.get<{ orders: Order[] }>(`/api/customer/${phone}`)
        .then((r) => {
          if (cancelled) return;
          const orders = r.data?.orders || [];
          const active = orders
            .filter((o) => (o.order_type ?? "delivery") === "delivery" && ACTIVE_STATUSES.includes(o.status))
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          setOrder(active[0] ?? null);
        })
        .catch(() => {}); // silent — the pill just stays hidden on a transient failure
    };

    fetchActive();
    const timer = setInterval(fetchActive, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isAuthenticated, phone]);

  // Routes that already own the bottom-of-screen real estate (checkout's
  // sticky place-order button, the product page's own sticky add-to-bag
  // bar — both sit at this exact same "just above the bottom nav" offset)
  // or where this is redundant (the order tracking page itself — the user
  // is already looking at this order). StickyBottomNav hides on /merchant
  // and /admin too; mirrored here so the pill never floats over the
  // merchant/admin chrome.
  const hideOnRoute = pathname.startsWith("/checkout")
    || pathname.startsWith("/orders/")
    || pathname.startsWith("/account/orders/")
    || pathname.startsWith("/product/")
    || pathname.startsWith("/merchant")
    || pathname.startsWith("/admin");

  if (!order || hideOnRoute) return null;

  const label = STATUS_LABEL[order.status] || "Order in progress";

  return (
    <button
      type="button"
      onClick={() => router.push(`/account/orders/${order.id}`)}
      data-testid="active-order-pill"
      className="lg:hidden fixed inset-x-4 z-40 flex items-center gap-2.5 bg-white rounded-full pl-2 pr-4 py-2 shadow-[0_4px_16px_rgba(10,31,92,0.14)] border border-[#E5E2DC] active:scale-[0.98] transition-transform"
      style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }}
    >
      <span className="relative w-9 h-9 rounded-full bg-[#E68910]/10 flex items-center justify-center shrink-0">
        <Truck size={16} className="text-[#E68910]" />
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#22C55E] ring-2 ring-white animate-pulse" />
      </span>
      <span className="min-w-0 text-left">
        <span className="block text-[12px] font-bold text-[#0A1F5C] leading-tight truncate">{label} · Arriving ~45 min</span>
        <span className="block text-[10px] text-[#64748B] leading-tight mt-0.5">Tap to track your order</span>
      </span>
    </button>
  );
}
