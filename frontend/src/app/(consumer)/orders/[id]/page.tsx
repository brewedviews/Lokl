"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Image from "next/image";
import {
  CheckCircle2, Bike, Package, RotateCcw, MessageCircle, AlertCircle,
  ShieldCheck, MapPin, Receipt, Clock, ShoppingBag, Phone,
} from "lucide-react";
import { api } from "@/lib/api";
import { Footer } from "@/components/consumer/Footer";
import { ReturnModal, ComplaintModal } from "@/components/consumer/ReturnComplaintModals";
import type { Order, OrderTimelineEntry } from "@/types";

const RETURN_WINDOW_HOURS = 24;

const STEPS = [
  { key: "placed", label: "Placed", icon: ShoppingBag },
  { key: "confirmed", label: "Confirmed", icon: CheckCircle2 },
  { key: "on_the_way", label: "Out for delivery", icon: Bike },
  { key: "delivered", label: "Delivered", icon: ShieldCheck },
] as const;

function stepIndexFromStatus(s: string) {
  const x = (s || "").toLowerCase();
  if (x === "delivered" || x === "completed" || x === "returned") return 3;
  if (x === "on_the_way") return 2;
  if (x === "confirmed" || x === "accepted") return 1;
  return 0;
}

function ProgressStepper({ status }: { status: string }) {
  const activeIdx = stepIndexFromStatus(status);
  return (
    <div data-testid="order-stepper" className="relative">
      <div className="flex items-start justify-between gap-1">
        {STEPS.map((s, i) => {
          const done = i <= activeIdx;
          const Icon = s.icon;
          return (
            <div key={s.key} className="flex-1 flex flex-col items-center text-center relative">
              {i > 0 && (
                <div
                  className={`absolute top-3 sm:top-4 right-1/2 w-full h-[2px] -z-0 ${i <= activeIdx ? "bg-[#4F7363]" : "bg-[#E5E2DC]"}`}
                  style={{ transform: "translateX(50%)" }}
                />
              )}
              <div className={`relative z-10 w-7 h-7 sm:w-9 sm:h-9 rounded-full grid place-items-center shrink-0 transition ${done ? "bg-[#4F7363] text-white" : "bg-white border-2 border-[#E5E2DC] text-[#94A3B8]"}`}>
                <Icon size={14} strokeWidth={2.4} />
              </div>
              <div className={`mt-1.5 text-[10px] sm:text-xs font-semibold ${done ? "text-[#0A1F5C]" : "text-[#94A3B8]"} leading-tight`}>
                {s.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function OrderTrackingPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [showReturn, setShowReturn] = useState(false);
  const [showComplaint, setShowComplaint] = useState(false);

  const load = () => api.orders.getById(id).then(setOrder).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const { canReturn, returnWindowExpired, hasEligible } = useMemo(() => {
    if (!order) return { canReturn: false, returnWindowExpired: false, hasEligible: false };
    if (order.status !== "delivered" && order.status !== "returned")
      return { canReturn: false, returnWindowExpired: false, hasEligible: false };
    const items = order.items || [];
    const eligible = items.some((it) => it.return_eligible);
    const deliveredAtStr = order.delivered_at
      || (order.timeline || []).find((t: OrderTimelineEntry) => (t as { label?: string; status?: string }).status === "delivered" || (t as { label?: string }).label === "Delivered")?.at;
    if (!deliveredAtStr || !eligible) return { canReturn: false, returnWindowExpired: false, hasEligible: eligible };
    const cutoff = new Date(deliveredAtStr).getTime() + RETURN_WINDOW_HOURS * 60 * 60 * 1000;
    const expired = Date.now() > cutoff;
    return { canReturn: !expired, returnWindowExpired: expired, hasEligible: eligible };
  }, [order]);

  if (!order) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <div className="flex-1 grid place-items-center text-sm text-[#64748B]">Loading order…</div>
        <Footer />
      </div>
    );
  }

  const status = (order.status || "").toLowerCase();
  const showOtp = !order.is_multi_store && status === "on_the_way" && order.otp;
  const address = order.address;
  const isDeliveredLike = status === "delivered" || status === "returned";
  const isCancelledLike = status === "cancelled";

  const title =
    status === "delivered" ? "Delivered" :
    status === "on_the_way" ? "On the way" :
    status === "cancelled" ? "Cancelled" :
    status === "returned" ? "Returned" :
    "Order confirmed";
  const subtitle =
    status === "delivered" ? "Hope you love it. Return-eligible items can be returned within 24 hours."
    : status === "on_the_way" ? "Your order is en-route. Share the OTP with the rider on arrival."
    : status === "cancelled" ? "This order was cancelled."
    : status === "returned" ? "Pickup completed. Refunds are processed offline."
    : "We've received your order. Your nearby store is packing it up now.";

  const subtotal = (order.items || []).reduce((acc, it) => acc + it.price * (it.qty || 1), 0);
  const total = order.total || subtotal;

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-8 pt-6 sm:pt-8 space-y-5 sm:space-y-6">
        <section data-testid="status-hero" className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0A1F5C] leading-tight">{title}</h1>
              <p className="text-xs sm:text-sm text-[#64748B] mt-1.5 max-w-md">{subtitle}</p>
              <p className="text-[11px] text-[#64748B] mt-2">
                Order <span className="font-semibold text-[#0A1F5C]" data-testid="order-id">{order.id}</span> · Placed {new Date(order.created_at).toLocaleString()}
              </p>
            </div>
            {!isCancelledLike && !isDeliveredLike && (
              <div className="inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold bg-[#E68910]/10 text-[#E68910] border-[#E68910]/30">
                <Clock size={12} /> 35–45 min
              </div>
            )}
          </div>
          {status !== "cancelled" && (
            <div className="mt-5 sm:mt-6">
              <ProgressStepper status={status} />
            </div>
          )}
        </section>

        {showOtp && (
          <section data-testid="delivery-otp-card" className="bg-[#0A1F5C] text-white rounded-3xl p-5 sm:p-6 text-center border-2 border-[#E68910]/40 shadow-sm">
            <div className="text-[10px] uppercase tracking-[0.25em] text-white/60">Share with the rider</div>
            <div data-testid="delivery-otp" className="font-display text-4xl sm:text-6xl font-bold tracking-[0.3em] tabular-nums text-[#E68910] mt-2">{order.otp}</div>
            <p className="text-[11px] sm:text-xs text-white/70 mt-2">The rider will ask for this 4-digit code on arrival. Do not share until then.</p>
          </section>
        )}

        {(status === "delivered" || status === "returned") && (
          <section className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm" data-testid="post-delivery-actions">
            <h2 className="font-display text-base sm:text-lg font-bold text-[#0A1F5C] mb-3">Need help with this order?</h2>
            {canReturn && hasEligible ? (
              <div className="space-y-3">
                <p className="text-xs text-[#64748B]">Return-eligible items can be returned within {RETURN_WINDOW_HOURS}h of delivery.</p>
                <button
                  onClick={() => setShowReturn(true)}
                  data-testid="return-product-btn"
                  className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold hover:bg-[#D97706] transition"
                >
                  <RotateCcw size={14} /> Return product
                </button>
              </div>
            ) : returnWindowExpired && hasEligible ? (
              <div className="p-3 rounded-2xl bg-[#FDFBF7] border border-[#E5E2DC] flex items-start gap-2" data-testid="return-window-expired">
                <AlertCircle size={16} className="shrink-0 mt-0.5 text-[#E68910]" />
                <div className="text-sm text-[#0A1F5C]">Return window has expired. Please reach out to Customer Care for further assistance.</div>
              </div>
            ) : !hasEligible ? (
              <div className="p-3 rounded-2xl bg-[#FDFBF7] border border-[#E5E2DC] text-sm text-[#64748B]" data-testid="not-return-eligible">
                None of the items in this order are return-eligible.
              </div>
            ) : null}
            <button
              onClick={() => setShowComplaint(true)}
              data-testid="contact-care-btn"
              className="mt-3 w-full md:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full border border-[#0A1F5C] text-[#0A1F5C] font-semibold hover:bg-[#0A1F5C]/5 transition"
            >
              <MessageCircle size={14} /> Contact Customer Care
            </button>
          </section>
        )}

        {address && (
          <section data-testid="delivery-address" className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#0A1F5C]/8 text-[#0A1F5C] grid place-items-center shrink-0">
                <MapPin size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#64748B]">Delivery to {("label" in address && address.label) || "Home"}</div>
                <div className="text-sm font-semibold text-[#0A1F5C] mt-0.5">{address.name || "—"}</div>
                <div className="text-sm text-[#64748B] mt-0.5">{[address.line1, address.landmark].filter(Boolean).join(", ")}</div>
                <div className="text-[11px] text-[#64748B]">{address.city || "Bhilai"} · {address.pincode} · {address.phone}</div>
              </div>
            </div>
          </section>
        )}

        <section data-testid="bag-card" className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Package size={16} className="text-[#0A1F5C]" />
            <h2 className="font-display text-base sm:text-lg font-bold text-[#0A1F5C]">Your bag · {(order.items || []).length} item{(order.items || []).length === 1 ? "" : "s"}</h2>
          </div>
          <div className="divide-y divide-[#E5E2DC]">
            {(order.items || []).map((it) => (
              <div key={it.key || it.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                {it.id ? (
                  <Link href={`/p/${it.id}`} data-testid={`bag-pdp-link-${it.id}`} className="shrink-0">
                    {it.image ? (
                      <Image src={it.image} width={56} height={64} className="w-14 h-16 rounded-xl object-cover bg-[#FDFBF7] border border-[#E5E2DC]" alt={it.name} />
                    ) : <div className="w-14 h-16 rounded-xl bg-slate-100" />}
                  </Link>
                ) : (
                  it.image ? <Image src={it.image} width={56} height={64} className="w-14 h-16 rounded-xl object-cover" alt={it.name} /> : <div className="w-14 h-16 rounded-xl bg-slate-100" />
                )}
                <div className="flex-1 min-w-0">
                  {it.id ? (
                    <Link href={`/p/${it.id}`} className="font-semibold text-[#0A1F5C] hover:text-[#E68910] block truncate text-sm">{it.name}</Link>
                  ) : (
                    <div className="font-semibold text-[#0A1F5C] truncate text-sm">{it.name}</div>
                  )}
                  <div className="text-[11px] text-[#64748B] mt-0.5">
                    Qty {it.qty}{it.size ? ` · Size ${it.size}` : ""}
                    {it.return_eligible && <span className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[9px] font-semibold uppercase tracking-wider">Return eligible</span>}
                  </div>
                </div>
                <div className="font-semibold text-sm text-[#0A1F5C] shrink-0">₹{(it.price * (it.qty || 1)).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </section>

        <section data-testid="bill-summary" className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Receipt size={16} className="text-[#0A1F5C]" />
            <h2 className="font-display text-base sm:text-lg font-bold text-[#0A1F5C]">Bill summary</h2>
          </div>
          <div className="text-sm space-y-2">
            <div className="flex items-baseline justify-between"><span className="text-[#64748B]">Item total</span><span className="text-[#0A1F5C] font-medium">₹{subtotal.toLocaleString()}</span></div>
            <div className="flex items-baseline justify-between"><span className="text-[#64748B]">Delivery fee</span><span className="text-emerald-700 font-semibold">FREE</span></div>
          </div>
          <div className="border-t border-[#E5E2DC] mt-3 pt-3 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-[#0A1F5C]">Total paid</span>
            <span className="font-display text-xl font-bold text-[#0A1F5C]">₹{total.toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-[#64748B] mt-2">Paid via {(order.payment_method || "COD").replace(/_/g, " ")}.</p>
        </section>

        <a
          href="mailto:hello@lokl.in"
          data-testid="help-pill"
          className="flex items-center justify-center gap-2 bg-white border border-[#E5E2DC] hover:border-[#E68910] hover:bg-[#E68910]/[0.04] text-[#0A1F5C] rounded-2xl py-3 font-semibold text-sm transition shadow-sm"
        >
          <Phone size={14} className="text-[#E68910]" /> Need help? hello@lokl.in · +91 70000 70000
        </a>
        <div className="pb-2" />
      </main>

      <Footer />

      {showReturn && <ReturnModal order={order} onClose={() => setShowReturn(false)} onCreated={load} />}
      {showComplaint && <ComplaintModal order={order} onClose={() => setShowComplaint(false)} onCreated={load} />}
    </div>
  );
}
