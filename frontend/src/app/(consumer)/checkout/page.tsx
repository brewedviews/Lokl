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
  Banknote, MapPin, Plus, CheckCircle2, Truck, Loader2, Store, CreditCard,
  Trash2, ShoppingBag, AlertTriangle, Bike, Sparkles, ChevronRight, ChevronDown, ShieldCheck,
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
import { TrendingBestDealsRails } from "@/components/consumer/TrendingBestDealsRails";
import { Button, CTA_LINK_CLASSNAME } from "@/components/ui/Button";
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

function formatClockTime(minutesFromNow: number): string {
  const d = new Date(Date.now() + minutesFromNow * 60_000);
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
}

interface StoreAvailStatus {
  can_order: boolean;
  badge: string;
  eta_message: string;
  opens_at_label?: string | null;
}

// P0-2/P0-3 — the backend's own can_order flag stays `true` for a "Closed"
// (outside operating hours) store, since PDP/add-to-bag are meant to keep
// working right up to checkout (see PdpCtaRow's own comment). Checkout is
// the one place that must NOT let an order through for a store that can't
// currently act on it — pre-order is gone, so "Closed" is treated as
// not-orderable here specifically, without touching the backend flag or
// the browsing experience anywhere else.
function isOrderableNow(s: StoreAvailStatus | undefined): boolean {
  if (!s) return true;
  return s.can_order && s.badge !== "Closed";
}

export default function CheckoutPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const subtotal = useCartStore((s) => s.getTotal());
  const clearCart = useCartStore((s) => s.clearCart);
  const updateQty = useCartStore((s) => s.updateQty);
  const removeItem = useCartStore((s) => s.removeItem);
  const setFulfillmentType = useCartStore((s) => s.setFulfillmentType);
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
  // "Deliver to" starts collapsed to a compact summary whenever there's
  // already a concrete address to summarize (a saved address selected, or
  // a manually-typed one with a line1) — expands on "Change" or when there's
  // nothing to summarize yet (first-time guest, no saved addresses).
  const [addressExpanded, setAddressExpanded] = useState(false);
  const [billOpen, setBillOpen] = useState(true);

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

  // G13 §1 — Standard vs Try & Buy. Eligibility is per-line (`try_at_doorstep`,
  // snapshotted onto the cart item at add-time from the real product flag) —
  // the selector only appears when at least one line is eligible, and only
  // ever toggles eligible lines. This is intent-capture only: no payment
  // hold, rider workflow, trial timer, or return-to-store logic exists
  // downstream yet (see create_order's own comment in server.py).
  const eligibleItems = useMemo(() => items.filter((it) => it.try_at_doorstep), [items]);
  const hasTryAndBuyEligible = eligibleItems.length > 0;
  const allEligible = hasTryAndBuyEligible && eligibleItems.length === items.length;
  const anyTryAndBuySelected = eligibleItems.some((it) => it.fulfillment_type === "try_and_buy");

  // Store-grouped order summary — items from the same store stay adjacent
  // even if they were added to the bag in an interleaved order.
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => (a.store_id || "").localeCompare(b.store_id || "")),
    [items],
  );

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
        setAddressExpanded(false);
      } else {
        // No saved address to summarize yet — the compact "Deliver to" card
        // has nothing to show, so start expanded on the entry form.
        setAddressExpanded(true);
        if (customer?.name) setAddr((a) => ({ ...a, name: customer.name ?? "" }));
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
    if (a) {
      setAddr({
        name: a.name || "", phone: a.phone || phone?.slice(-10) || "",
        line1: a.line1 || "", landmark: a.landmark || "",
        city: a.city || "Bhilai", pincode: a.pincode || "", label: a.label || "Home",
        lat: a.lat ?? null, lng: a.lng ?? null,
      });
      setAddressExpanded(false);
    }
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

  // Silent re-validation — if the cart changes (item removed, qty edited)
  // while a coupon is already applied, re-check it against the new subtotal
  // with the same endpoint so the displayed discount never goes stale.
  // Real backend re-validation at order-creation time is unconditional
  // regardless of this — this is purely so the DISPLAYED total stays honest.
  const couponCodeRef = couponResult?.code;
  useEffect(() => {
    if (!couponCodeRef) return;
    let cancelled = false;
    apiClient.post<{ valid: boolean; discount_amount: number; code: string; description: string }>(
      "/api/coupons/validate", { code: couponCodeRef, subtotal }
    ).then((r) => { if (!cancelled) setCouponResult(r.data); })
      .catch(() => {
        if (cancelled) return;
        setCouponResult(null);
        setCouponError("Your coupon no longer applies to this bag and was removed.");
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal]);

  // "Remove unavailable items" — the one-tap fix for the warning banner
  // below, so the customer isn't left having to hunt for the offending
  // line(s) themselves.
  const removeUnavailableItems = () => {
    items.forEach((it) => {
      const s = it.store_id ? itemStoreStatuses[it.store_id] : undefined;
      if (!isOrderableNow(s)) removeItem(it.id, it.size ?? "");
    });
  };

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
  // Block checkout if any cart store is closed or offline. Deliberately
  // reads itemStoreStatuses (is_open), NOT storeAvailMap.can_order — the
  // backend's GET /api/stores/{id} never sets a `can_order` field, only
  // `is_open`, so storeAvailMap's can_order was always the fallback
  // `undefined !== false` -> true, and the CTA below was never actually
  // disabled by real store unavailability. storeAvailMap is left in place
  // for its other real uses (name/rank/can_pickup/eta_message display).
  // isOrderableNow additionally treats "Closed" (outside operating hours)
  // as not-orderable here — P0-2/P0-3: browsing/add-to-bag stay open for a
  // closed store, but checkout must not let that order through.
  const allStoresCanOrder = uniqueStores.every((sid) => isOrderableNow(itemStoreStatuses[sid]));
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
    // Same source as allStoresCanOrder above — itemStoreStatuses, not the
    // never-populated storeAvailMap.can_order.
    const closedStore = uniqueStores.find((sid) => !isOrderableNow(itemStoreStatuses[sid]));
    if (closedStore) {
      const statusInfo = itemStoreStatuses[closedStore];
      const displayName = storeAvailMap[closedStore]?.name ?? "A store";
      return toast.error(`${displayName} is currently ${(statusInfo?.badge ?? "closed").toLowerCase()}. Please try again later.`);
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
                <h1 className="text-2xl sm:text-3xl font-display font-medium text-[#0A1F5C] leading-tight">Your bag</h1>
                <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">Items you add will appear here.</p>
              </div>
            </div>
          </section>
          <section className="max-w-2xl mx-auto px-4 sm:px-8 pt-6" data-testid="cart-empty">
            <div className="bg-white border border-dashed border-[#E5E2DC] rounded-3xl p-6 sm:p-8 text-center">
              <ShoppingBag size={28} className="text-[#94A3B8] mx-auto mb-2" />
              <div className="text-base sm:text-lg font-display font-medium text-[#0A1F5C]">Your bag is empty</div>
              <p className="text-xs sm:text-sm text-[#64748B] mt-1 max-w-md mx-auto">
                Add items from your nearby Bhilai stores below — or jump straight to discovery.
              </p>
              <Link href="/" data-testid="empty-cart-cta" className={`mt-4 ${CTA_LINK_CLASSNAME}`}>
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
    return status !== undefined && !isOrderableNow(status);
  });

  const ctaLabel = !hasAuth
    ? "Sign in to continue"
    : placing
      ? (payingOnline ? "Waiting for payment…" : "Placing…")
      : payment === "RAZORPAY" ? "Pay online" : "Place order";

  // Simplified to one concrete fact ("delivery by <clock time>") instead of
  // a range as the headline — the min–max range still shows as the
  // subtitle. Uses the same real eta_min/eta_max the estimate API already
  // returns; nothing here is a fabricated ETA.
  const etaTitle = orderType === "pickup"
    ? "Ready for pickup"
    : estimate?.deliverable && estimate.eta_max != null
      ? `Delivery by ${formatClockTime(estimate.eta_max)}`
      : "Estimated delivery";
  const etaSubtitle = orderType === "pickup"
    ? (storeAvailMap[cartStoreId ?? ""]?.name ? `Collect from ${storeAvailMap[cartStoreId ?? ""]?.name}` : "Collect in person")
    : estimate?.deliverable && estimate.eta_min != null && estimate.eta_max != null
      ? `${estimate.eta_min}–${estimate.eta_max} min`
      : (addr.pincode ? `to ${addr.line1 ? addr.line1.split(",")[0] : addr.pincode}` : "Add an address below");

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      {/* Bottom padding clears the sticky total+CTA bar (~85px tall) plus
          safe-area — without it, the last bit of content (the reassurance
          line) sits permanently underneath the fixed bar with no way to
          scroll to it. */}
      <div className="flex-1 max-w-2xl w-full mx-auto px-4 md:px-8 pt-4 space-y-4" style={{ paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}>

        {/* 1. ORDER SUMMARY — what am I buying? Store-grouped (sortedItems),
            no Try & Buy picker inside this card anymore (moved to its own
            step below) — this card is purely "what's in the bag". */}
        <div className="bg-white rounded-2xl border border-[#E5E2DC] p-4" data-testid="bag-items">
          <h2 className="font-display font-medium text-lg text-[#0A1F5C] mb-3">Your bag ({items.length})</h2>

          {uniqueStoreNames.length > 1 && (
            <div data-testid="multi-store-notice" className="mb-3 rounded-xl border border-[#E68910]/30 bg-[#E68910]/10 px-3 py-2 text-[12px] text-[#0A1F5C]">
              Your bag has items from <strong>{uniqueStoreNames.length} stores</strong>. You&apos;ll pay once now and may receive
              <strong> {uniqueStoreNames.length} separate deliveries</strong> — one from each store.
            </div>
          )}
          {anyUnavailable && (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2" data-testid="unavailable-banner">
              <span className="flex items-center gap-1.5 text-xs text-red-600 font-semibold">
                <AlertTriangle size={13} /> Some stores are unavailable
              </span>
              <button
                type="button"
                onClick={removeUnavailableItems}
                data-testid="remove-unavailable-items"
                className="shrink-0 text-xs font-bold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-full transition"
              >
                Remove items
              </button>
            </div>
          )}

          <div className="space-y-3">
            {sortedItems.map((it) => {
              const storeStatus = it.store_id ? itemStoreStatuses[it.store_id] : undefined;
              const itemUnavailable = storeStatus && !isOrderableNow(storeStatus);
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
                    {/* Per-line fulfillment tag — only shown in a mixed-
                        eligibility bag, so it's clear which items follow
                        the Try & Buy selection below and which don't (never
                        silently switched). */}
                    {hasTryAndBuyEligible && !allEligible && (
                      <div className="mt-1">
                        <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full ${it.try_at_doorstep && it.fulfillment_type === "try_and_buy" ? "bg-[#E68910]/10 text-[#E68910]" : "bg-[#E5E2DC] text-[#595959]"}`}>
                          {it.try_at_doorstep && it.fulfillment_type === "try_and_buy" ? "Try & Buy" : "Standard"}
                        </span>
                      </div>
                    )}
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
                    <ProductCard p={p} size="compact" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 2. DELIVERY — where is it going? Delivery-vs-pickup choice (when
            eligible) + a compact "Deliver to" summary with a "Change" link,
            expanding to the full saved-address list / new-address form only
            on demand — the address never repeats anywhere else on the page. */}
        {pickupEligible && (
          <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]" data-testid="fulfillment-picker">
            <h2 className="font-display font-medium text-lg text-[#0A1F5C] mb-2">How would you like to get it?</h2>
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

        {!hasAuth ? (
          <div id="guest-login-gate" className="bg-white rounded-2xl p-4 border border-[#E5E2DC]" data-testid="guest-login-gate">
            <h2 className="font-display font-medium text-lg text-[#0A1F5C] mb-1">Sign in to add your address and pay</h2>
            <p className="text-xs text-[#595959] mb-3">We use your number to deliver, send order updates, and process returns.</p>
            <CustomerOtpLogin />
          </div>
        ) : orderType === "pickup" ? (
          // Pickup needs identity only (name + phone to confirm the
          // reservation) — no delivery address applies. Same `addr` state
          // and fields as before, just without the address-only inputs.
          <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]" data-testid="pickup-details">
            <h2 className="font-display font-medium text-lg text-[#0A1F5C] mb-2">Your details</h2>
            <div className="grid md:grid-cols-2 gap-2.5">
              <input data-testid="addr-name" value={addr.name} onChange={(e) => setAddr({ ...addr, name: e.target.value })} placeholder="Full name" className="px-3.5 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#0A1F5C]" />
              <input data-testid="addr-phone" value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="Phone" className="px-3.5 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#0A1F5C]" />
            </div>
          </div>
        ) : (
          !addressExpanded && addr.line1 ? (
            <button
              type="button"
              onClick={() => setAddressExpanded(true)}
              data-testid="deliver-to-summary"
              className="w-full bg-white rounded-2xl p-4 border border-[#E5E2DC] flex items-start gap-3 text-left hover:border-[#0A1F5C]/40 transition"
            >
              <div className="w-9 h-9 rounded-xl bg-[#0A1F5C]/8 text-[#0A1F5C] grid place-items-center shrink-0">
                <MapPin size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#64748B]">Deliver to</div>
                <div className="text-sm font-semibold text-[#0A1F5C] mt-0.5 truncate">
                  {addr.label || "Home"} · {addr.name}
                </div>
                <div className="text-xs text-[#595959] truncate">{addr.line1}</div>
                <div className="text-[11px] text-[#595959]">{addr.city || "Bhilai"} · {addr.pincode}</div>
              </div>
              <span className="shrink-0 inline-flex items-center gap-0.5 text-xs font-bold text-[#E68910] mt-1">
                Change <ChevronRight size={13} />
              </span>
            </button>
          ) : (
            <>
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
                  <h2 className="font-display font-medium text-lg text-[#0A1F5C] mb-1">New delivery address</h2>
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
                  {savedAddresses.length > 0 && (
                    <button type="button" onClick={() => pickSaved(savedAddresses[0]!.id)} className="mt-3 text-xs font-semibold text-[#595959] underline underline-offset-2">
                      Use a saved address instead
                    </button>
                  )}
                </div>
              )}
            </>
          )
        )}

        {unserviceable && orderType === "delivery" && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl">
            <p className="font-semibold text-red-700 text-sm">Area not serviceable</p>
            <p className="text-red-600 text-xs mt-1">{unserviceableMessage}</p>
          </div>
        )}

        {/* 3. DELIVERY ETA — one simple fact, one small icon, no card
            graphics beyond ETAHeaderCard's own already-compact shell. */}
        <ETAHeaderCard
          icon={orderType === "pickup" ? Store : Bike}
          title={etaTitle}
          subtitle={etaSubtitle}
          loading={estimating}
        />

        {/* 4. TRY & BUY — compact vertical radio-list, only rendered when at
            least one line is try_at_doorstep-eligible. Intent-capture only:
            no trial timer/payment-hold/rider-workflow exists yet, so the
            copy stays generic and never implies an operational trial
            process is already running. */}
        {hasTryAndBuyEligible && (
          <div className="bg-white rounded-2xl border border-[#E5E2DC] overflow-hidden" data-testid="fulfillment-intent-picker">
            <div className="divide-y divide-[#E5E2DC]">
              <button
                type="button"
                data-testid="try-and-buy-select-standard"
                onClick={() => eligibleItems.forEach((it) => setFulfillmentType(it.key, "standard"))}
                className="w-full flex items-center gap-3 p-3.5 text-left"
              >
                <span className={`w-4 h-4 rounded-full border-2 shrink-0 grid place-items-center ${!anyTryAndBuySelected ? "border-[#0A1F5C]" : "border-[#CBD5E1]"}`}>
                  {!anyTryAndBuySelected && <span className="w-2 h-2 rounded-full bg-[#0A1F5C]" />}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-[#0A1F5C]">Standard — Pay normally</div>
                  <p className="text-[11px] text-[#595959] mt-0.5">No trials</p>
                </div>
              </button>
              <button
                type="button"
                data-testid="try-and-buy-select-tryandbuy"
                onClick={() => eligibleItems.forEach((it) => setFulfillmentType(it.key, "try_and_buy"))}
                className="w-full flex items-center gap-3 p-3.5 text-left"
              >
                <span className={`w-4 h-4 rounded-full border-2 shrink-0 grid place-items-center ${anyTryAndBuySelected ? "border-[#E68910]" : "border-[#CBD5E1]"}`}>
                  {anyTryAndBuySelected && <span className="w-2 h-2 rounded-full bg-[#E68910]" />}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-[#0A1F5C]">Try &amp; Buy — Try before you decide</div>
                  <p className="text-[11px] text-[#595959] mt-0.5">Try it on, pay only for what you keep</p>
                </div>
              </button>
            </div>
            {!allEligible && (
              <p className="text-[10px] text-[#94A3B8] px-3.5 pb-3">
                Applies to {eligibleItems.length} of {items.length} item{items.length === 1 ? "" : "s"} in your bag — the rest ship Standard.
              </p>
            )}
          </div>
        )}

        {/* 5. COUPON — before payment and bill, per the redesign brief. */}
        <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]" data-testid="coupon-section">
          <h2 className="font-display font-medium text-lg text-[#0A1F5C] mb-2">Coupon</h2>
          {couponResult ? (
            <div className="flex items-center justify-between text-sm">
              <span>
                <span className="text-[#4F7363] font-semibold">{couponResult.code}</span>
                <span className="text-[#4F7363] ml-1.5">· ₹{couponResult.discount_amount.toLocaleString()} off</span>
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
                placeholder="Apply coupon"
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

        {/* 6. PAYMENT — identity-gated like address; guest browsing (items,
            ETA, Try&Buy, coupon) still needs no auth. */}
        {hasAuth ? (
          <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]" data-testid="payment-section">
            <h2 className="font-display font-medium text-lg text-[#0A1F5C] mb-2">Payment</h2>
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
        ) : (
          <p className="text-xs text-[#94A3B8] text-center">Sign in above to choose a payment method.</p>
        )}

        {/* Store availability context (multi-store per-store status, delivery
            ETA detail, non-deliverable reason) — unchanged logic, kept close
            to the bill it explains. P0-2/P0-3: the old "preorder-notice"
            ("this order will be delivered after the store opens") banner is
            gone — a closed store no longer lets an order through at all
            (see isOrderableNow/allStoresCanOrder above), so there's nothing
            to reassure the customer about here; the red unavailable-items
            banner near the bag already covers it. */}
        {!allStoresCanOrder && (
          <div className="space-y-1">
            {uniqueStores.filter((sid) => !isOrderableNow(itemStoreStatuses[sid])).map((sid) => {
              const info = storeAvailMap[sid];
              const timeStr = info?.opens_at_label ? info.opens_at_label.replace(/^Opens\s+(at\s+)?/i, "") : null;
              return (
                <div key={sid} className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-xl">
                  <span>⚠️</span>
                  <span>{info?.name ?? "A store"} can&apos;t take orders right now{timeStr ? ` · Available from ${timeStr}` : ""}</span>
                </div>
              );
            })}
          </div>
        )}
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

        {/* 7. BILL DETAILS — financial source of truth, collapsible. Every
            figure is derived from the SAME state (subtotal/deliveryFee/
            discountAmount/grandTotal) the payment logic above already
            computes. The old "Platform fee: Nah bro!" / "Handling fee:
            Absolutely Not!" joke rows are gone — those fees are always zero
            today, so they're simply omitted rather than shown as fake rows. */}
        <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]" data-testid="bill-breakdown">
          <button type="button" onClick={() => setBillOpen((v) => !v)} data-testid="bill-details-toggle" className="w-full flex items-center justify-between">
            <h2 className="font-display font-medium text-lg text-[#0A1F5C]">Bill details</h2>
            <ChevronDown size={16} className={`text-[#94A3B8] transition-transform ${billOpen ? "rotate-180" : ""}`} />
          </button>
          {billOpen && (
            <div className="space-y-1.5 text-sm mt-2">
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
            </div>
          )}
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

        {/* One small reassurance line — replaces TrustSignalsCompact's
            4-item list on this page (still used verbatim elsewhere, e.g.
            PDP); here it would outweigh the order it's supposed to support. */}
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-[#94A3B8] py-1">
          <ShieldCheck size={13} className="text-[#94A3B8]" /> Secure payment · Easy returns
        </p>
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
            <p className="font-display font-medium text-xl sm:text-2xl text-[#0A1F5C] truncate" data-testid="sticky-total">₹{grandTotal.toLocaleString()}</p>
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
