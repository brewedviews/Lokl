"use client";

import { Fragment, useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import {
  CheckCircle2, Bike, Package, AlertCircle,
  ShieldCheck, MapPin, Receipt, Clock, ShoppingBag, Phone, Store, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { ReturnModal } from "@/components/consumer/ReturnComplaintModals";
import type { Order, OrderTimelineEntry } from "@/types";

const RETURN_WINDOW_HOURS = 24;

const DELIVERY_STEPS = [
  { key: "placed", label: "Placed", icon: ShoppingBag },
  { key: "confirmed", label: "Confirmed", icon: CheckCircle2 },
  { key: "on_the_way", label: "Out for delivery", icon: Bike },
  { key: "delivered", label: "Delivered", icon: ShieldCheck },
] as const;

const PICKUP_STEPS = [
  { key: "pending_pickup", label: "Requested", icon: ShoppingBag },
  { key: "reserved", label: "Confirmed", icon: CheckCircle2 },
  { key: "collected", label: "Collected", icon: ShieldCheck },
] as const;

function stepIndexFromStatus(s: string) {
  const x = (s || "").toLowerCase();
  if (x === "delivered" || x === "completed" || x === "returned") return 3;
  if (x === "on_the_way") return 2;
  if (x === "confirmed" || x === "accepted") return 1;
  return 0;
}

type StepDef = { key: string; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }> };

function ProgressStepper({ steps, activeIdx }: { steps: readonly StepDef[]; activeIdx: number }) {
  return (
    <div data-testid="order-stepper" className="relative">
      <div className="flex items-start justify-between gap-1">
        {steps.map((s, i) => {
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

function formatPickupCountdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} left`;
}

function PickupTimer({ expiresAt, className }: { expiresAt: string; className?: string }) {
  const [label, setLabel] = useState(() => formatPickupCountdown(expiresAt));
  useEffect(() => {
    const t = setInterval(() => setLabel(formatPickupCountdown(expiresAt)), 30000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return <span className={className}>{label}</span>;
}

export default function OrderTrackingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [notFoundState, setNotFoundState] = useState(false);
  const [showReturn, setShowReturn] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [rated, setRated] = useState<Record<string, boolean>>({});
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    if (!order) return;
    if (!window.confirm("Cancel this order?")) return;
    setCancelling(true);
    try {
      await apiClient.post(`/api/orders/${order.id}/customer-cancel`);
      toast.success("Order cancelled");
      router.refresh();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setCancelling(false);
    }
  };

  const rateProduct = async (productId: string, star: number) => {
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("bf_customer_token") : null;
      await apiClient.post(
        `/api/orders/${id}/rate`,
        { product_id: productId, rating: star },
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
      );
      setRated((prev) => ({ ...prev, [productId]: true }));
      toast.success("Thanks for your rating!");
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const load = () => api.orders.getById(id)
    .then((o) => { setOrder(o); setNotFoundState(false); })
    .catch((e: unknown) => {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 404) setNotFoundState(true);
    });
  useEffect(() => {
    load();
    // Polling cadence: 8s for active orders. We stop the timer once status is
    // terminal (delivered / cancelled / returned) — merchant updates after
    // delivery are out-of-band and not worth burning the customer's battery.
    const t = setInterval(() => {
      const s = (order?.status || "").toLowerCase();
      if (s === "delivered" || s === "cancelled" || s === "returned") return;
      load();
    }, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, order?.status]);

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

  if (notFoundState) {
    return (
      <div className="flex-1 flex flex-col bg-[#FDFBF7]" data-testid="order-not-found">
        <div className="flex-1 grid place-items-center px-6">
          <div className="max-w-md text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 grid place-items-center mx-auto mb-3">
              <AlertCircle size={22} className="text-red-500" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] leading-tight">Something went wrong</h1>
            <p className="text-sm text-[#64748B] mt-2">We couldn&apos;t find this order. It may have been cancelled or the link is broken.</p>
            <Link href="/account" className="inline-block mt-5 px-5 py-2.5 rounded-full bg-[#E68910] text-white text-sm font-semibold">Back to my account</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex-1 flex flex-col bg-[#FDFBF7]">
        <div className="flex-1 grid place-items-center text-sm text-[#64748B]">Loading order…</div>
      </div>
    );
  }

  const status = (order.status || "").toLowerCase();
  const isPickup = order.order_type === "pickup";
  const pickupCode = order.pickup_code;
  const pickupExpiresAt = order.pickup_expires_at;
  const pickupStoreName = order.store_name;
  const pickupStoreAddress = order.store_address;
  const pickupMapsLink = order.maps_link;
  const showOtp = !order.is_multi_store && status === "on_the_way" && order.otp;
  const address = order.address;
  const isDeliveredLike = status === "delivered" || status === "returned";
  const isCancelledLike = status === "cancelled";

  const title =
    isPickup && status === "pending_pickup" ? "Awaiting store confirmation" :
    isPickup && status === "reserved" ? "Ready for pickup" :
    status === "delivered" ? "Delivered" :
    status === "on_the_way" ? "On the way" :
    status === "cancelled" ? "Cancelled" :
    status === "returned" ? "Returned" :
    "Order confirmed";
  const subtitle =
    isPickup && status === "pending_pickup" ? "The store is reviewing your pickup request. You'll receive your code once confirmed."
    : isPickup && status === "reserved" ? "Show the code below at the store. Your reservation is held for 4 hours."
    : status === "delivered" ? "Hope you love it. Return-eligible items can be returned within 24 hours."
    : status === "on_the_way" ? "Your order is en-route. Share the OTP with the rider on arrival."
    : status === "cancelled" ? "This order was cancelled."
    : status === "returned" ? "Pickup completed. Refunds are processed offline."
    : "We've received your order. Your nearby store is packing it up now.";

  const subtotal = (order.items || []).reduce((acc, it) => acc + it.price * (it.qty || 1), 0);
  const total = order.total || subtotal;

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
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
            {isPickup && (
              <div className="inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold bg-[#4F7363]/10 text-[#4F7363] border-[#4F7363]/30">
                <Store size={12} /> Store Pickup
              </div>
            )}
            {!isCancelledLike && !isDeliveredLike && !isPickup && (
              <div className="inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold bg-[#E68910]/10 text-[#E68910] border-[#E68910]/30">
                <Clock size={12} /> 35–45 min
              </div>
            )}
          </div>
          {status !== "cancelled" && (
            <div className="mt-5 sm:mt-6">
              {isPickup ? (
                <ProgressStepper
                  steps={PICKUP_STEPS}
                  activeIdx={status === "delivered" || status === "completed" ? 2 : status === "reserved" ? 1 : 0}
                />
              ) : (
                <ProgressStepper
                  steps={DELIVERY_STEPS}
                  activeIdx={stepIndexFromStatus(status)}
                />
              )}
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

        {isPickup && status === "reserved" && pickupCode && (
          <section data-testid="pickup-code-card" className="bg-[#0A1F5C] text-white rounded-3xl p-5 sm:p-6 text-center border-2 border-[#4F7363]/60 shadow-sm">
            <div className="flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-white/60 mb-1">
              <Store size={12} /> Show at store
            </div>
            <div data-testid="pickup-code-display" className="font-display text-4xl sm:text-6xl font-bold tracking-[0.3em] tabular-nums text-[#4F7363] mt-1">{pickupCode}</div>
            <p className="text-[11px] sm:text-xs text-white/70 mt-2">Show this code to the store staff when you arrive.</p>
            {pickupExpiresAt && (
              <PickupTimer expiresAt={pickupExpiresAt} className="text-xs font-semibold mt-1.5 text-white/50" />
            )}
          </section>
        )}

        {isPickup && (pickupStoreName || pickupStoreAddress || pickupMapsLink) && (
          <section data-testid="pickup-store-location" className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#4F7363]/10 text-[#4F7363] grid place-items-center shrink-0">
                <Store size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#64748B]">Store location</div>
                {pickupStoreName && <div className="text-sm font-semibold text-[#0A1F5C] mt-0.5">{pickupStoreName}</div>}
                {pickupStoreAddress && <div className="text-sm text-[#64748B] mt-0.5">{pickupStoreAddress}</div>}
                {pickupMapsLink && (
                  <a
                    href={pickupMapsLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-[#4F7363] hover:underline"
                  >
                    <MapPin size={12} /> Get directions
                  </a>
                )}
              </div>
            </div>
          </section>
        )}

        {(status === "delivered" || status === "returned") && (
          <section className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm" data-testid="post-delivery-actions">
            <h2 className="font-display text-base sm:text-lg font-bold text-[#0A1F5C] mb-2">Need help with this order?</h2>
            <p className="text-xs text-[#9CA3AF] mb-3">We&apos;re a small team — we&apos;ll respond as soon as we can.</p>
            <Link
              href={`/account/support?order_id=${order.id}`}
              className="flex items-center justify-between p-4 bg-[#FDFBF7] border border-[#E5E2DC] rounded-2xl hover:border-[#E68910] transition"
            >
              <div>
                <p className="text-sm font-semibold text-[#0A1F5C]">Issue with this order?</p>
                <p className="text-xs text-[#9CA3AF] mt-0.5">Raise a support request</p>
              </div>
              <ChevronRight size={16} className="text-[#9CA3AF]" />
            </Link>
          </section>
        )}

        {address && !isPickup && (
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
              <Fragment key={it.key || it.id}>
              <div className="flex gap-3 py-3 first:pt-0 last:pb-0">
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
              {status === "delivered" && !isPickup && (() => {
                const pid = it.id;
                if (!pid) return null;
                return rated[pid] ? (
                  <p className="text-xs text-[#4F7363] font-semibold mt-1">✓ Rated</p>
                ) : (
                  <div className="flex items-center gap-1 mt-1">
                    <p className="text-xs text-[#595959] mr-1">Rate:</p>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button key={star}
                        onClick={() => rateProduct(pid, star)}
                        onMouseEnter={() => setRatings((prev) => ({ ...prev, [pid]: star }))}
                        onMouseLeave={() => setRatings((prev) => ({ ...prev, [pid]: 0 }))}
                        className={`text-lg leading-none ${(ratings[pid] || 0) >= star ? "text-[#E68910]" : "text-[#E5E2DC]"}`}
                      >★</button>
                    ))}
                  </div>
                );
              })()}
              </Fragment>
            ))}

          </div>
        </section>

        {!isPickup && (
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
        )}

        <a
          href="mailto:hello@shoplokl.in"
          data-testid="help-pill"
          className="flex items-center justify-center gap-2 bg-white border border-[#E5E2DC] hover:border-[#E68910] hover:bg-[#E68910]/[0.04] text-[#0A1F5C] rounded-2xl py-3 font-semibold text-sm transition shadow-sm"
        >
          <Phone size={14} className="text-[#E68910]" /> Need help? hello@shoplokl.in · +91 77190 52107
        </a>

        {(status === "pending_merchant" || status === "accepted") && (
          <div className="mx-4 my-4">
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="w-full py-3 border border-red-200 text-red-500 rounded-2xl text-sm font-semibold disabled:opacity-50 transition-colors hover:bg-red-50"
            >
              {cancelling ? "Cancelling..." : "Cancel order"}
            </button>
            <p className="text-center text-xs text-[#9CA3AF] mt-1.5">
              You can cancel before the order is picked up by a rider
            </p>
          </div>
        )}

        <div className="pb-2" />
      </main>

      {showReturn && <ReturnModal order={order} onClose={() => setShowReturn(false)} onCreated={load} />}
    </div>
  );
}
