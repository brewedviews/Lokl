"use client";

/**
 * Bag/Checkout — single merged screen (Bag icon -> this page -> one Pay
 * action). Was two pages (/cart, /checkout); /cart now redirects here (see
 * middleware.ts). This file's business logic (delivery/pickup toggle,
 * payment method selection, coupon validation, delivery-fee-inclusive
 * totals, address handling, Razorpay wiring) is UNCHANGED from the prior
 * checkout-only version — every hook/handler below this comment block is
 * carried over verbatim. Only the JSX layout changed: item list + qty
 * editing (ported from the old cart page), section order, and a sticky
 * bottom price+CTA bar replace the old two-page flow.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Banknote, MapPin, Plus, CheckCircle2, Truck, Clock, Loader2, Store, CreditCard,
  Trash2, ShoppingBag, AlertTriangle, Bike, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { trackCheckoutStart, trackPurchase } from "@/lib/analytics";
import { getErrorMessage } from "@/lib/api-error";
import { useCartStore, useCustomerAuthStore } from "@/stores";
import { useLocationStore } from "@/stores/location.store";
import { CustomerOtpLogin } from "@/components/consumer/CustomerOtpLogin";
import { ProductCard } from "@/components/consumer/ProductCard";
import { AddressPinPicker } from "@/components/consumer/AddressPinPicker";
import { ETAHeaderCard } from "@/components/consumer/ETAHeaderCard";
import { TrustSignalsCompact } from "@/components/consumer/TrustSignalsCompact";
import { TrendingBestDealsRails } from "@/components/consumer/TrendingBestDealsRails";
import { Button } from "@/components/ui/Button";
import { useRazorpay } from "@/hooks/useRazorpay";
import { isServiceablePincode } from "@/lib/serviceability";
import type { CustomerAddress, ProductCard as ProductCardType } from "@/types";
import Link from "next/link";

interface StoreAvailInfo {
  name: string;
  badge: string;
  rank: number;
  can_order: boolean;
  eta_message: string;
  opens_at_label?: string | null;
  can_pickup: boolean;
}

// Group C2 — lat/lng typed explicitly (not inferred from a `null` literal)
// so the pin picker's onChange can assign real numbers to them.
type CheckoutAddr = {
  name: string; phone: string; line1: string; landmark: string; city: string;
  pincode: string; label: string; lat: number | null; lng: number | null;
};
const BLANK_ADDR: CheckoutAddr = {
  name: "", phone: "", line1: "", landmark: "", city: "Bhilai", pincode: "", label: "Home",
  lat: null, lng: null,
};
// Pilot is Bhilai-only; centroid is good enough until we wire geolocation.
const BHILAI_LAT = 21.1938;
const BHILAI_LNG = 81.3509;
// isServiceablePincode() (lib/serviceability.ts) is the single source of
// truth for "is this pincode serviceable" — used by BOTH the checkout
// serviceability banner and order placement's own gate below, so the two
// can never disagree (previously the banner checked the browser's GPS
// position instead of the delivery address, which falsely flagged valid
// Bhilai addresses as unserviceable whenever the tester's device was
// physically elsewhere), and by the product page's delivery/serviceability
// line, so all three surfaces agree on what's deliverable.

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

interface StoreAvailStatus {
  can_order: boolean;
  badge: string;
  eta_message: string;
  opens_at_label?: string | null;
}

export default function CheckoutPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const subtotal = useCartStore((s) => s.getTotal());
  const clearCart = useCartStore((s) => s.clearCart);
  const updateQty = useCartStore((s) => s.updateQty);
  const removeItem = useCartStore((s) => s.removeItem);
  // Cart items live in localStorage (zustand-persist), restored async after
  // first paint — `items` reads as [] for one frame even on a populated
  // cart. Gate the empty-state on hydration so that frame never renders
  // "Your bag is empty" for a cart that actually has items. (Ported from
  // the old /cart page — same guard, same reasoning.)
  const hasHydrated = useCartStore((s) => s._hasHydrated);
  const phone = useCustomerAuthStore((s) => s.phone);
  const hasAuth = useCustomerAuthStore((s) => s.isAuthenticated);
  const customerLat = useLocationStore((s) => s.lat);
  const customerLng = useLocationStore((s) => s.lng);
  const razorpay = useRazorpay();

  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([]);
  const [selectedId, setSelectedId] = useState("__new__");
  const [addr, setAddr] = useState({ ...BLANK_ADDR, phone: phone?.slice(-10) ?? "" });
  const [payment, setPayment] = useState<"COD" | "RAZORPAY">("COD");
  const [payingOnline, setPayingOnline] = useState(false);
  const [orderType, setOrderType] = useState<"delivery" | "pickup">("delivery");
  const [placing, setPlacing] = useState(false);
  const [estimate, setEstimate] = useState<DeliveryEstimate>(null);
  const [estimating, setEstimating] = useState(false);
  const [storeAvailMap, setStoreAvailMap] = useState<Record<string, StoreAvailInfo>>({});
  const [storeProductsMap, setStoreProductsMap] = useState<Record<string, ProductCardType[]>>({});
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState<{ code: string; discount_amount: number; description: string } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [unserviceable, setUnserviceable] = useState(false);
  const [unserviceableMessage, setUnserviceableMessage] = useState("");
  // Ported from the old /cart page — per-store open/closed status for the
  // item list itself (distinct from storeAvailMap below, which additionally
  // carries can_pickup/rank for the delivery-vs-pickup + preorder logic).
  const [itemStoreStatuses, setItemStoreStatuses] = useState<Record<string, StoreAvailStatus>>({});

  // Serviceability is about the DELIVERY ADDRESS, not the shopper's current
  // GPS position — re-evaluates whenever the selected/entered address's
  // pincode changes (picking a saved address, switching to "new address",
  // or typing one in). Waits for a complete 6-digit pincode so it doesn't
  // flash "not serviceable" mid-keystroke.
  useEffect(() => {
    const pin = addr.pincode.trim();
    if (pin.length !== 6) {
      setUnserviceable(false);
      setUnserviceableMessage("");
      return;
    }
    if (!isServiceablePincode(pin)) {
      setUnserviceable(true);
      setUnserviceableMessage("Sorry, we don't deliver to this pincode yet. We're expanding soon!");
    } else {
      setUnserviceable(false);
      setUnserviceableMessage("");
    }
  }, [addr.pincode]);

  useEffect(() => {
    if (items.length === 0) return;
    try {
      trackCheckoutStart({
        cart_value: subtotal,
        item_count: items.length,
        items: items.map((it) => ({
          product_id: (it as any).id || it.key,
          product_name: it.name,
          price: it.price,
          quantity: it.qty,
        })),
      });
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Single-store rule: every product in the cart must belong to the same
  // store_id for the delivery estimate to be meaningful. Multi-store carts
  // skip the estimate and fall back to FREE delivery (legacy behaviour).
  const uniqueStores = useMemo(() => Array.from(new Set(items.map((it) => it.store_id).filter(Boolean))) as string[], [items]);
  const cartStoreId = uniqueStores.length === 1 ? uniqueStores[0] : null;

  // Ported from the old /cart page — item-list open/closed badges.
  useEffect(() => {
    if (uniqueStores.length === 0) return;
    Promise.all(
      uniqueStores.map((sid) =>
        apiClient.get<{ store: { badge?: string; is_open?: boolean; eta_message?: string; next_open_label?: string } }>(
          `/api/stores/${sid}`
        ).then((r) => {
          const s = r.data.store;
          return [sid, {
            can_order: s.is_open !== false,
            badge: s.badge ?? (s.is_open === false ? "Closed" : "LIVE"),
            eta_message: s.eta_message ?? "",
            opens_at_label: s.next_open_label ?? null,
          }] as [string, StoreAvailStatus];
        }).catch(() => [sid, { can_order: false, badge: "Unavailable", eta_message: "Store unavailable", opens_at_label: null }] as [string, StoreAvailStatus])
      )
    ).then((entries) => setItemStoreStatuses(Object.fromEntries(entries)));
  }, [uniqueStores]);

  // Fetch store availability for all unique stores in the cart. The same
  // response also carries that store's product list — reused below to build
  // the impulse-buy rail so this doesn't cost an extra request.
  useEffect(() => {
    if (uniqueStores.length === 0) return;
    Promise.all(
      uniqueStores.map((sid) =>
        apiClient.get<{
          store: { name?: string; badge?: string; availability_rank?: number; can_order?: boolean; eta_message?: string; next_open_label?: string; can_pickup?: boolean };
          products?: ProductCardType[];
        }>(`/api/stores/${sid}`)
          .then((r) => {
            const s = r.data.store;
            if (r.data.products) {
              setStoreProductsMap((prev) => ({ ...prev, [sid]: r.data.products! }));
            }
            return [sid, {
              name: s.name ?? sid,
              badge: s.badge ?? "LIVE",
              rank: s.availability_rank ?? 1,
              can_order: s.can_order !== false,
              eta_message: s.eta_message ?? "",
              opens_at_label: s.next_open_label ?? null,
              can_pickup: s.can_pickup === true,
            }] as [string, StoreAvailInfo];
          }).catch(() => [sid, { name: sid, badge: "LIVE", rank: 1, can_order: false, eta_message: "", can_pickup: false }] as [string, StoreAvailInfo])
      )
    ).then((entries) => setStoreAvailMap(Object.fromEntries(entries)));
  }, [uniqueStores]);

  // Pickup only makes sense for a single-store bag (the customer physically
  // visits one location), and only when that store is on the Pro plan and
  // currently LIVE/Closed-by-hours (see backend/server.py's accept-pickup
  // pre-check, which rejects anything else with a clear 400) — mirrors
  // GET /api/stores/{id}'s own `can_pickup` field exactly so we never offer
  // an option create_order would just reject.
  const pickupEligible = !!(cartStoreId && storeAvailMap[cartStoreId]?.can_pickup);
  useEffect(() => {
    if (!pickupEligible && orderType === "pickup") setOrderType("delivery");
  }, [pickupEligible, orderType]);

  // One-store-per-bag ⇒ cartStoreId is unambiguous, so the impulse rail
  // never needs cross-store filtering. Exclude anything already in the bag.
  const impulseProducts = useMemo(() => {
    if (!cartStoreId) return [];
    const bagIds = new Set(items.map((it) => it.id));
    return (storeProductsMap[cartStoreId] ?? []).filter((p) => !bagIds.has(p.id)).slice(0, 8);
  }, [cartStoreId, storeProductsMap, items]);

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
          lat: first.lat ?? null,
          lng: first.lng ?? null,
        });
      } else if (customer?.name) {
        setAddr((a) => ({ ...a, name: customer.name ?? "" }));
      }
    }).catch(() => {});
  }, [phone, hasAuth]);

  // Delivery estimate — debounced. Only fires for single-store Bhilai carts,
  // and only for delivery orders — pickup orders never carry a delivery fee
  // (see backend/server.py's create_order, order_type=="pickup" branch), so
  // there's nothing useful for this to estimate.
  useEffect(() => {
    setEstimate(null);
    if (!cartStoreId) return;
    if (orderType === "pickup") return;
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
  }, [cartStoreId, addr.city, subtotal, orderType]);

  const pickSaved = (id: string) => {
    setSelectedId(id);
    if (id === "__new__") { setAddr({ ...BLANK_ADDR, phone: phone?.slice(-10) ?? "" }); return; }
    const a = savedAddresses.find((x) => x.id === id);
    if (a) setAddr({
      name: a.name || "", phone: a.phone || phone?.slice(-10) || "",
      line1: a.line1 || "", landmark: a.landmark || "",
      city: a.city || "Bhilai", pincode: a.pincode || "", label: a.label || "Home",
      lat: a.lat ?? null, lng: a.lng ?? null,
    });
  };

  const deliveryFee = orderType === "pickup" ? 0 : (estimate?.deliverable ? estimate.fee : 0);
  const discountAmount = couponResult?.discount_amount ?? 0;
  const grandTotal = Math.max(0, subtotal + deliveryFee - discountAmount);

  // Display-only derived values for the new MRP -> discount -> subtotal
  // waterfall (item 1g). None of this feeds into what gets submitted to the
  // backend — grandTotal above (unchanged) is still the only number sent.
  // Items added before the `mrp` field existed on CartItem fall back to
  // mrp=price for that line (zero measured markup), never NaN/undefined math.
  const mrpTotal = useMemo(
    () => items.reduce((sum, it) => sum + (it.mrp ?? it.price) * it.qty, 0),
    [items],
  );
  const itemDiscount = Math.max(0, mrpTotal - subtotal);
  const totalSavings = itemDiscount + discountAmount;
  const savingsPct = mrpTotal > 0 ? Math.round((totalSavings / mrpTotal) * 100) : 0;

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
  // Block checkout if any cart store is closed or offline.
  const allStoresCanOrder = uniqueStores.every((sid) => !storeAvailMap[sid] || storeAvailMap[sid].can_order);
  // We allow Pay Now in multi-store carts (no fee added — legacy "FREE"),
  // pickup orders (no delivery estimate is ever fetched for these), OR
  // when the delivery estimate succeeded with deliverable=true. Estimates
  // that 4xx (non-deliverable address) disable the button with a reason.
  const canPay = allStoresCanOrder && items.length > 0 && (
    orderType === "pickup"
    || !cartStoreId  // multi-store carts skip the estimate
    || (estimate ? estimate.deliverable : !estimating)
  );

  const normalizePhone = (p: string) => p.replace(/\D/g, "").replace(/^0+/, "").padStart(12, "91").slice(-12);

  const place = async () => {
    const isPickup = orderType === "pickup";
    // Pickup orders never use the delivery address for fulfillment (the
    // customer walks into the store — see backend/server.py's create_order,
    // which skips the whole city/pincode serviceability gate entirely when
    // order_type=="pickup") — only name+phone are needed to identify the
    // order/notify the customer.
    if (!addr.name || !addr.phone) return toast.error("Please fill your name and phone number");
    if (!isPickup && (!addr.line1 || !addr.pincode)) return toast.error("Please fill name, phone, address and pincode");
    if (!/^[0-9]{10}$/.test(addr.phone)) return toast.error("Enter a valid 10-digit phone number");
    if (!isPickup) {
      if ((addr.city || "").trim().toLowerCase() !== "bhilai") {
        return toast.error("Lokl is only serving Bhilai right now — please update your delivery city.");
      }
      if (!isServiceablePincode(addr.pincode.trim())) {
        return toast.error("We only deliver to Bhilai pincodes (490xxx). Please check your pincode.");
      }
    }
    if (items.length === 0) return toast.error("Bag is empty");
    const customerToken = typeof window !== "undefined" ? localStorage.getItem("bf_customer_token") : null;
    if (!hasAuth || !customerToken) { router.push("/account"); return; }
    if (!isPickup && estimate && !estimate.deliverable) return toast.error(estimate.reason || "Delivery unavailable for this address");
    const closedStore = uniqueStores.find((sid) => storeAvailMap[sid] && !storeAvailMap[sid].can_order);
    if (closedStore) {
      const info = storeAvailMap[closedStore];
      return toast.error(`${info?.name ?? "A store"} is currently ${(info?.badge ?? "closed").toLowerCase()}. Please try again later.`);
    }

    setPlacing(true);

    if (payment === "RAZORPAY") {
      setPayingOnline(true);
      try {
        const rp = await api.payments.createRazorpayOrder({
          amount: grandTotal,
          customer_name: addr.name,
          customer_phone: normalizePhone(addr.phone),
        });
        razorpay.openCheckout({
          key: rp.key_id,
          amount: rp.amount_paise,
          currency: rp.currency,
          order_id: rp.razorpay_order_id,
          name: "Lokl",
          description: `Order for ${items.length} item${items.length === 1 ? "" : "s"}`,
          handler: (response) => {
            // Payment is already captured by Razorpay at this point — the
            // server-side signature check happens inside api.orders.create()
            // (create_order's razorpay branch, verify_payment_signature()).
            // We never mark anything "paid" on the client's say-so alone.
            finalizeOrder(
              {
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
              },
              { paymentAlreadyCaptured: true },
            );
          },
          prefill: { name: addr.name, contact: addr.phone },
          theme: { color: "#0A1F5C" },
          modal: {
            escape: true,
            // User closed/cancelled the Razorpay modal — no payment
            // happened, no order gets created. Re-enable the button so they
            // can retry (COD or online) with a clean state, not a stuck spinner.
            ondismiss: () => {
              setPlacing(false);
              setPayingOnline(false);
            },
          },
        });
      } catch (e) {
        toast.error(getErrorMessage(e));
        setPlacing(false);
        setPayingOnline(false);
      }
      return;
    }

    await finalizeOrder();
  };

  // Shared by both payment paths. `paymentAlreadyCaptured` only changes the
  // failure-toast copy — if api.orders.create() fails AFTER a Razorpay
  // payment already succeeded (e.g. stock ran out in the meantime), the
  // customer needs to know their money isn't just gone: the webhook's own
  // orphan-payment check (backend/server.py's _handle_payment_captured)
  // auto-refunds a captured payment that never got a matching order within
  // its grace window.
  const finalizeOrder = async (
    razorpayExtras: { razorpay_payment_id?: string; razorpay_order_id?: string; razorpay_signature?: string } = {},
    opts: { paymentAlreadyCaptured?: boolean } = {},
  ) => {
    try {
      const orderItems = items.map((it) => ({
        product_id: (it as any).id || it.key,
        product_name: it.name,
        price: it.price,
        quantity: it.qty,
      }));
      const order = await api.orders.create({
        items, address: addr, total: grandTotal, payment_method: payment,
        customer: { name: addr.name, phone: normalizePhone(addr.phone) },
        coupon_code: couponResult?.code ?? undefined,
        customer_lat: customerLat ?? null,
        customer_lng: customerLng ?? null,
        order_type: orderType,
        ...razorpayExtras,
      });
      clearCart();
      try {
        trackPurchase({
          order_id: order.id,
          value: grandTotal,
          delivery_fee: deliveryFee,
          payment_method: payment,
          items: orderItems,
        });
      } catch {}
      toast.success("Order placed!");
      router.push(`/orders/${order.id}`);
    } catch (e) {
      if (opts.paymentAlreadyCaptured) {
        toast.error(`Payment received, but we couldn't finish placing your order (${getErrorMessage(e)}). You'll be refunded automatically within a few minutes.`);
      } else {
        toast.error(getErrorMessage(e));
      }
      setPlacing(false);
      setPayingOnline(false);
    }
  };

  // ===== Hydration gate — ported from the old /cart page verbatim =====
  if (!hasHydrated) {
    return (
      <div className="flex-1 flex flex-col bg-[#FDFBF7]" data-testid="cart-hydrating">
        <main className="flex-1">
          <section className="max-w-2xl mx-auto px-4 sm:px-8 pt-8">
            <div className="h-8 w-40 bg-[#E5E2DC] rounded-lg animate-pulse" />
          </section>
          <section className="max-w-2xl mx-auto px-4 sm:px-8 pt-6 space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex gap-4 p-4 bg-white rounded-2xl border border-[#E5E2DC]">
                <div className="w-24 h-32 rounded-xl bg-[#E5E2DC] animate-pulse shrink-0" />
                <div className="flex-1 py-2 space-y-2">
                  <div className="h-4 w-2/3 bg-[#E5E2DC] rounded animate-pulse" />
                  <div className="h-3 w-1/3 bg-[#E5E2DC] rounded animate-pulse" />
                  <div className="h-3 w-1/4 bg-[#E5E2DC] rounded animate-pulse" />
                </div>
              </div>
            ))}
          </section>
        </main>
      </div>
    );
  }

  // ===== Empty bag — ported from the old /cart page verbatim =====
  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-[#FDFBF7]">
        <main className="flex-1">
          <section className="max-w-2xl mx-auto px-4 sm:px-8 pt-8" data-testid="cart-header">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#E68910]/10 grid place-items-center">
                <ShoppingBag size={20} className="text-[#E68910]" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] leading-tight">Your bag</h1>
                <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">Items you add will appear here.</p>
              </div>
            </div>
          </section>
          <section className="max-w-2xl mx-auto px-4 sm:px-8 pt-6" data-testid="cart-empty">
            <div className="bg-white border border-dashed border-[#E5E2DC] rounded-3xl p-6 sm:p-8 text-center">
              <ShoppingBag size={28} className="text-[#94A3B8] mx-auto mb-2" />
              <div className="text-base sm:text-lg font-display font-bold text-[#0A1F5C]">Your bag is empty</div>
              <p className="text-xs sm:text-sm text-[#64748B] mt-1 max-w-md mx-auto">
                Add items from your nearby Bhilai stores below — or jump straight to discovery.
              </p>
              <Link href="/" data-testid="empty-cart-cta" className="inline-block mt-4 px-6 py-2.5 rounded-full bg-[#0A1F5C] text-white text-sm font-semibold hover:bg-[#0F1D38] transition">
                Start shopping
              </Link>
            </div>
          </section>
          <TrendingBestDealsRails testidPrefix="cart" />
        </main>
      </div>
    );
  }

  // Guest-checkout policy: browsing (items, ETA, delivery/pickup toggle,
  // coupon, bill breakdown) needs no auth at all — every fetch/effect above
  // that touches those already no-ops gracefully without a phone
  // (saved-addresses effect: `if (!hasAuth || !phone) return;`; the
  // delivery-estimate/coupon-validate endpoints are public). Only identity
  // (address + payment) and the actual submit require signing in — see the
  // `hasAuth` branches around the address/payment section and the sticky
  // CTA below. `place()` itself is UNCHANGED and still independently
  // refuses to create an order without a real customer token
  // (`if (!hasAuth || !customerToken) { router.push("/account"); return; }`)
  // — this is a second, real guard, not just a UI nicety the CTA branch
  // happens to route around.
  const promptGuestLogin = () => {
    toast.error("Please sign in to continue");
    document.getElementById("guest-login-gate")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const uniqueStoreNames = Array.from(new Set(items.map((it) => it.store_name).filter(Boolean)));
  const anyUnavailable = items.some((it) => {
    if (!it.store_id) return false;
    const status = itemStoreStatuses[it.store_id];
    return status !== undefined && !status.can_order;
  });

  const ctaLabel = !hasAuth
    ? "Sign in to continue"
    : placing
      ? (payingOnline ? "Waiting for payment…" : "Placing…")
      : payment === "RAZORPAY" ? "Pay online" : "Place order";

  const etaTitle = orderType === "pickup"
    ? "Ready for pickup"
    : estimate?.deliverable && estimate.eta_min != null && estimate.eta_max != null
      ? `Delivery in ${estimate.eta_min}–${estimate.eta_max} min`
      : "Estimated delivery";
  const etaSubtitle = orderType === "pickup"
    ? (storeAvailMap[cartStoreId ?? ""]?.name ? `Collect from ${storeAvailMap[cartStoreId ?? ""]?.name}` : "Collect in person")
    : (addr.pincode ? `to ${addr.line1 ? addr.line1.split(",")[0] : addr.pincode}` : "Add an address below");

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="flex-1 max-w-2xl w-full mx-auto px-4 md:px-8 pt-4 pb-8 space-y-4">
        {/* a. ETA header — bordered card, before any product content */}
        <ETAHeaderCard
          icon={orderType === "pickup" ? Store : Bike}
          title={etaTitle}
          subtitle={etaSubtitle}
          loading={estimating}
        />

        {/* b. Cart items — ported from the old /cart page's row rendering,
            image/name/store/size/qty stepper/remove all unchanged, now with
            strikethrough MRP where the line has one. */}
        <div className="bg-white rounded-2xl border border-[#E5E2DC] p-4" data-testid="bag-items">
          <h2 className="font-display text-lg font-bold text-[#0A1F5C] mb-3">Your bag ({items.length})</h2>

          {uniqueStoreNames.length > 1 && (
            <div data-testid="multi-store-notice" className="mb-3 rounded-xl border border-[#E68910]/30 bg-[#E68910]/10 px-3 py-2 text-[12px] text-[#0A1F5C]">
              Your bag has items from <strong>{uniqueStoreNames.length} stores</strong>. You&apos;ll pay once now and may receive
              <strong> {uniqueStoreNames.length} separate deliveries</strong> — one from each store.
            </div>
          )}
          {anyUnavailable && (
            <div className="mb-3 flex items-center gap-2 text-xs text-red-600 font-semibold">
              <AlertTriangle size={13} /> Some stores are unavailable. Remove those items to continue.
            </div>
          )}

          <div className="space-y-3">
            {items.map((it) => {
              const storeStatus = it.store_id ? itemStoreStatuses[it.store_id] : undefined;
              const itemUnavailable = storeStatus && !storeStatus.can_order;
              const showMrp = it.mrp != null && it.mrp > it.price;
              return (
                <div key={it.key} data-testid={`cart-item-${it.id}`} className={`flex gap-3 p-2 rounded-xl border ${itemUnavailable ? "border-red-200 bg-red-50/30" : "border-transparent"}`}>
                  {it.image ? (
                    <Image src={it.image} alt={it.name} width={80} height={104} className="w-20 h-[104px] object-cover rounded-xl shrink-0" />
                  ) : <div className="w-20 h-[104px] rounded-xl bg-slate-100 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    {it.store_name && <div className="text-[10px] uppercase tracking-wider text-[#595959]">{it.store_name}</div>}
                    <h3 className="font-semibold text-[#0A1F5C] text-sm leading-tight truncate">{it.name}</h3>
                    {it.size && <div className="text-xs text-[#595959] mt-1">Size: {it.size}</div>}
                    {storeStatus?.badge === "Away" && (
                      <div className="text-xs text-amber-600 mt-0.5 font-semibold">May be delayed today</div>
                    )}
                    {storeStatus?.badge === "Closed" && storeStatus.opens_at_label && (
                      <div className="text-xs text-[#64748B] mt-0.5 font-semibold">Available from {storeStatus.opens_at_label.replace(/^Opens\s+(at\s+)?/i, "")}</div>
                    )}
                    {storeStatus?.badge === "Unavailable" && (
                      <div className="text-xs text-red-500 mt-0.5 font-semibold">Store unavailable</div>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateQty(it.id, it.size ?? "", it.qty - 1)} data-testid={`cart-qty-minus-${it.id}`} className="w-6 h-6 rounded-full border border-[#E5E2DC] text-sm">−</button>
                        <span className="font-semibold w-5 text-center text-sm">{it.qty}</span>
                        <button onClick={() => updateQty(it.id, it.size ?? "", it.qty + 1)} data-testid={`cart-qty-plus-${it.id}`} className="w-6 h-6 rounded-full border border-[#E5E2DC] text-sm">+</button>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        {showMrp && <span className="text-xs text-[#94A3B8] line-through">₹{(it.mrp! * it.qty).toLocaleString()}</span>}
                        <span className="font-bold text-[#0A1F5C] text-sm">₹{(it.price * it.qty).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => removeItem(it.id, it.size ?? "")} data-testid={`cart-remove-${it.id}`} className="text-[#595959] hover:text-red-500 self-start"><Trash2 size={15} /></button>
                </div>
              );
            })}
          </div>

          {impulseProducts.length > 0 && (
            <div className="border-t border-[#E5E2DC] mt-3 pt-3" data-testid="checkout-impulse-rail">
              <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-2">
                Add more from {storeAvailMap[cartStoreId ?? ""]?.name ?? items[0]?.store_name ?? "this store"}
              </div>
              <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
                {impulseProducts.map((p) => (
                  <div key={p.id} className="w-[128px] shrink-0" data-testid={`impulse-item-${p.id}`}>
                    {/* No wishlist heart on Bag/Checkout (redesign-plan 3.6) */}
                    <ProductCard p={p} size="compact" showWishlist={false} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {unserviceable && orderType === "delivery" && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl">
            <p className="font-semibold text-red-700 text-sm">Area not serviceable</p>
            <p className="text-red-600 text-xs mt-1">{unserviceableMessage}</p>
          </div>
        )}

        {/* c. Delivery/Pickup selector */}
        {pickupEligible && (
          <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]" data-testid="fulfillment-picker">
            <h2 className="font-display text-lg font-bold text-[#0A1F5C] mb-2">How would you like to get it?</h2>
            <div className="grid grid-cols-2 gap-2.5">
              <button type="button" data-testid="fulfillment-delivery" onClick={() => setOrderType("delivery")}
                className={`text-left p-3 rounded-xl border-2 transition ${orderType === "delivery" ? "border-[#E68910] bg-[#E68910]/5" : "border-[#E5E2DC] hover:border-[#0A1F5C]/40"}`}>
                <div className="flex items-center gap-2 font-semibold text-sm text-[#0A1F5C]"><Truck size={15} /> Delivery</div>
                <p className="text-[11px] text-[#595959] mt-0.5">Brought to your door</p>
              </button>
              <button type="button" data-testid="fulfillment-pickup" onClick={() => setOrderType("pickup")}
                className={`text-left p-3 rounded-xl border-2 transition ${orderType === "pickup" ? "border-[#E68910] bg-[#E68910]/5" : "border-[#E5E2DC] hover:border-[#0A1F5C]/40"}`}>
                <div className="flex items-center gap-2 font-semibold text-sm text-[#0A1F5C]"><Store size={15} /> Store pickup</div>
                <p className="text-[11px] text-[#595959] mt-0.5">No delivery fee — collect in person</p>
              </button>
            </div>
          </div>
        )}

        {/* d. Coupon/offers — own bordered card */}
        <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]" data-testid="coupon-section">
          <h2 className="font-display text-lg font-bold text-[#0A1F5C] mb-2">Coupon</h2>
          {couponResult ? (
            <div className="flex items-center justify-between text-sm">
              <span>
                <span className="text-[#4F7363] font-semibold">{couponResult.code} applied</span>
                <span className="text-[#4F7363] ml-1.5">— you saved ₹{couponResult.discount_amount.toLocaleString()}</span>
              </span>
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
                className="flex-1 px-3 py-2 text-sm rounded-xl border border-[#E5E2DC] outline-none focus:border-[#0A1F5C] uppercase"
              />
              <button onClick={applyCoupon} disabled={couponLoading || !couponCode.trim()} data-testid="apply-coupon-btn"
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-[#0A1F5C] text-white disabled:opacity-40">
                {couponLoading ? "…" : "Apply"}
              </button>
            </div>
          )}
          {couponError && <p className="text-xs text-red-500 mt-1" data-testid="coupon-error">{couponError}</p>}
        </div>

        {/* e. Address + f. Payment — identity-gated. Browsing everything
            above (items, ETA, delivery/pickup, coupon) needs no auth; these
            two sections are where a guest actually needs to be a known
            customer, so this is the one place the soft gate replaces real
            content instead of just disabling a button. */}
        {hasAuth ? (
          <>
        {/* e. Address */}
        {savedAddresses.length > 0 && (
          <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]" data-testid="saved-addresses">
            <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-2">Deliver to</div>
            <div className="space-y-2">
              {savedAddresses.map((a) => (
                <button key={a.id} type="button" data-testid={`pick-addr-${a.id}`} onClick={() => pickSaved(a.id)}
                  className={`w-full text-left p-3 rounded-xl border-2 transition ${selectedId === a.id ? "border-[#0A1F5C] bg-[#0A1F5C]/5" : "border-[#E5E2DC] hover:border-[#0A1F5C]/40"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 text-sm">
                      <div className="font-semibold text-[#0A1F5C] flex items-center gap-2"><MapPin size={13} className="text-[#0A1F5C]" />{a.label || "Home"} · {a.name || phone}</div>
                      <div className="text-[#595959] mt-0.5">{a.line1}</div>
                      {a.landmark && <div className="text-[11px] text-[#595959]">Landmark: {a.landmark}</div>}
                      <div className="text-[11px] text-[#595959]">{a.city || "Bhilai"} · {a.pincode}</div>
                    </div>
                    {selectedId === a.id && <CheckCircle2 size={16} className="text-[#E68910] shrink-0" />}
                  </div>
                </button>
              ))}
              <button type="button" data-testid="pick-new-addr" onClick={() => pickSaved("__new__")}
                className={`w-full text-left p-3 rounded-xl border-2 border-dashed flex items-center gap-2 transition ${selectedId === "__new__" ? "border-[#E68910] bg-[#E68910]/5 text-[#E68910]" : "border-[#E5E2DC] text-[#595959] hover:border-[#0A1F5C]/40"}`}>
                <Plus size={14} /> <span className="text-sm font-semibold">Use a new address</span>
              </button>
            </div>
          </div>
        )}

        {selectedId === "__new__" && (
          <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]">
            <h2 className="font-display text-lg font-bold text-[#0A1F5C] mb-1">New delivery address</h2>
            <p className="text-xs text-[#595959] mb-3">Saved addresses appear in your account for one-tap checkout next time.</p>
            <div className="grid md:grid-cols-2 gap-2.5">
              <input data-testid="addr-name" value={addr.name} onChange={(e) => setAddr({ ...addr, name: e.target.value })} placeholder="Full name" className="px-3.5 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#0A1F5C]" />
              <input data-testid="addr-phone" value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="Phone" className="px-3.5 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#0A1F5C]" />
              <textarea data-testid="addr-line1" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} placeholder="House no, street, locality" rows={2} className="md:col-span-2 px-3.5 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#0A1F5C] resize-none" />
              <input data-testid="addr-landmark" value={addr.landmark} onChange={(e) => setAddr({ ...addr, landmark: e.target.value })} placeholder="Landmark (e.g. opposite SBI / near Globe Chowk)" className="md:col-span-2 px-3.5 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#0A1F5C]" />
              <input data-testid="addr-city" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} placeholder="City (Bhilai only)" className="px-3.5 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#0A1F5C]" />
              <input data-testid="addr-pin" value={addr.pincode} onChange={(e) => setAddr({ ...addr, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="Pincode" className="px-3.5 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#0A1F5C]" />
              <div className="md:col-span-2">
                <AddressPinPicker lat={addr.lat} lng={addr.lng} pincode={addr.pincode} onChange={(lat, lng) => setAddr({ ...addr, lat, lng })} />
              </div>
            </div>
          </div>
        )}

        {/* f. Payment method */}
        <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]">
          <h2 className="font-display text-lg font-bold text-[#0A1F5C] mb-2">Payment</h2>
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" data-testid="pay-online" onClick={() => setPayment("RAZORPAY")}
              className={`flex items-center gap-2.5 py-2.5 px-3 rounded-xl border-2 transition ${payment === "RAZORPAY" ? "border-[#E68910] bg-[#E68910]/5" : "border-[#E5E2DC] hover:border-[#0A1F5C]/40"}`}>
              <CreditCard size={18} className="text-[#0A1F5C]" />
              <span className="font-semibold text-sm">Pay online</span>
            </button>
            <button type="button" data-testid="pay-cod" onClick={() => setPayment("COD")}
              className={`flex items-center gap-2.5 py-2.5 px-3 rounded-xl border-2 transition ${payment === "COD" ? "border-[#E68910] bg-[#E68910]/5" : "border-[#E5E2DC] hover:border-[#0A1F5C]/40"}`}>
              <Banknote size={18} className="text-[#0A1F5C]" />
              <span className="font-semibold text-sm">{orderType === "pickup" ? "Pay at Pickup" : "Pay at Delivery"}</span>
            </button>
          </div>
          {payment === "RAZORPAY" && (
            <p className="text-[11px] text-[#595959] mt-2">UPI, cards and netbanking via Razorpay.</p>
          )}
        </div>
          </>
        ) : (
          <div id="guest-login-gate" className="bg-white rounded-2xl p-4 border border-[#E5E2DC]" data-testid="guest-login-gate">
            <h2 className="font-display text-lg font-bold text-[#0A1F5C] mb-1">Sign in to add your address and pay</h2>
            <p className="text-xs text-[#595959] mb-3">We use your number to deliver, send order updates, and process returns.</p>
            <CustomerOtpLogin />
          </div>
        )}

        {/* Store availability context (multi-store per-store status, preorder
            notice, delivery ETA detail, non-deliverable reason) — unchanged
            logic, kept close to the bill it explains. */}
        {!allStoresCanOrder && (
          <div className="space-y-1">
            {uniqueStores.filter((sid) => storeAvailMap[sid] && !storeAvailMap[sid].can_order).map((sid) => {
              const info = storeAvailMap[sid];
              const timeStr = info?.opens_at_label ? info.opens_at_label.replace(/^Opens\s+(at\s+)?/i, "") : null;
              return (
                <div key={sid} className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-xl">
                  <span>⚠️</span>
                  <span>{info?.name ?? "A store"} is closed{timeStr ? ` · Available from ${timeStr}` : ""}</span>
                </div>
              );
            })}
          </div>
        )}
        {orderType === "delivery" && (() => {
          const avail = cartStoreId ? storeAvailMap[cartStoreId] : null;
          const badge = avail?.badge;
          if (badge === "Closed") {
            const opensSuffix = (avail?.opens_at_label || "Opens soon").replace(/^Opens\s+/i, "");
            return (
              <div className="flex items-start gap-1.5 text-xs bg-blue-50 border border-blue-200 rounded-xl px-3 py-2" data-testid="preorder-notice">
                <Clock size={12} className="text-blue-600 mt-0.5 shrink-0" />
                <span className="text-blue-700 font-medium">
                  This order will be delivered after {avail?.name ?? "the store"} opens {opensSuffix}.
                </span>
              </div>
            );
          }
          return null;
        })()}
        {estimate && !estimate.deliverable && estimate.reason && (
          <p className="text-xs text-red-500" data-testid="delivery-reason">{estimate.reason}</p>
        )}
        {uniqueStores.length > 1 && Object.keys(storeAvailMap).length > 0 && (
          <div className="text-xs space-y-1">
            {uniqueStores.map((sid) => {
              const info = storeAvailMap[sid];
              if (!info) return null;
              return (
                <div key={sid} className="flex justify-between items-center">
                  <span className="text-[#595959] truncate max-w-[60%]">{info.name}</span>
                  <span className={`font-semibold ${info.rank === 3 ? "text-blue-700" : info.rank >= 4 ? "text-red-500" : "text-emerald-700"}`}>
                    {info.rank === 3 ? "Closed" : info.rank >= 4 ? "Unavailable" : info.eta_message || "~45 min"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* g. Bill breakdown: MRP total -> discount -> subtotal -> delivery
            fee -> final total. Every figure here is derived from the SAME
            state (subtotal/deliveryFee/discountAmount/grandTotal) the
            payment logic above already computes — this section only
            changes how it's displayed. */}
        <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]" data-testid="bill-breakdown">
          <h2 className="font-display text-lg font-bold text-[#0A1F5C] mb-2">Bill details</h2>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-[#595959]">MRP total</span>
              <span className="font-semibold">₹{mrpTotal.toLocaleString()}</span>
            </div>
            {itemDiscount > 0 && (
              <div className="flex justify-between" data-testid="item-discount">
                <span className="text-[#595959]">Discount</span>
                <span className="font-semibold text-[#1E5631]">−₹{itemDiscount.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-[#595959]">Subtotal</span>
              <span className="font-semibold">₹{subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[#595959] inline-flex items-center gap-1.5">
                {orderType === "pickup" ? <Store size={13} /> : <Truck size={13} />} Delivery fee
              </span>
              {orderType === "pickup" ? (
                <span className="font-semibold text-[#1E5631]" data-testid="delivery-fee">FREE — pickup</span>
              ) : estimating ? (
                <span className="text-xs text-[#595959] inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> calculating…</span>
              ) : !cartStoreId && uniqueStoreNames.length > 1 ? (
                <span className="font-semibold text-[#1E5631]">FREE</span>
              ) : estimate?.deliverable ? (
                estimate.is_free
                  ? <span className="font-semibold text-[#1E5631]" data-testid="delivery-fee">FREE</span>
                  : <span className="font-semibold" data-testid="delivery-fee">₹{estimate.fee.toLocaleString()}</span>
              ) : estimate && !estimate.deliverable ? (
                <span className="text-red-500 text-xs" data-testid="delivery-unavailable">Unavailable</span>
              ) : (
                <span className="text-xs text-[#595959]">—</span>
              )}
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between" data-testid="coupon-discount">
                <span className="text-[#595959]">Coupon discount</span>
                <span className="font-semibold text-[#1E5631]">−₹{discountAmount.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between text-[11px] text-[#94A3B8]">
              <span>Platform fee</span>
              <span>Nah bro!</span>
            </div>
            <div className="flex justify-between text-[11px] text-[#94A3B8]">
              <span>Handling fee</span>
              <span>Absolutely Not!</span>
            </div>
          </div>
          <div className="border-t border-[#E5E2DC] mt-2.5 pt-2.5 flex justify-between font-bold">
            <span>Total</span>
            <span className="text-[#0A1F5C]" data-testid="grand-total">₹{grandTotal.toLocaleString()}</span>
          </div>
          {totalSavings > 0 && (
            <p className="text-xs text-[#1E5631] font-semibold mt-2" data-testid="savings-line">
              You&apos;re saving ₹{totalSavings.toLocaleString()} ({savingsPct}%) <Sparkles size={12} className="inline -mt-0.5" aria-hidden />
            </p>
          )}
        </div>

        {/* h. Trust icons — the PDP's own compact trust component, reused
            verbatim (redesign-plan 3.4), not a second implementation. */}
        <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]">
          <TrustSignalsCompact />
        </div>
      </div>

      {/* Sticky bottom price + CTA bar. StickyBottomNav is hidden on this
          route (see StickyBottomNav.tsx) specifically so this isn't a
          second competing fixed-chrome bar stacked above it — same
          resolution this codebase already reached once before on the PDP. */}
      <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[#E5E2DC] shadow-[0_-2px_12px_rgba(10,31,92,0.06)]"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <div className="max-w-2xl mx-auto px-4 pt-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-[#64748B]">Total</p>
            <p className="font-display font-bold text-lg text-[#0A1F5C] truncate" data-testid="sticky-total">₹{grandTotal.toLocaleString()}</p>
          </div>
          <Button
            variant="cta"
            size="lg"
            onClick={hasAuth ? place : promptGuestLogin}
            disabled={hasAuth && (placing || !canPay || (orderType === "delivery" && unserviceable))}
            data-testid="place-order-btn"
            className="shrink-0 gap-2"
          >
            {placing && <Loader2 size={14} className="animate-spin" />}
            {ctaLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
