"use client";

/**
 * ProductDetailPanel — everything below the gallery on the PDP: title/
 * price/rating block, qty stepper, size + color selectors, delivery/
 * try-and-buy/returns/pickup signals, and the price+CTA row.
 *
 * Replaces the old split between page.tsx's inline title-block JSX and the
 * separate ProductActions component — the qty stepper (near the title) and
 * the CTA row (at the bottom) both need the same qty/size state, so they
 * need one shared client component, not two components trying to share
 * state across a server-rendered page.tsx boundary.
 *
 * NO sticky/fixed CTA bar — the price+button row is the last thing in this
 * component's normal document flow, and scrolls away like everything else.
 * The PDP's persistent chrome is the global ConsumerHeader (sticky top,
 * same as every other consumer page), not anything pinned to the bottom.
 */
import { useState, useEffect } from "react";
import { trackAddToCart, trackPickupStart, trackPickupComplete, trackProductView } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShoppingBag, Bell, CheckCircle2, Store, RotateCcw, ShieldCheck, Minus, Plus, Check } from "lucide-react";
import { toast } from "sonner";
import { useCartStore, useCustomerAuthStore } from "@/stores";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { useStoreConflict } from "@/hooks/useStoreConflict";
import { StoreConflictDialog } from "./StoreConflictDialog";
import { DeliveryServiceability } from "./DeliveryServiceability";
import type { Product } from "@/types";

const MAX_QTY_FALLBACK = 10;

export function ProductDetailPanel({
  product,
  discount,
  storeCanOrder = true,
  storeBadge,
  storeOpensAtLabel,
  storeName,
  storeId,
}: {
  product: Product;
  discount: number;
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
  const [qty, setQty] = useState(1);

  // Colors — not on the product data model yet (no merchant/admin field
  // exists to set them), so `colors` is always undefined today and this
  // whole selector never renders. Wired ahead of that field landing,
  // same pattern as the gallery's `fit` overlay.
  const colors = (product as any).colors as string[] | undefined;
  const [color, setColor] = useState<string | null>(colors?.[0] ?? null);

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

  // Stock for the selected size — real data when available (per-size stock
  // map), a generic fallback line when it isn't, "Out of stock"/"Only N
  // left" when it's known and low. Never a fabricated exact number.
  const stockForSize = size && product.stock ? product.stock[size] : null;
  const stockLabel = stockForSize == null
    ? "Available in stock"
    : stockForSize <= 0
      ? "Out of stock"
      : stockForSize <= 5
        ? `Only ${stockForSize} left`
        : "In stock";
  const maxQty = stockForSize != null && stockForSize > 0 ? Math.min(stockForSize, MAX_QTY_FALLBACK) : MAX_QTY_FALLBACK;

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
    const r = addItem(product, size ?? "", qty);
    if (!r.success && r.conflict) {
      promptConflict(r.conflict, () => {
        addItem(product, size ?? "", qty);
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
          items: [{ id: product.id, qty, size: size ?? "", price: product.price, name: product.name, store_id: sId, store_name: sName }],
          address: {},
          total: product.price * qty,
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
  const totalPrice = product.price * qty;

  return (
    <>
      {/* ── Store name, badge, title ── */}
      <div className="px-4 pt-4 pb-2 md:px-0 md:pt-0">
        {product.store_id ? (
          <Link href={`/store/${product.store_id}`} data-testid="store-name-link"
            className="text-xs text-[#E68910] font-semibold uppercase tracking-wide hover:underline">
            {product.store_name}
          </Link>
        ) : (
          <span className="text-xs text-[#64748B] uppercase tracking-wide">{product.store_name}</span>
        )}

        {/* "Closed" intentionally renders nothing here — that status (and
            its "opens at X") lives solely in DeliveryServiceability below.
            Away/Offline/other statuses aren't restated anywhere else, so
            they keep their own badge here. */}
        {product.store_badge && product.store_badge !== "LIVE" && product.store_badge !== "Closed" && (
          <div className={`inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
            product.store_badge === "Store Offline" ? "bg-[#F4F1E9] text-[#64748B]" :
            product.store_badge === "Away" ? "bg-[#E68910]/10 text-[#E68910]" : "bg-[#F4F1E9] text-[#595959]"
          }`}>
            {product.store_badge === "Away" ? "Back soon" :
             product.store_badge === "Store Offline" ? "Currently unavailable" :
             (product as any).store_eta_message || product.store_badge}
          </div>
        )}

        {/* Title row + qty stepper — the stepper sits top-right of the
            title block, not down by the CTA, so quantity is chosen before
            you even reach size/color. */}
        <div className="flex items-start justify-between gap-3 mt-2">
          <h1 className="font-display text-xl font-bold text-ink-navy leading-snug">{product.name}</h1>
          <div className="shrink-0 text-right">
            <div className="inline-flex items-center rounded-full border border-ink-navy overflow-hidden" data-testid="qty-stepper">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
                className="w-8 h-8 flex items-center justify-center text-ink-navy disabled:opacity-30"
              >
                <Minus size={13} />
              </button>
              <span className="w-6 text-center text-sm font-bold text-ink-navy" data-testid="qty-value">{qty}</span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                disabled={qty >= maxQty}
                className="w-8 h-8 flex items-center justify-center text-ink-navy disabled:opacity-30"
              >
                <Plus size={13} />
              </button>
            </div>
            <p className="text-[11px] text-slate-gray mt-1" data-testid="stock-status">{stockLabel}</p>
          </div>
        </div>

        <div className="flex items-baseline gap-2 mt-2">
          <span className="text-2xl font-bold text-ink-navy">₹{Number(product.price).toLocaleString("en-IN")}</span>
          {product.mrp && product.mrp > product.price && (
            <>
              <span className="text-xl text-slate-gray line-through">₹{Number(product.mrp).toLocaleString("en-IN")}</span>
              <span className="inline-flex items-center rounded-full bg-moss-green-tint text-moss-green text-xs font-bold px-2 py-0.5">{discount}% off</span>
            </>
          )}
        </div>
        <p className="text-xs text-slate-gray mt-1">(Inclusive of all taxes)</p>

        {(product as any).review_count > 0 && (
          <div className="flex items-center gap-1.5 mt-2">
            <div className="flex items-center gap-1 bg-[#4F7363] text-white text-xs font-bold px-2 py-0.5 rounded-full">
              <span>{product.rating?.toFixed(1)}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
            </div>
            <span className="text-xs text-[#64748B]">{(product as any).review_count} reviews</span>
          </div>
        )}
      </div>

      <div className="h-px bg-[#F5F5F5] mx-4 my-2 md:mx-0" />

      {/* ── Size (circular pills) + Color (dormant) ── */}
      <div className="flex items-start justify-between gap-4 px-4 md:px-0 mt-4 flex-wrap">
        {product.sizes && product.sizes.length > 0 && (
          <div>
            <div className="text-sm font-bold text-ink-navy mb-2.5">SIZE:</div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {product.sizes.map((s) => (
                <button key={s} onClick={() => setSize(s)} data-testid={`size-${s}`}
                  className={`shrink-0 w-12 h-12 rounded-full text-sm font-semibold border transition ${size === s ? "bg-near-black text-white border-near-black" : "bg-white text-ink-navy border-ink-navy"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {colors && colors.length > 0 && (
          <div data-testid="color-selector">
            <div className="text-sm font-bold text-ink-navy mb-2.5">COLOR:</div>
            <div className="inline-flex items-center gap-2 px-2.5 py-2 rounded-full bg-white border border-warm-gray-border">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className="relative w-5 h-5 rounded-full border border-black/10"
                  style={{ backgroundColor: c }}
                >
                  {color === c && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <Check size={11} className="text-white drop-shadow" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Below-fold trust/logistics signals + pickup + banners ── */}
      <div className="mt-4">

        {/* Delivery + serviceability — pincode-based (not GPS), see
            DeliveryServiceability's own doc comment. THE single delivery/
            opening-time element for the page. */}
        <div className="px-4 md:px-0">
          <DeliveryServiceability etaMin={etaMin} isClosed={isClosed} opensAtLabel={storeOpensAtLabel} />
        </div>

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

      {/* ── Price + CTA row — the LAST thing in this component, in normal
          document flow. No position:fixed, no position:sticky — it
          scrolls away like everything else. Price stacked left ("Total
          Price" label + qty-adjusted bold total), CTA button(s) right. ── */}
      <div className="mt-6 px-4 md:px-0 py-4 border-t border-warm-gray-border flex items-center justify-between gap-4" data-testid="price-cta-row">
        <div className="shrink-0">
          <p className="text-xs text-slate-gray">Total Price</p>
          <p className="text-xl font-bold text-ink-navy" data-testid="total-price">₹{totalPrice.toLocaleString("en-IN")}</p>
        </div>

        <div className="flex-1 max-w-[280px]">
          {isOffline ? (
            <button
              onClick={() => setNotifyOpen(true)}
              data-testid="notify-me-btn"
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full bg-ink-navy text-white text-sm font-bold whitespace-nowrap"
            >
              <Bell size={15} /> Notify Me
            </button>
          ) : !storeCanOrder ? (
            <div
              data-testid="store-unavailable-btn"
              className="w-full text-center py-3 rounded-full bg-[#F4F1E9] text-[#94A3B8] text-sm font-bold"
            >
              Store Unavailable
            </div>
          ) : (
            <div className="flex gap-2 w-full">
              <button onClick={() => handleAdd(() => router.push("/checkout"))} data-testid="buy-now"
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full bg-brand-bg border border-ink-navy text-ink-navy text-sm font-bold hover:bg-ink-navy/5 transition whitespace-nowrap">
                Buy now
              </button>
              <button
                onClick={() => handleAdd(() => toast.success(isClosed ? "Added to bag — pre-order for when the store opens" : "Added to bag"))}
                data-testid="add-to-bag"
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full bg-near-black text-white text-sm font-bold hover:bg-near-black/90 transition whitespace-nowrap">
                <ShoppingBag size={16} /> {isClosed ? "Pre-order" : "Add to bag"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Pickup sheet (fixed, only while open — not persistent chrome) ── */}
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
                      <div className="text-[#595959] text-xs mt-0.5">Qty: {qty}{size ? ` · Size: ${size}` : ""}</div>
                    </div>
                    <div className="font-bold text-[#0A1F5C]">₹{totalPrice.toLocaleString()}</div>
                  </div>
                  {product.sizes && product.sizes.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-[#0A1F5C] mb-2">Size</div>
                      <div className="flex flex-wrap gap-2">
                        {product.sizes.map((s) => (
                          <button key={s} onClick={() => setSize(s)}
                            className={`w-12 h-12 rounded-full text-sm font-semibold border transition ${size === s ? "bg-near-black text-white border-near-black" : "bg-white text-ink-navy border-ink-navy"}`}>
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
