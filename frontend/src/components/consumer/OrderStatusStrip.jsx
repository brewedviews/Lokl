import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bike, CheckCircle2, Package } from "lucide-react";
import api from "../../lib/api";

const STATUS_META = {
  pending_merchant: { label: "Waiting for store", c: "bg-[#E68910]/15 text-[#E68910]" },
  accepted:         { label: "Store accepted",   c: "bg-blue-100 text-blue-700" },
  on_the_way:       { label: "On the way",       c: "bg-purple-100 text-purple-700" },
  delivered:        { label: "Delivered",        c: "bg-[#4F7363]/15 text-[#4F7363]" },
};

/**
 * Floating strip that polls the customer's most recent active order and shows
 * its status on every customer-facing page. Hidden when nothing is in flight
 * AND when the user is already on the order's own tracking page (no point
 * floating a CTA to the same page).
 */
export default function OrderStatusStrip() {
  const phone = (typeof window !== "undefined" && window.localStorage)
    ? localStorage.getItem("bf_customer_phone") : null;
  const [order, setOrder] = useState(null);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!phone) return;
    const load = async () => {
      try {
        const { data } = await api.get(`/customer/${phone}`);
        const live = (data.orders || []).find((o) => ["pending_merchant", "accepted", "on_the_way"].includes(o.status));
        setOrder(live || null);
      } catch { /* noop */ }
    };
    load();
    const i = setInterval(load, 15_000);
    return () => clearInterval(i);
  }, [phone]);

  if (!order) return null;
  // Hide the floater on the order tracking page itself
  if (pathname.startsWith("/orders/") || pathname.startsWith("/order/")) return null;
  const meta = STATUS_META[order.status] || { label: order.status, c: "bg-zinc-200 text-zinc-700" };
  const Icon = order.status === "delivered" ? CheckCircle2 : order.status === "on_the_way" ? Bike : Package;

  return (
    <Link
      to={`/orders/${order.id}`}
      data-testid="order-status-strip"
      className="fixed bottom-20 left-3 right-3 md:left-auto md:right-6 md:bottom-6 md:max-w-md z-[60] bg-[#1A2B4C] text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 hover:shadow-3xl hover:-translate-y-0.5 transition"
    >
      <div className="w-10 h-10 rounded-full bg-[#E68910] flex items-center justify-center shrink-0">
        <Icon size={18} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-widest text-white/70">{meta.label}</div>
        <div className="font-semibold truncate">Order {order.id} · ₹{Number(order.total).toLocaleString()}</div>
      </div>
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${meta.c}`}>{order.status === "on_the_way" ? "LIVE" : "ACTIVE"}</span>
    </Link>
  );
}
