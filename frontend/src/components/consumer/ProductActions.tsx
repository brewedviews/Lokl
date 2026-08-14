"use client";

/** Size picker + add-to-bag + buy-now + notify-me + schedule interactions.
 *  Wishlist/share moved to ProductTopActions (rendered near the top of the
 *  page, not here) — this component owns exactly one thing: the purchase
 *  flow. */
import { useState, useEffect } from "react";
import { trackAddToCart, trackPickupStart, trackPickupComplete, trackProductView } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { ShoppingBag, Bell, CheckCircle2, Store, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useCartStore, useCustomerAuthStore } from "@/stores";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { useStoreConflict } from "@/hooks/useStoreConflict";
import { StoreConflictDialog } from "./StoreConflictDialog";
import { DeliveryServiceability } from "./DeliveryServiceability";
import type { Product } from "@/types";

export function ProductActions({
  product,
  storeCanOrder = true,
  storeBadge,
  storeOpensAtLabel,
  storeName,
  storeId,
}: {
  product: Product;
  storeCanOrder?: boolean;
  storeBadge?: string;
  storeOpensAtLabel?: string | null;
  storeName?: string;
  storeId?: string;
}) {
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const customerPhone = useCustomerAuthStore((s) => s.phone);
  const customerUser = useCustomerAuthStore((s) => s.user);
  const isCustomerAuth = useCustomerAuthStore((s) => s.isAuthenticated);
  const [size, setSize] = useState<string | null>(product.sizes?.[0] || null);

  useEffect(() => {
    try {
      trackProductView({
        product_id: product.id,
        product_name: product.name,
        price: product.price,
        mrp: product.mrp ?? undefined,
        category: (product as any).l1_id,
      });
    } catch {}
  }, [product.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyPhone, setNotifyPhone] = useState("");
  const [notifySubmitted, setNotifySubmitted] = useState(false);
  const [notifyLoading, setNotifyLoading] = useState(false);

  const [reserving, setReserving] = useState(false);
  const [reservation, setReservation] = useState<{ orderId: string; pickupCode: string; expiresAt: string } | null>(null);
  const [showPickupSheet, setShowPickupSheet] = useState(false);
  const { conflict, promptConflict, confirmClearAndAdd, dismiss } = useStoreConflict();

  const badge = storeBadge ?? product.store_badge ?? "LIVE";
  const sName = storeName ?? product.store_name ?? "this store";
  const sId = storeId ?? product.store_id ?? "";

  const isOffline = badge === "Store Offline";
  const isClosed = badge === "Closed";
  const isAway = badge === "Away";

  // store_can_pickup is set explicitly by the backend; default false so the button never
  // appears when the field is absent (non-Pro stores, or responses that predate this field).
  const canPickup = ((product as any)?.store_can_pickup ?? false) && !isOffline;

  const toIST = (iso: string): string => {
    try {
      const ms = new Date(iso).getTime() + 5.5 * 3600 * 1000;
      const d = new Date(ms);
      const h = d.getUTCHours() % 12 || 12;
      const m = String(d.getUTCMinutes()).padStart(2, "0");
      return `${h}:${m} ${d.getUTCHours() < 12 ? "AM" : "PM"}`;
    } catch { return ""; }
  };

  // Shared by "Add to bag" and "Buy now" — they need different post-add
  // behavior (toast vs. navigate), so that's passed in as onSuccess. On a
  // store conflict, the warn-and-clear dialog re-runs this same add and
  // fires onSuccess itself once the retry succeeds.
  const handleAdd = (onSuccess: () => void) => {
    if (!storeCanOrder) { toast.error("This store is currently unavailable"); return; }
    if (product.sizes?.length && !size) { toast.error("Please pick a size"); return; }
    const r = addItem(product, size ?? "");
    if (!r.success && r.conflict) {
      promptConflict(r.conflict, () => {
        addItem(product, size ?? "");
        try {
          trackAddToCart({ product_id: product.id, product_name: product.name, price: product.price, size: size ?? "", source: "product_page" });
        } catch {}
        onSuccess();
      });
      return;
    }
    try {
      trackAddToCart({ product_id: product.id, product_name: product.name, price: product.price, size: size ?? "", source: "product_page" });
    } catch {}
    onSuccess();
  };

  const handleNotifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = notifyPhone.replace(/\D/g, "");
    if (digits.length < 10) { toast.error("Enter a valid 10-digit phone number"); return; }
    setNotifyLoading(true);
    try {
      await apiClient.post("/api/notify-me", {
        phone: digits,
        store_id: sId,
        product_id: product.id,
      });
      setNotifySubmitted(true);
    } catch {
      toast.error("Could not save. Please try again.");
    } finally {
      setNotifyLoading(false);
    }
  };

  const handleReservePickup = async () => {
    if (product.sizes?.length && !size) { toast.error("Please pick a size first"); return; }
    setReserving(true);
    try { trackPickupStart(product.id, sId); } catch {}
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("bf_customer_token") : null;
      const r = await apiClient.post<{ id: string; pickup_code: string; pickup_expires_at: string }>(
        "/api/orders",
        {
          items: [{ id: product.id, qty: 1, size: size ?? "", price: product.price, name: product.name, store_id: sId, store_name: sName }],
          address: {},
          total: product.price,
          payment_method: "COD",
          customer: { name: customerUser?.name || "Customer", phone: customerPhone || "" },
          order_type: "pickup",
        },
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
      );
      setReservation({ orderId: r.data.id, pickupCode: r.data.pickup_code, expiresAt: r.data.pickup_expires_at });
      try { trackPickupComplete(product.id, r.data.id, sId); } catch {}
    } catch (e) {
      toast.error(getErrorMessage(e) || "Could not reserve. Please try again.");
    } finally {
      setReserving(false);
    }
  };

  const etaMin = product.store_eta_min || 45;

  // The ONE CTA state machine — rendered twice (fixed sticky bar on mobile,
  // inline in the sticky right column on desktop) but from this single
  // function, so the two can never show different/conflicting states. Never
  // both Add-to-Bag AND Pre-order: isClosed picks exactly one label.
  const renderCtaButtons = (variant: "sticky" | "inline") => {
    const sticky = variant === "sticky";
    const pillBtn = sticky
      ? "flex-1 inline-flex items-center justify-center gap-1.5 py-3.5 text-sm font-bold"
      : "flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full text-sm font-bold transition whitespace-nowrap";

    if (isOffline) {
      return (
        <button
          onClick={() => setNotifyOpen(true)}
          data-testid={sticky ? "sticky-notify-me-btn" : "notify-me-btn"}
          className={sticky ? "w-full inline-flex items-center justify-center gap-1.5 py-3.5 bg-ink-navy text-white text-sm font-bold" : "w-full inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full bg-ink-navy text-white text-sm font-bold whitespace-nowrap"}
        >
          <Bell size={15} /> Notify Me
        </button>
      );
    }
    if (!storeCanOrder) {
      return (
        <div
          data-testid={sticky ? "sticky-store-unavailable" : "store-unavailable-btn"}
          className={sticky ? "w-full text-center py-3.5 bg-[#F4F1E9] text-[#94A3B8] text-sm font-bold" : "w-full text-center py-3 rounded-full bg-[#F4F1E9] text-[#94A3B8] text-sm font-bold"}
        >
          Store Unavailable
        </div>
      );
    }
    return (
      <div className={sticky ? "flex items-stretch w-full" : "flex gap-2 w-full"}>
        <button
          onClick={() => handleAdd(() => router.push("/checkout"))}
          data-testid={sticky ? "sticky-buy-now" : "buy-now"}
          className={`${pillBtn} bg-brand-bg text-ink-navy ${sticky ? "border-r border-ink-navy" : "border border-ink-navy hover:bg-ink-navy/5"}`}
        >
          Buy now
        </button>
        <button
          onClick={() => handleAdd(() => toast.success(isClosed ? "Added to bag — pre-order for when the store opens" : "Added to bag"))}
          data-testid={sticky ? "sticky-add-to-bag" : "add-to-bag"}
          className={`${pillBtn} bg-near-black text-white ${sticky ? "active:scale-[0.98] transition" : "hover:bg-near-black/90"}`}
        >
          <ShoppingBag size={16} /> {isClosed ? "Pre-order" : "Add to bag"}
        </button>
      </div>
    );
  };

  return (
    <>
      {/*
        md:flex md:flex-col lets us reorder the three sections on desktop via md:order-*.
        On mobile (normal block flow) the DOM order already gives the right sequence.

        Both mobile and desktop render order:
          order-1: Size selector  order-2: Action bar (desktop-inline only — mobile uses the fixed sticky bar below instead)  order-3: below-fold trust/logistics + pickup
      */}
      <div className="md:flex md:flex-col">

        {/* ── 1. Size selector ── */}
        {product.sizes && product.sizes.length > 0 && (
          <div className="px-4 md:px-0 mt-4 md:order-1">
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="text-sm font-bold text-ink-navy">SIZE:</h4>
              {/* No "Size Chart" link — no size-chart data exists on the
                  product model yet; omitted rather than a dead link. */}
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {product.sizes.map((s) => (
                <button key={s} onClick={() => setSize(s)} data-testid={`size-${s}`}
                  className={`shrink-0 min-w-[48px] min-h-[48px] px-3 rounded-md text-sm font-semibold border transition whitespace-nowrap ${size === s ? "bg-near-black text-white border-near-black" : "bg-white text-ink-navy border-ink-navy"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── 2. Primary action bar — DESKTOP ONLY, inline in the sticky
             right column. Mobile relies solely on the fixed sticky bar
             below (see the JSX after this closing </div>) — having both
             here AND there was the duplicate-CTA bug this consolidates. */}
        <div className="hidden md:block px-4 md:px-0 mt-4 md:order-2">
          {renderCtaButtons("inline")}
        </div>

        {/* ── 3. Below-fold trust/logistics signals + pickup + banners ── */}
        <div className="md:order-3">

          {/* Delivery + serviceability — pincode-based (not GPS), see
              DeliveryServiceability's own doc comment. THE single delivery/
              opening-time element for the page — it owns both the
              open-store and closed-store ("opens at X") messaging now, so
              there's nowhere else on the page restating it. */}
          <div className="mt-3 px-4 md:px-0">
            <DeliveryServiceability etaMin={etaMin} isClosed={isClosed} opensAtLabel={storeOpensAtLabel} />
          </div>

          {/* Try & Buy — now gated on the real try_at_doorstep flag (was
              unconditional before; the flag existed on the data model and
              on the backend but nothing read it, and merchants had no way
              to set it — see the new checkbox in the merchant product
              form). Made prominent — a proper on-brand callout, not a thin
              inline note — since it's the differentiator, not an aside. */}
          {!isOffline && storeCanOrder && product.try_at_doorstep && (
            <div className="mt-2.5 px-4 md:px-0">
              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-[#E68910]/10 border border-[#E68910]/20" data-testid="try-and-buy-note">
                <div className="w-10 h-10 rounded-full bg-[#E68910]/15 flex items-center justify-center shrink-0">
                  <RotateCcw size={17} className="text-[#E68910]" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[#0A1F5C]">try &amp; buy available</div>
                  <div className="text-xs text-[#595959] mt-0.5 leading-snug">try it on at your door — pay only for what you keep</div>
                </div>
              </div>
            </div>
          )}

          {/* Returnable — return_eligible is fully wired (merchants set it,
              checkout/orders already read it) but was never shown to
              shoppers on the PDP itself. Product-specific (this exact
              product qualifies), distinct from TrustIconsRow's generic
              platform-wide returns claim below it — not a duplicate. */}
          {product.return_eligible && (
            <div className="mt-2.5 px-4 md:px-0">
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#4F7363]/10 text-[#4F7363] text-xs font-bold"
                data-testid="returnable-badge"
              >
                <ShieldCheck size={13} /> easy returns · 24h window
              </span>
            </div>
          )}

          {!isOffline && (canPickup || reservation) && (
            <div className="mt-3 px-4 md:px-0">
              <button
                onClick={() => {
                  if (reservation) { setShowPickupSheet(true); return; }
                  if (!isCustomerAuth) { router.push("/account"); return; }
                  setShowPickupSheet(true);
                }}
                data-testid="reserve-pickup-btn"
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full text-sm font-semibold transition whitespace-nowrap border border-[#0A1F5C]/30 text-[#0A1F5C] hover:bg-[#0A1F5C]/5"
              >
                <Store size={15} />
                {reservation ? "View pickup code" : "Reserve for store pickup"}
              </button>
            </div>
          )}

          {isAway && (
            <div className="mt-3 mx-4 md:mx-0 px-4 py-2 rounded-full bg-[#E68910]/10 border border-[#E68910]/20 text-[#E68910] text-xs font-semibold text-center">
              Store is away · Delivery may take longer
            </div>
          )}

          {isOffline && notifyOpen && (
            <div className="mt-3 mx-4 md:mx-0 p-4 bg-[#F4F1E9] rounded-2xl">
              {notifySubmitted ? (
                <div className="flex items-center gap-2 text-[#4F7363]">
                  <CheckCircle2 size={16} />
                  <p className="text-sm font-semibold">You&apos;ll be notified on WhatsApp!</p>
                </div>
              ) : (
                <>
                  <p className="text-sm font-semibold text-[#0A1F5C] mb-2">Get notified when store is back</p>
                  <form onSubmit={handleNotifySubmit} className="flex gap-2">
                    <input
                      type="tel"
                      value={notifyPhone}
                      onChange={(e) => setNotifyPhone(e.target.value)}
                      placeholder="Your WhatsApp number"
                      className="flex-1 px-3 py-2 rounded-xl border border-[#E5E2DC] text-sm outline-none focus:border-[#0A1F5C]"
                    />
                    <button
                      type="submit"
                      disabled={notifyLoading}
                      className="px-4 py-2 bg-[#0A1F5C] text-white rounded-xl text-sm font-semibold disabled:opacity-50"
                    >
                      {notifyLoading ? "…" : "Notify Me"}
                    </button>
                  </form>
                  <p className="text-xs text-[#595959] mt-2">We&apos;ll WhatsApp you when {sName} is back online</p>
                </>
              )}
            </div>
          )}

          {isOffline && (
            <p className="text-xs text-[#64748B] mt-2 px-4 md:px-0">
              <a href="#similar-products" className="hover:text-[#0A1F5C] transition">See similar products ↓</a>
            </p>
          )}
        </div>

      </div>

      {/* ── Sticky mobile CTA bar — the ONLY CTA on mobile (the inline bar
          above is desktop-only, hidden md:block) — fixed just above
          StickyBottomNav (same offset ActiveOrderPill uses — see its own
          comment — rather than the bottom-nav-safe PADDING utility, which
          is meant for scrollable page content reserving space below
          itself, not for positioning a fixed element's own top/bottom
          edge). Renders from the exact same renderCtaButtons() function as
          the desktop inline bar, so the two can never disagree. */}
      <div
        className="md:hidden fixed inset-x-0 z-40 bg-white border-t border-[#E5E2DC] shadow-[0_-4px_16px_rgba(10,31,92,0.08)] flex items-stretch"
        style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))", paddingBottom: "env(safe-area-inset-bottom)" }}
        data-testid="sticky-add-to-bag-bar"
      >
        {renderCtaButtons("sticky")}
      </div>

      {/* ── Pickup sheet (fixed, always last in DOM) ── */}
      {showPickupSheet && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[55]" onClick={() => setShowPickupSheet(false)} />
          <div
            className="fixed bottom-0 left-0 right-0 z-[60] bg-white rounded-t-3xl shadow-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="flex-shrink-0 flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-[#E5E2DC] rounded-full" />
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 pt-3 pb-2">
              {!reservation ? (
                <>
                  <h3 className="font-display text-xl font-bold text-[#0A1F5C] mb-1">Reserve for pickup</h3>
                  <p className="text-sm text-[#595959] mb-4">at <span className="font-semibold text-[#0A1F5C]">{sName}</span></p>
                  <div className="flex gap-3 p-4 bg-[#FDFBF7] rounded-2xl border border-[#E5E2DC] mb-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[#0A1F5C] text-sm">{product.name}</div>
                      <div className="text-[#595959] text-xs mt-0.5">Qty: 1{size ? ` · Size: ${size}` : ""}</div>
                    </div>
                    <div className="font-bold text-[#0A1F5C]">₹{Number(product.price).toLocaleString()}</div>
                  </div>
                  {product.sizes && product.sizes.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-[#0A1F5C] mb-2">Size</div>
                      <div className="flex flex-wrap gap-2">
                        {product.sizes.map((s) => (
                          <button key={s} onClick={() => setSize(s)}
                            className={`min-w-[48px] min-h-[48px] px-3 rounded-md text-sm font-semibold border transition ${size === s ? "bg-near-black text-white border-near-black" : "bg-white text-ink-navy border-ink-navy"}`}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="bg-[#4F7363]/10 rounded-xl px-4 py-3 text-xs text-[#4F7363] font-medium">
                    Your item is held for up to 4 hours. Pay when you visit the store.
                  </div>
                </>
              ) : (
                <>
                  <div className="text-center mb-5">
                    <div className="w-12 h-12 rounded-full bg-[#4F7363]/15 grid place-items-center mx-auto mb-3">
                      <Store size={22} className="text-[#4F7363]" />
                    </div>
                    <h3 className="font-display text-xl font-bold text-[#0A1F5C]">Reserved!</h3>
                    <p className="text-sm text-[#595959] mt-1">Show this code at <span className="font-semibold">{sName}</span></p>
                  </div>
                  <div className="bg-[#0A1F5C] rounded-2xl p-5 text-center">
                    <div className="text-[10px] uppercase tracking-widest text-white/60 mb-1">Your pickup code</div>
                    <div data-testid="pickup-code-display" className="font-display text-5xl font-bold tracking-[0.3em] tabular-nums text-[#E68910]">{reservation.pickupCode}</div>
                    <p className="text-xs text-white/60 mt-2">
                      {reservation.expiresAt ? `Reserved until ${toIST(reservation.expiresAt)}` : "Holds your item at the store"}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Footer — always visible above nav bar */}
            <div className="flex-shrink-0 px-6 pb-8 pt-3 border-t border-[#E5E2DC]">
              {!reservation ? (
                <>
                  <button
                    onClick={() => void handleReservePickup()}
                    disabled={reserving || !!(product.sizes?.length && !size)}
                    data-testid="confirm-reserve-btn"
                    className="w-full py-3.5 rounded-full bg-[#0A1F5C] text-white font-bold text-sm hover:bg-[#0F1F3D] disabled:opacity-50 transition inline-flex items-center justify-center gap-2 mb-2"
                  >
                    <Store size={15} /> {reserving ? "Reserving…" : "Confirm & Reserve"}
                  </button>
                  <button onClick={() => setShowPickupSheet(false)}
                    className="w-full text-center text-sm text-[#595959] py-2">
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <a href={`/account/orders/${reservation.orderId}`}
                    className="block w-full text-center py-3 rounded-full border border-[#0A1F5C] text-[#0A1F5C] font-semibold text-sm mb-2 hover:bg-[#0A1F5C]/5 transition">
                    View order details
                  </a>
                  <button onClick={() => setShowPickupSheet(false)}
                    className="w-full text-center text-sm text-[#595959] py-2">
                    Close
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      <StoreConflictDialog conflict={conflict} onConfirm={confirmClearAndAdd} onCancel={dismiss} />
    </>
  );
}
