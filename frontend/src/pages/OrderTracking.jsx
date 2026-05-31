import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  CheckCircle2, Bike, Package, RotateCcw, MessageCircle,
  AlertCircle, ShieldCheck, MapPin, Receipt, Clock, ShoppingBag, Phone
} from "lucide-react";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import { ReturnModal, ComplaintModal } from "../components/consumer/ReturnComplaintModals";
import api from "../lib/api";

const RETURN_WINDOW_HOURS = 24;

// 4-step pipeline used by the horizontal stepper. Order matches the
// backend timeline; status_key matches the order.status enum.
const STEPS = [
  { key: "placed",      label: "Placed",       icon: ShoppingBag },
  { key: "confirmed",   label: "Confirmed",    icon: CheckCircle2 },
  { key: "on_the_way",  label: "Out for delivery", icon: Bike },
  { key: "delivered",   label: "Delivered",    icon: ShieldCheck },
];

function stepIndexFromStatus(s) {
  const x = (s || "").toLowerCase();
  if (x === "delivered" || x === "completed" || x === "returned") return 3;
  if (x === "on_the_way") return 2;
  if (x === "confirmed" || x === "accepted") return 1;
  return 0;
}

// Horizontal stepper — dots + connecting bars + labels under each step.
function ProgressStepper({ status }) {
  const activeIdx = stepIndexFromStatus(status);
  return (
    <div data-testid="order-stepper" className="relative">
      <div className="flex items-start justify-between gap-1">
        {STEPS.map((s, i) => {
          const done = i <= activeIdx;
          const Icon = s.icon;
          return (
            <div key={s.key} className="flex-1 flex flex-col items-center text-center relative">
              {/* connector */}
              {i > 0 && (
                <div
                  className={`absolute top-3 sm:top-4 right-1/2 w-full h-[2px] -z-0 ${i <= activeIdx ? "bg-[#4F7363]" : "bg-[#E5E2DC]"}`}
                  style={{ transform: "translateX(50%)" }}
                />
              )}
              <div className={`relative z-10 w-7 h-7 sm:w-9 sm:h-9 rounded-full grid place-items-center shrink-0 transition
                ${done ? "bg-[#4F7363] text-white" : "bg-white border-2 border-[#E5E2DC] text-[#94A3B8]"}`}>
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

// Map a per-merchant state to a step index for the per-store mini stepper.
function stepIndexFromMerchantState(s) {
  const x = (s || "").toLowerCase();
  if (x === "delivered") return 3;
  if (x === "handed_off") return 2;
  if (x === "accepted") return 1;
  return 0;
}

// Compact per-store mini stepper used inside multi-store breakdown.
function MiniStepper({ activeIdx }) {
  return (
    <div className="relative">
      <div className="flex items-start justify-between gap-1">
        {STEPS.map((s, i) => {
          const done = i <= activeIdx;
          const Icon = s.icon;
          return (
            <div key={s.key} className="flex-1 flex flex-col items-center text-center relative">
              {i > 0 && (
                <div
                  className={`absolute top-2.5 right-1/2 w-full h-[2px] -z-0 ${i <= activeIdx ? "bg-[#4F7363]" : "bg-[#E5E2DC]"}`}
                  style={{ transform: "translateX(50%)" }}
                />
              )}
              <div className={`relative z-10 w-5 h-5 sm:w-6 sm:h-6 rounded-full grid place-items-center shrink-0 transition
                ${done ? "bg-[#4F7363] text-white" : "bg-white border-2 border-[#E5E2DC] text-[#94A3B8]"}`}>
                <Icon size={10} strokeWidth={2.6} />
              </div>
              <div className={`mt-1 text-[9px] sm:text-[10px] font-semibold ${done ? "text-[#0A1F5C]" : "text-[#94A3B8]"} leading-tight`}>
                {s.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusHero({ order }) {
  const status = (order.status || "").toLowerCase();
  // For multi-store, derive a richer label (Order/Partial-Order × phase) from
  // the per-store breakdown. Cancelled slices are excluded from the "all"
  // check so they don't block closure of the global order.
  const STATE_RANK = { pending: 0, accepted: 1, handed_off: 2, delivered: 3 };
  const PHASE_TITLE = { pending: "Order placed", accepted: "Order confirmed",
                        handed_off: "Order on the way", delivered: "Order delivered" };
  let multiTitle = null;
  if (order.is_multi_store) {
    const bd = order.store_breakdown || [];
    const active = bd.filter((b) => b.state !== "cancelled");
    if (bd.length && !active.length) {
      multiTitle = "Order cancelled";
    } else if (active.length) {
      // Phase = the HIGHEST state any active slice has reached
      const phase = active.reduce((acc, b) =>
        (STATE_RANK[b.state] ?? 0) > (STATE_RANK[acc] ?? 0) ? b.state : acc, "pending");
      const allAtPhase = active.every((b) => b.state === phase);
      const base = PHASE_TITLE[phase] || "Order placed";
      multiTitle = allAtPhase ? base : base.replace("Order ", "Partial order ");
    }
  }
  const title =
    multiTitle ? multiTitle :
    status === "delivered" ? "Delivered" :
    status === "on_the_way" ? "On the way" :
    status === "cancelled" ? "Cancelled" :
    status === "returned" ? "Returned" :
    status === "completed" ? "Completed" :
    "Order confirmed";
  const subtitle =
    multiTitle && multiTitle.startsWith("Partial") ? "Each store moves at its own pace — track them below."
    : multiTitle === "Order delivered" ? "All your stores have delivered. Hope you love it."
    : multiTitle === "Order on the way" ? "Every store has handed off to a rider. Share the OTP on arrival."
    : multiTitle === "Order confirmed" ? "Both stores have accepted. Packing up now."
    : multiTitle === "Order cancelled" ? "Every slice of this order was cancelled."
    : status === "delivered" ? "Hope you love it. Return-eligible items can be returned within 24 hours."
    : status === "on_the_way" ? "Your order is en-route. Share the OTP with the rider on arrival."
    : status === "cancelled" ? "This order was cancelled."
    : status === "returned" ? "Pickup completed. Refunds are processed offline."
    : "We've received your order. Your nearby store is packing it up now.";
  const isDeliveredLike = multiTitle === "Order delivered" || status === "delivered" || status === "completed";
  const isCancelledLike = multiTitle === "Order cancelled" || status === "cancelled";
  const tone =
    isCancelledLike ? "bg-rose-50 text-rose-700 border-rose-200"
    : isDeliveredLike ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-[#E68910]/10 text-[#E68910] border-[#E68910]/30";

  return (
    <section data-testid="status-hero" className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0A1F5C] leading-tight">{title}</h1>
          <p className="text-xs sm:text-sm text-[#64748B] mt-1.5 max-w-md">{subtitle}</p>
          <p className="text-[11px] text-[#64748B] mt-2">
            Order <span className="font-semibold text-[#0A1F5C]" data-testid="order-id">{order.id}</span> · Placed {new Date(order.created_at).toLocaleString()}
          </p>
        </div>
        {!isCancelledLike && !isDeliveredLike && status !== "returned" && (
          <div className={`inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${tone}`}>
            <Clock size={12} /> 35–45 min
          </div>
        )}
        {isDeliveredLike && (
          <div className={`inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${tone}`}>
            <CheckCircle2 size={12} /> Delivered
          </div>
        )}
      </div>

      {/* stepper hidden for cancelled AND for multi-store (each store has its own) */}
      {status !== "cancelled" && !order.is_multi_store && (
        <div className="mt-5 sm:mt-6">
          <ProgressStepper status={status} />
        </div>
      )}
    </section>
  );
}

function OtpCard({ otp }) {
  return (
    <section data-testid="delivery-otp-card" className="bg-[#0A1F5C] text-white rounded-3xl p-5 sm:p-6 text-center border-2 border-[#E68910]/40 shadow-sm">
      <div className="text-[10px] uppercase tracking-[0.25em] text-white/60">Share with the rider</div>
      <div data-testid="delivery-otp" className="font-display text-4xl sm:text-6xl font-bold tracking-[0.3em] tabular-nums text-[#E68910] mt-2">
        {otp}
      </div>
      <p className="text-[11px] sm:text-xs text-white/70 mt-2">
        The rider will ask for this 4-digit code on arrival. Do not share until then.
      </p>
    </section>
  );
}

function AddressCard({ address }) {
  if (!address) return null;
  const line = [address.line1, address.landmark].filter(Boolean).join(", ");
  return (
    <section data-testid="delivery-address" className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#0A1F5C]/8 text-[#0A1F5C] grid place-items-center shrink-0">
          <MapPin size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#64748B]">Delivery to {address.label || "Home"}</div>
          <div className="text-sm font-semibold text-[#0A1F5C] mt-0.5">{address.name || "—"}</div>
          <div className="text-sm text-[#64748B] mt-0.5">{line}</div>
          <div className="text-[11px] text-[#64748B]">{address.city || "Bhilai"} · {address.pincode} · {address.phone}</div>
        </div>
      </div>
    </section>
  );
}

function BillSummary({ order }) {
  const subtotal = (order.items || []).reduce((acc, it) => acc + (Number(it.price) * (Number(it.qty) || 1)), 0);
  const total = Number(order.total) || subtotal;
  const delivery = order.delivery_fee != null ? Number(order.delivery_fee) : 0;
  const discount = subtotal + delivery - total;

  return (
    <section data-testid="bill-summary" className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Receipt size={16} className="text-[#0A1F5C]" />
        <h2 className="font-display text-base sm:text-lg font-bold text-[#0A1F5C]">Bill summary</h2>
      </div>
      <div className="text-sm space-y-2">
        <Row label="Item total" value={`₹${subtotal.toLocaleString()}`} />
        <Row label="Delivery fee" value={delivery === 0 ? <span className="text-emerald-700 font-semibold">FREE</span> : `₹${delivery}`} />
        {discount > 0 && <Row label="Discount" value={<span className="text-emerald-700">− ₹{discount.toLocaleString()}</span>} />}
      </div>
      <div className="border-t border-[#E5E2DC] mt-3 pt-3 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-[#0A1F5C]">Total paid</span>
        <span className="font-display text-xl font-bold text-[#0A1F5C]">₹{total.toLocaleString()}</span>
      </div>
      <p className="text-[11px] text-[#64748B] mt-2">
        Paid via {(order.payment_mode || "Cash on Delivery").replace(/_/g, " ")}.
      </p>
    </section>
  );
}

const Row = ({ label, value }) => (
  <div className="flex items-baseline justify-between">
    <span className="text-[#64748B]">{label}</span>
    <span className="text-[#0A1F5C] font-medium">{value}</span>
  </div>
);

function ItemsCard({ order }) {
  return (
    <section data-testid="bag-card" className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-[#0A1F5C]" />
          <h2 className="font-display text-base sm:text-lg font-bold text-[#0A1F5C]">
            Your bag · {(order.items || []).length} item{(order.items || []).length === 1 ? "" : "s"}
          </h2>
        </div>
      </div>
      <div className="divide-y divide-[#E5E2DC]">
        {(order.items || []).map((it) => (
          <div key={it.key || it.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            {it.id ? (
              <Link to={`/p/${it.id}`} data-testid={`bag-pdp-link-${it.id}`} className="shrink-0">
                <img src={it.image} className="w-14 h-16 rounded-xl object-cover bg-[#FDFBF7] border border-[#E5E2DC]" alt={it.name} />
              </Link>
            ) : (
              <img src={it.image} className="w-14 h-16 rounded-xl object-cover bg-[#FDFBF7] border border-[#E5E2DC]" alt={it.name} />
            )}
            <div className="flex-1 min-w-0">
              {it.id ? (
                <Link to={`/p/${it.id}`} className="font-semibold text-[#0A1F5C] hover:text-[#E68910] block truncate text-sm">{it.name}</Link>
              ) : (
                <div className="font-semibold text-[#0A1F5C] truncate text-sm">{it.name}</div>
              )}
              <div className="text-[11px] text-[#64748B] mt-0.5">
                Qty {it.qty}{it.size ? ` · Size ${it.size}` : ""}
                {it.return_eligible && <span className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[9px] font-semibold uppercase tracking-wider">Return eligible</span>}
              </div>
            </div>
            <div className="font-semibold text-sm text-[#0A1F5C] shrink-0">₹{(Number(it.price) * (Number(it.qty) || 1)).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function OrderTracking() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [showReturn, setShowReturn] = useState(false);
  const [showComplaint, setShowComplaint] = useState(false);
  const [complaintPrefill, setComplaintPrefill] = useState("general");

  const load = () => api.get(`/orders/${id}`).then((r) => setOrder(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const i = setInterval(load, 8000);
    return () => clearInterval(i);
  }, [id]); // eslint-disable-line

  const { canReturn, returnWindowExpired, hasEligible } = useMemo(() => {
    if (!order) return { canReturn: false, returnWindowExpired: false, hasEligible: false };
    if (order.status !== "delivered" && order.status !== "returned")
      return { canReturn: false, returnWindowExpired: false, hasEligible: false };
    const items = order.items || [];
    const eligible = items.some((it) => it.return_eligible);
    const deliveredAtStr = order.delivered_at
      || (order.timeline || []).find((t) => t.label === "Delivered")?.time;
    if (!deliveredAtStr || !eligible) return { canReturn: false, returnWindowExpired: false, hasEligible: eligible };
    const deliveredAt = new Date(deliveredAtStr);
    const cutoff = deliveredAt.getTime() + RETURN_WINDOW_HOURS * 60 * 60 * 1000;
    const expired = Date.now() > cutoff;
    const alreadyReturning = !!order.return_status;
    return { canReturn: eligible && !expired && !alreadyReturning, returnWindowExpired: expired, hasEligible: eligible };
  }, [order]);

  if (!order) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <ConsumerHeader />
        <div className="flex-1 grid place-items-center text-sm text-[#64748B]">Loading order…</div>
        <Footer />
      </div>
    );
  }

  const status = (order.status || "").toLowerCase();
  // Only show the single global OTP card for SINGLE-store orders. Multi-store
  // orders show one OTP per store inside the per-store breakdown card below.
  const showOtp = !order.is_multi_store && status === "on_the_way" && order.otp;

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <ConsumerHeader />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-8 pt-6 sm:pt-8 space-y-5 sm:space-y-6">
        <StatusHero order={order} />

        {showOtp && <OtpCard otp={order.otp} />}

        {order.is_multi_store && (
          <section data-testid="multi-store-breakdown" className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm">
            <div className="flex items-start gap-2 mb-4">
              <Package size={16} className="text-[#E68910] shrink-0 mt-0.5" />
              <div>
                <h2 className="font-display text-base sm:text-lg font-bold text-[#0A1F5C]">Ordered from {Object.keys(order.merchant_states || {}).length} stores</h2>
                <p className="text-[11px] text-[#64748B] mt-0.5">You paid once. Each store packs and delivers their items separately — track each below.</p>
              </div>
            </div>
            <div className="divide-y divide-[#E5E2DC]">
              {(() => {
                // Prefer enriched store_breakdown from backend; fall back to deriving from items
                const breakdown = order.store_breakdown && order.store_breakdown.length
                  ? order.store_breakdown
                  : Array.from(new Set((order.items || []).map((it) => it.merchant_id))).filter(Boolean).map((mid) => {
                      const its = (order.items || []).filter((it) => it.merchant_id === mid);
                      return {
                        merchant_id: mid,
                        store_id: its[0]?.store_id,
                        store_name: its[0]?.store_name || "Store",
                        items: its,
                        subtotal: its.reduce((a, it) => a + (Number(it.price) * (Number(it.qty) || 1)), 0),
                        state: (order.merchant_states || {})[mid] || "pending",
                      };
                    });
                return breakdown.map((b) => {
                  const idx = stepIndexFromMerchantState(b.state);
                  const stateLabel =
                    b.state === "cancelled" ? "Cancelled"
                    : b.state === "delivered" ? "Delivered"
                    : b.state === "handed_off" ? "Out for delivery"
                    : b.state === "accepted" ? "Confirmed"
                    : "Placed";
                  const tone =
                    b.state === "cancelled" ? "text-rose-700 bg-rose-50"
                    : b.state === "delivered" ? "text-emerald-700 bg-emerald-50"
                    : b.state === "handed_off" ? "text-purple-700 bg-purple-50"
                    : b.state === "accepted" ? "text-[#4F7363] bg-[#4F7363]/10"
                    : "text-[#E68910] bg-[#E68910]/10";
                  // Show this store's unique OTP only after the merchant has
                  // handed the package to the rider (status flips to
                  // "Out for delivery") — same trigger as single-store flow.
                  const showStoreOtp = b.otp && b.state === "handed_off";
                  return (
                    <div key={b.merchant_id} className="py-4 first:pt-0 last:pb-0" data-testid={`store-row-${b.store_id}`}>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-[#0A1F5C] truncate">{b.store_name}</div>
                          <div className="text-[11px] text-[#64748B] mt-0.5">
                            {b.items.length} item{b.items.length === 1 ? "" : "s"} · ₹{Number(b.subtotal).toLocaleString()}
                          </div>
                        </div>
                        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${tone}`}>
                          {stateLabel}
                        </span>
                      </div>
                      {b.state !== "cancelled" && <MiniStepper activeIdx={idx} />}
                      {showStoreOtp && (
                        <div data-testid={`store-otp-${b.store_id}`} className="mt-3 bg-[#0A1F5C] text-white rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-white/70">Delivery OTP</div>
                            <div className="text-[11px] text-white/70 mt-0.5">Share the OTP with the delivery person</div>
                          </div>
                          <div className="font-display text-2xl font-bold tracking-[0.25em] tabular-nums text-[#E68910]">{b.otp}</div>
                        </div>
                      )}
                      {b.state === "cancelled" && b.cancel_reason && (
                        <div className="mt-2 text-[11px] text-rose-700 bg-rose-50 rounded-lg px-3 py-2">
                          Cancelled: {b.cancel_reason}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </section>
        )}

        {status === "cancelled" && order.cancel_reason && (
          <section className="bg-rose-50 border border-rose-200 rounded-3xl p-5 text-sm text-rose-700" data-testid="cancel-reason">
            <div className="font-semibold mb-1 flex items-center gap-2"><AlertCircle size={14} /> Cancellation reason</div>
            <div>{order.cancel_reason}</div>
            <p className="text-[11px] text-rose-700/80 mt-2">If you paid online, your refund is auto-initiated (3-5 working days).</p>
          </section>
        )}

        {/* Help / return actions after delivery */}
        {(status === "delivered" || status === "returned" || status === "completed") && (
          <section className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm" data-testid="post-delivery-actions">
            <h2 className="font-display text-base sm:text-lg font-bold text-[#0A1F5C] mb-3">Need help with this order?</h2>
            {order.return_status ? (
              <div className="p-3 rounded-2xl bg-[#E68910]/10 border border-[#E68910]/30 text-[#0A1F5C] text-sm mb-3 flex items-start gap-2">
                <RotateCcw size={16} className="shrink-0 mt-0.5 text-[#E68910]" />
                <div className="flex-1">
                  <div className="font-semibold">Return in progress · {order.return_status.replace(/_/g, " ")}</div>
                  {order.return_id && (
                    <Link to={`/returns/${order.return_id}`} data-testid="track-return-link"
                      className="text-xs text-[#E68910] font-semibold hover:underline">
                      Track return →
                    </Link>
                  )}
                </div>
              </div>
            ) : canReturn ? (
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
                <div className="text-sm text-[#0A1F5C]">
                  Return window has expired. Please reach out to Customer Care for further assistance.
                </div>
              </div>
            ) : !hasEligible ? (
              <div className="p-3 rounded-2xl bg-[#FDFBF7] border border-[#E5E2DC] text-sm text-[#64748B]" data-testid="not-return-eligible">
                None of the items in this order are return-eligible.
              </div>
            ) : null}

            <button
              onClick={() => { setComplaintPrefill("general"); setShowComplaint(true); }}
              data-testid="contact-care-btn"
              className="mt-3 w-full md:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full border border-[#0A1F5C] text-[#0A1F5C] font-semibold hover:bg-[#0A1F5C]/5 transition"
            >
              <MessageCircle size={14} /> Contact Customer Care
            </button>
          </section>
        )}

        {/* Timeline removed — the horizontal stepper inside StatusHero already
            communicates the same Placed → Confirmed → Out for delivery → Delivered
            progression, so the duplicate card was redundant. */}

        <AddressCard address={order.delivery_address || order.address} />
        <ItemsCard order={order} />
        <BillSummary order={order} />

        {/* Persistent support pill at bottom for any state */}
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
      {showComplaint && <ComplaintModal order={order} onClose={() => setShowComplaint(false)} prefillType={complaintPrefill} onCreated={load} />}
    </div>
  );
}
