"use client";

/**
 * Checkout — delivery estimate + COD order placement.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Banknote, MapPin, Plus, CheckCircle2, Truck, Clock, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { useCartStore, useCustomerAuthStore } from "@/stores";
import { CustomerOtpLogin } from "@/components/consumer/CustomerOtpLogin";
import { Footer } from "@/components/consumer/Footer";
import { useRazorpay } from "@/hooks/useRazorpay";
import type { CustomerAddress } from "@/types";

interface StoreAvailInfo {
  name: string;
  badge: string;
  rank: number;
  can_order: boolean;
  eta_message: string;
  opens_at_label?: string | null;
}

const BLANK_ADDR = { name: "", phone: "", line1: "", landmark: "", city: "Bhilai", pincode: "", label: "Home" };
// Pilot is Bhilai-only; centroid is good enough until we wire geolocation.
const BHILAI_LAT = 21.1938;
const BHILAI_LNG = 81.3509;

type DeliveryEstimate = {
  deliverable: boolean;
  reason?: string;
  fee: number;
  is_free: boolean;
  eta_min?: number;
  eta_max?: number;
  distance_km?: number;
  free_delivery_threshold?: number;
} | null;

export default function CheckoutPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const subtotal = useCartStore((s) => s.getTotal());
  const clearCart = useCartStore((s) => s.clearCart);
  const phone = useCustomerAuthStore((s) => s.phone);
  const hasAuth = useCustomerAuthStore((s) => s.isAuthenticated);
  const razorpay = useRazorpay();

  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([]);
  const [selectedId, setSelectedId] = useState("__new__");
  const [addr, setAddr] = useState({ ...BLANK_ADDR, phone: phone?.slice(-10) ?? "" });
  const [payment] = useState<"COD">("COD");
  const [placing, setPlacing] = useState(false);
  const [estimate, setEstimate] = useState<DeliveryEstimate>(null);
  const [estimating, setEstimating] = useState(false);
  const [storeAvailMap, setStoreAvailMap] = useState<Record<string, StoreAvailInfo>>({});
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState<{ code: string; discount_amount: number; description: string } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);

  // Single-store rule: every product in the cart must belong to the same
  // store_id for the delivery estimate to be meaningful. Multi-store carts
  // skip the estimate and fall back to FREE delivery (legacy behaviour).
  const uniqueStores = useMemo(() => Array.from(new Set(items.map((it) => it.store_id).filter(Boolean))) as string[], [items]);
  const cartStoreId = uniqueStores.length === 1 ? uniqueStores[0] : null;

  // Fetch store availability for all unique stores in the cart.
  useEffect(() => {
    if (uniqueStores.length === 0) return;
    Promise.all(
      uniqueStores.map((sid) =>
        apiClient.get<{ store: { name?: string; badge?: string; availability_rank?: number; can_order?: boolean; eta_message?: string; next_open_label?: string } }>(
          `/api/stores/${sid}`
        ).then((r) => {
          const s = r.data.store;
          return [sid, {
            name: s.name ?? sid,
            badge: s.badge ?? "LIVE",
            rank: s.availability_rank ?? 1,
            can_order: s.can_order !== false,
            eta_message: s.eta_message ?? "",
            opens_at_label: s.next_open_label ?? null,
          }] as [string, StoreAvailInfo];
        }).catch(() => [sid, { name: sid, badge: "LIVE", rank: 1, can_order: false, eta_message: "" }] as [string, StoreAvailInfo])
      )
    ).then((entries) => setStoreAvailMap(Object.fromEntries(entries)));
  }, [uniqueStores]);

  useEffect(() => {
    if (!hasAuth || !phone) return;
    api.customers.get(phone).then(({ customer }) => {
      const list: CustomerAddress[] = customer?.addresses ?? [];
      setSavedAddresses(list);
      if (list.length > 0) {
        const first = list[0]!;
        setSelectedId(first.id);
        setAddr({
          name: first.name || customer.name || "",
          phone: first.phone || phone.slice(-10),
          line1: first.line1 || "",
          landmark: first.landmark || "",
          city: first.city || "Bhilai",
          pincode: first.pincode || "",
          label: first.label || "Home",
        });
      } else if (customer?.name) {
        setAddr((a) => ({ ...a, name: customer.name ?? "" }));
      }
    }).catch(() => {});
  }, [phone, hasAuth]);

  // Delivery estimate — debounced. Only fires for single-store Bhilai carts.
  useEffect(() => {
    setEstimate(null);
    if (!cartStoreId) return;
    if ((addr.city || "").trim().toLowerCase() !== "bhilai") return;
    if (subtotal <= 0) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setEstimating(true);
      try {
        const r = await api.delivery.estimate({
          customer_lat: BHILAI_LAT, customer_lng: BHILAI_LNG,
          store_id: cartStoreId, order_subtotal: subtotal, city_slug: "bhilai",
        });
        if (cancelled) return;
        setEstimate({
          deliverable: r.deliverable,
          reason: r.reason,
          fee: r.is_free_delivery ? 0 : r.fee,
          is_free: !!r.is_free_delivery,
          eta_min: r.eta_min, eta_max: r.eta_max,
          distance_km: r.distance_km,
          free_delivery_threshold: r.free_delivery_threshold,
        });
      } catch (e) {
        if (cancelled) return;
        // Backend returns 400 for "not deliverable" — surface the reason.
        setEstimate({ deliverable: false, reason: getErrorMessage(e), fee: 0, is_free: false });
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [cartStoreId, addr.city, subtotal]);

  const pickSaved = (id: string) => {
    setSelectedId(id);
    if (id === "__new__") { setAddr({ ...BLANK_ADDR, phone: phone?.slice(-10) ?? "" }); return; }
    const a = savedAddresses.find((x) => x.id === id);
    if (a) setAddr({
      name: a.name || "", phone: a.phone || phone?.slice(-10) || "",
      line1: a.line1 || "", landmark: a.landmark || "",
      city: a.city || "Bhilai", pincode: a.pincode || "", label: a.label || "Home",
    });
  };

  const deliveryFee = estimate?.deliverable ? estimate.fee : 0;
  const discountAmount = couponResult?.discount_amount ?? 0;
  const grandTotal = Math.max(0, subtotal + deliveryFee - discountAmount);

  const applyCoupon = async () => {
    const code = couponCode.trim().toUpperCase();
    if (!code) return;
    setCouponLoading(true); setCouponError(""); setCouponResult(null);
    try {
      const r = await apiClient.post<{ valid: boolean; discount_amount: number; code: string; description: string }>(
        "/api/coupons/validate", { code, subtotal }
      );
      setCouponResult(r.data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Invalid coupon";
      setCouponError(msg);
    } finally { setCouponLoading(false); }
  };
  // We allow Pay Now in multi-store carts (no fee added — legacy "FREE") OR
  // when the delivery estimate succeeded with deliverable=true. Estimates
  // that 4xx (non-deliverable address) disable the button with a reason.
  const canPay = items.length > 0 && (
    !cartStoreId  // multi-store carts skip the estimate
    || (estimate ? estimate.deliverable : !estimating)
  );

  const normalizePhone = (p: string) => p.replace(/\D/g, "").replace(/^0+/, "").padStart(12, "91").slice(-12);

  const place = async () => {
    if (!addr.name || !addr.phone || !addr.line1 || !addr.pincode) return toast.error("Please fill name, phone, address and pincode");
    if (!/^[0-9]{10}$/.test(addr.phone)) return toast.error("Enter a valid 10-digit phone number");
    if ((addr.city || "").trim().toLowerCase() !== "bhilai") {
      return toast.error("Lokl is only serving Bhilai right now — please update your delivery city.");
    }
    if (items.length === 0) return toast.error("Cart is empty");
    const customerToken = typeof window !== "undefined" ? localStorage.getItem("bf_customer_token") : null;
    if (!hasAuth || !customerToken) { router.push("/account"); return; }
    if (estimate && !estimate.deliverable) return toast.error(estimate.reason || "Delivery unavailable for this address");

    setPlacing(true);

    try {
      const order = await api.orders.create({
        items, address: addr, total: grandTotal, payment_method: payment,
        customer: { name: addr.name, phone: normalizePhone(addr.phone) },
        coupon_code: couponResult?.code ?? undefined,
      });
      clearCart();
      toast.success("Order placed!");
      router.push(`/orders/${order.id}`);
    } catch (e) {
      toast.error(getErrorMessage(e));
      setPlacing(false);
    }
  };

  if (!hasAuth) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <div className="flex-1 max-w-md w-full mx-auto px-4 sm:px-8 pt-10 pb-16">
          <CustomerOtpLogin
            title="Sign in to checkout"
            subtitle="We use your number to deliver, send order updates, and process returns."
          />
        </div>
        <Footer />
      </div>
    );
  }

  const uniqueStoreNames = Array.from(new Set(items.map((it) => it.store_name).filter(Boolean)));

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10 grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          {savedAddresses.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-[#E5E2DC]" data-testid="saved-addresses">
              <h3 className="text-[11px] uppercase tracking-widest text-[#595959] mb-3">Deliver to</h3>
              <div className="space-y-2">
                {savedAddresses.map((a) => (
                  <button key={a.id} type="button" data-testid={`pick-addr-${a.id}`} onClick={() => pickSaved(a.id)}
                    className={`w-full text-left p-3 rounded-xl border-2 transition ${selectedId === a.id ? "border-[#1A2B4C] bg-[#1A2B4C]/5" : "border-[#E5E2DC] hover:border-[#1A2B4C]/40"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 text-sm">
                        <div className="font-semibold text-[#1A2B4C] flex items-center gap-2"><MapPin size={13} className="text-[#E68910]" />{a.label || "Home"} · {a.name || phone}</div>
                        <div className="text-[#595959] mt-0.5">{a.line1}</div>
                        {a.landmark && <div className="text-[11px] text-[#595959]">Landmark: {a.landmark}</div>}
                        <div className="text-[11px] text-[#595959]">{a.city || "Bhilai"} · {a.pincode}</div>
                      </div>
                      {selectedId === a.id && <CheckCircle2 size={16} className="text-[#E68910] shrink-0" />}
                    </div>
                  </button>
                ))}
                <button type="button" data-testid="pick-new-addr" onClick={() => pickSaved("__new__")}
                  className={`w-full text-left p-3 rounded-xl border-2 border-dashed flex items-center gap-2 transition ${selectedId === "__new__" ? "border-[#E68910] bg-[#E68910]/5 text-[#E68910]" : "border-[#E5E2DC] text-[#595959] hover:border-[#1A2B4C]/40"}`}>
                  <Plus size={14} /> <span className="text-sm font-semibold">Use a new address</span>
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC]">
            <h2 className="font-display text-2xl font-bold text-[#1A2B4C] mb-4">
              {selectedId === "__new__" ? "New delivery address" : "Address details"}
            </h2>
            <p className="text-xs text-[#595959] mb-4">Saved addresses appear in your account for one-tap checkout next time.</p>
            <div className="grid md:grid-cols-2 gap-3">
              <input data-testid="addr-name" value={addr.name} onChange={(e) => setAddr({ ...addr, name: e.target.value })} placeholder="Full name" className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <input data-testid="addr-phone" value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="Phone" className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <textarea data-testid="addr-line1" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} placeholder="House no, street, locality" rows={2} className="md:col-span-2 px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] resize-none" />
              <input data-testid="addr-landmark" value={addr.landmark} onChange={(e) => setAddr({ ...addr, landmark: e.target.value })} placeholder="Landmark (e.g. opposite SBI / near Globe Chowk)" className="md:col-span-2 px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <input data-testid="addr-city" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} placeholder="City (Bhilai only)" className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <input data-testid="addr-pin" value={addr.pincode} onChange={(e) => setAddr({ ...addr, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="Pincode" className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC]">
            <h2 className="font-display text-2xl font-bold text-[#1A2B4C] mb-4">Payment</h2>
            <div className="flex items-center gap-3 p-4 rounded-2xl border-2 border-[#1A2B4C] bg-[#1A2B4C]/5" data-testid="pay-cod">
              <Banknote size={20} className="text-[#E68910]" />
              <span className="font-semibold text-sm">Pay at Delivery</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC] h-fit">
          <h3 className="font-display text-xl font-bold text-[#1A2B4C] mb-3">Bag ({items.length})</h3>
          {uniqueStoreNames.length > 1 && (
            <div data-testid="multi-store-notice" className="mb-3 rounded-xl border border-[#E68910]/30 bg-[#E68910]/10 px-3 py-2 text-[12px] text-[#0A1F5C]">
              Your bag has items from <strong>{uniqueStoreNames.length} stores</strong>. You&apos;ll pay once now and may receive
              <strong> {uniqueStoreNames.length} separate deliveries</strong> — one from each store.
            </div>
          )}
          {uniqueStores.some((sid) => storeAvailMap[sid]?.rank === 3) && (
            <div data-testid="scheduled-order-notice" className="mb-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] text-blue-800 flex items-start gap-2">
              <Info size={13} className="shrink-0 mt-0.5" />
              <span>
                One or more stores are currently closed. Your order will be fulfilled when they open.
                {uniqueStores.filter((sid) => storeAvailMap[sid]?.rank === 3).map((sid) => {
                  const info = storeAvailMap[sid];
                  return info?.opens_at_label ? ` ${info.name}: ${info.opens_at_label}.` : "";
                }).join("")}
              </span>
            </div>
          )}
          <div className="space-y-3 max-h-72 overflow-auto">
            {items.map((it) => (
              <div key={it.key} className="flex gap-3 text-sm">
                {it.image ? (
                  <Image src={it.image} alt={it.name} width={56} height={64} className="w-14 h-16 rounded-lg object-cover" />
                ) : <div className="w-14 h-16 rounded-lg bg-slate-100" />}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[#1A2B4C] truncate">{it.name}</div>
                  <div className="text-xs text-[#595959]">{it.store_name ? `${it.store_name} · ` : ""}Qty {it.qty}{it.size ? ` · ${it.size}` : ""}</div>
                </div>
                <div className="font-semibold">₹{(it.price * it.qty).toLocaleString()}</div>
              </div>
            ))}
          </div>

          {/* Coupon code */}
          <div className="border-t border-[#E5E2DC] mt-4 pt-4" data-testid="coupon-section">
            {couponResult ? (
              <div className="flex items-center justify-between text-sm">
                <span className="text-[#4F7363] font-semibold">{couponResult.code} applied</span>
                <button onClick={() => { setCouponResult(null); setCouponCode(""); }} className="text-xs text-[#E68910] font-semibold">Remove</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  data-testid="coupon-input"
                  value={couponCode}
                  onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && applyCoupon()}
                  placeholder="Coupon code"
                  className="flex-1 px-3 py-2 text-sm rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] uppercase"
                />
                <button onClick={applyCoupon} disabled={couponLoading || !couponCode.trim()} data-testid="apply-coupon-btn"
                  className="px-4 py-2 text-sm font-semibold rounded-xl bg-[#1A2B4C] text-white disabled:opacity-40">
                  {couponLoading ? "…" : "Apply"}
                </button>
              </div>
            )}
            {couponError && <p className="text-xs text-red-500 mt-1" data-testid="coupon-error">{couponError}</p>}
          </div>

          {/* Delivery estimate panel */}
          <div className="border-t border-[#E5E2DC] mt-4 pt-4 space-y-2" data-testid="delivery-estimate">
            <div className="flex justify-between text-sm">
              <span className="text-[#595959]">Subtotal</span>
              <span className="font-semibold">₹{subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm items-center">
              <span className="text-[#595959] inline-flex items-center gap-1.5"><Truck size={13} className="text-[#E68910]" /> Delivery fee</span>
              {estimating ? (
                <span className="text-xs text-[#595959] inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> calculating…</span>
              ) : !cartStoreId && uniqueStoreNames.length > 1 ? (
                <span className="text-emerald-700 font-semibold">FREE</span>
              ) : estimate?.deliverable ? (
                estimate.is_free
                  ? <span className="text-emerald-700 font-semibold" data-testid="delivery-fee">FREE</span>
                  : <span className="font-semibold" data-testid="delivery-fee">₹{estimate.fee.toLocaleString()}</span>
              ) : estimate && !estimate.deliverable ? (
                <span className="text-red-500 text-xs" data-testid="delivery-unavailable">Unavailable</span>
              ) : (
                <span className="text-xs text-[#595959]">—</span>
              )}
            </div>
            {estimate?.deliverable && !estimate.is_free && (
              <p className="text-[10px] text-[#4F7363]">Free delivery on orders above ₹{estimate.free_delivery_threshold ?? 499}</p>
            )}
            {(() => {
              const avail = cartStoreId ? storeAvailMap[cartStoreId] : null;
              const badge = avail?.badge;
              if (badge === "Closed") return (
                <>
                  <div className="flex justify-between text-xs items-center">
                    <span className="text-[#595959] inline-flex items-center gap-1.5"><Clock size={11} /> Estimated arrival</span>
                    <span className="font-semibold text-blue-700" data-testid="delivery-eta">{avail!.opens_at_label ?? "When store opens"}</span>
                  </div>
                  <p className="text-[10px] text-blue-700 font-semibold">This is a scheduled order — processed at store opening</p>
                </>
              );
              if (badge === "Unavailable") return (
                <div className="flex justify-between text-xs items-center">
                  <span className="text-[#595959] inline-flex items-center gap-1.5"><Clock size={11} /> Estimated arrival</span>
                  <span className="font-semibold text-red-500" data-testid="delivery-eta">Unavailable</span>
                </div>
              );
              if (!estimate?.deliverable || estimate.eta_min == null || estimate.eta_max == null) return null;
              const isAway = badge === "Away";
              return (
                <>
                  <div className="flex justify-between text-xs items-center">
                    <span className="text-[#595959] inline-flex items-center gap-1.5"><Clock size={11} /> Estimated arrival</span>
                    <span className="font-semibold" data-testid="delivery-eta">
                      {estimate.eta_min}–{estimate.eta_max} min{isAway ? " · May be delayed" : ""}
                    </span>
                  </div>
                  {isAway && <p className="text-[10px] text-amber-600 font-semibold">One or more stores may take longer to confirm</p>}
                </>
              );
            })()}
            {uniqueStores.length > 1 && Object.keys(storeAvailMap).length > 0 && (
              <div className="text-xs space-y-1 pt-1">
                {uniqueStores.map((sid) => {
                  const info = storeAvailMap[sid];
                  if (!info) return null;
                  return (
                    <div key={sid} className="flex justify-between items-center">
                      <span className="text-[#595959] truncate max-w-[60%]">{info.name}</span>
                      <span className={`font-semibold ${info.rank === 3 ? "text-blue-700" : info.rank >= 4 ? "text-red-500" : "text-emerald-700"}`}>
                        {info.rank === 3 ? (info.opens_at_label || "Scheduled") : info.rank >= 4 ? "Unavailable" : info.eta_message || "~30 min"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {estimate && !estimate.deliverable && estimate.reason && (
              <p className="text-xs text-red-500 mt-1" data-testid="delivery-reason">{estimate.reason}</p>
            )}
          </div>

          {discountAmount > 0 && (
            <div className="flex justify-between text-sm text-[#4F7363] font-semibold mt-2" data-testid="coupon-discount">
              <span>Coupon discount</span>
              <span>−₹{discountAmount.toLocaleString()}</span>
            </div>
          )}
          <div className="border-t border-[#E5E2DC] mt-3 pt-3 flex justify-between font-bold">
            <span>Total</span>
            <span className="text-[#1A2B4C]" data-testid="grand-total">₹{grandTotal.toLocaleString()}</span>
          </div>
          <button onClick={place} disabled={placing || !canPay} data-testid="place-order-btn"
            className="w-full mt-5 px-6 py-3.5 rounded-full bg-[#E68910] text-white font-semibold hover:bg-[#C9770E] disabled:opacity-50 transition inline-flex items-center justify-center gap-2">
            {placing ? <><Loader2 size={14} className="animate-spin" /> Placing…</> : "Place order"}
          </button>
        </div>
      </div>
      <Footer />
    </div>
  );
}
