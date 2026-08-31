"use client";

/**
 * ProductDetailPanel — everything below the gallery on the PDP: store
 * info/title/price block, availability status, size + color selectors,
 * one CTA row, and delivery/trust/try-and-buy/returns/pickup signals.
 *
 * Replaces the old split between page.tsx's inline title-block JSX and the
 * separate ProductActions component.
 *
 * NO fixed/sticky bottom chrome on THIS component at all — the page's only
 * persistent chrome is StickyBottomNav (re-enabled on /product/ routes;
 * see its own doc comment for the back-and-forth on that). PdpCtaRow (Buy
 * now / Add to bag) renders ONCE, directly below the size selector, in
 * normal document flow — an earlier version repeated it below the price
 * block too, which user testing called a duplicate CTA; that instance is
 * gone.
 *
 * Add-to-bag adds exactly 1 unit per tap (fashion is purchased per size
 * unit, not variable quantity) — but the button itself becomes a −/qty/+
 * stepper once the item is in the bag, reading live cart state, so
 * quantity IS adjustable right from the PDP now without a separate
 * always-visible control cluttering the page before anything's been added.
 * See PdpCtaRow's own doc comment. Quantity adjustment also still works
 * from the cart page, unaffected by this — same cart, two entry points.
 */
import { useState, useEffect } from "react";
import { trackAddToCart, trackPickupStart, trackPickupComplete, trackProductView } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Store, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useCartStore, useCustomerAuthStore } from "@/stores";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { useStoreConflict } from "@/hooks/useStoreConflict";
import { useServiceability } from "@/hooks/useServiceability";
import { StoreConflictDialog } from "./StoreConflictDialog";
import { DeliveryServiceability } from "./DeliveryServiceability";
import { LocalSocialProof } from "./LocalSocialProof";
import { PdpCtaRow } from "./PdpCtaRow";
import { TrustSignalsCompact } from "./TrustSignalsCompact";
import { Button } from "@/components/ui/Button";
import type { Product } from "@/types";

// Rounded-rectangle size pill — shared base classes for the main size
// selector AND the pickup-reservation sheet's own duplicate size picker,
// so the two can't visually drift apart. Auto-width (min-w, not a fixed
// w-*) so a long label like "Free Size" grows the pill instead of
// overflowing a fixed circle.
const SIZE_PILL_BASE = "min-w-[48px] h-10 px-3.5 rounded-[10px] text-sm font-semibold border transition";

export function ProductDetailPanel({
  product,
  discount,
  storeBadge,
  storeOpensAtLabel,
  storeName,
  storeId,
  storeAreaLabel,
  selectedColorId,
  onColorChange,
}: {
  product: Product;
  discount: number;
  storeBadge?: string;
  storeOpensAtLabel?: string | null;
  storeName?: string;
  storeId?: string;
  /** Store's own registered locality (stores.area_label) — same field
   *  MerchantMicroCard already shows, threaded here too so the store info
   *  row at the top of the page can read "{store} · {area} · ~N min"
   *  instead of just the bare store name. Omitted from the row entirely
   *  when absent, never a fabricated placeholder. */
  storeAreaLabel?: string | null;
  /** Controlled by ProductPageClient (the parent both this panel and the
   *  gallery sit under) so the gallery can switch to the selected color's
   *  images — this panel doesn't own the selection itself. Undefined for
   *  a plain, non-variant product. */
  selectedColorId?: string | null;
  onColorChange?: (id: string) => void;
}) {
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const customerPhone = useCustomerAuthStore((s) => s.phone);
  const customerUser = useCustomerAuthStore((s) => s.user);
  const isCustomerAuth = useCustomerAuthStore((s) => s.isAuthenticated);

  // Color variants (see ColorVariant) — empty/absent for a plain product,
  // in which case every branch below behaves exactly as it did before
  // this feature existed (reading product.sizes/product.stock directly).
  const colorVariants = product.color_variants || [];
  const hasColorVariants = colorVariants.length > 0;
  const selectedVariant = hasColorVariants
    ? colorVariants.find((v) => v.id === selectedColorId) ?? colorVariants[0]
    : null;

  // Sizes available depend on the selected color once variants exist —
  // a size that's fine for Black may not exist for White.
  const availableSizes = hasColorVariants
    ? (selectedVariant?.sizes ?? []).map((s) => s.size)
    : (product.sizes ?? []);

  const [size, setSize] = useState<string | null>(availableSizes[0] || null);

  // Changing color clears a size that isn't available for the new color
  // (never silently keeps an invalid selection) and picks that color's
  // first size as a sensible default otherwise — mirrors how the plain-
  // product size selector already defaults to the first size.
  useEffect(() => {
    if (!hasColorVariants) return;
    const sizesForColor = (selectedVariant?.sizes ?? []).map((s) => s.size);
    setSize((prev) => (prev && sizesForColor.includes(prev) ? prev : sizesForColor[0] || null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedColorId]);

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
  const { hasConfirmedAddress, serviceable } = useServiceability();

  const badge = storeBadge ?? product.store_badge ?? "LIVE";
  const sName = storeName ?? product.store_name ?? "this store";
  const sId = storeId ?? product.store_id ?? "";

  const isOffline = badge === "Store Offline";
  const isClosed = badge === "Closed";
  const isAway = badge === "Away";

  // Stock for the selected size — real data when available (the selected
  // color's own per-size stock for a variant product, the flat per-size
  // stock map otherwise), a generic fallback line when it isn't, "Out of
  // stock"/"Only N left" when it's known and low. Never a fabricated
  // exact number.
  const stockForSize = hasColorVariants
    ? (size ? (selectedVariant?.sizes ?? []).find((s) => s.size === size)?.stock ?? null : null)
    : (size && product.stock ? product.stock[size] : null);
  const stockLabel = stockForSize == null
    ? "Available in stock"
    : stockForSize <= 0
      ? "Out of stock"
      : stockForSize <= 5
        ? `Only ${stockForSize} left`
        : "In stock";

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
    // Availability SOP — Add to bag/Buy now are never blocked by store
    // state (see PdpCtaRow's own comment); checkout is the sole gate.
    if (hasColorVariants && !selectedVariant) { toast.error("Please pick a color"); return; }
    if (availableSizes.length > 0 && !size) { toast.error("Please pick a size"); return; }
    const colorArg = hasColorVariants && selectedVariant
      ? { id: selectedVariant.id, name: selectedVariant.name, image: selectedVariant.images?.[0]?.url }
      : undefined;
    const r = addItem(product, size ?? "", 1, colorArg);
    if (!r.success && r.conflict) {
      promptConflict(r.conflict, () => {
        addItem(product, size ?? "", 1, colorArg);
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
    if (hasColorVariants && !selectedVariant) { toast.error("Please pick a color first"); return; }
    if (availableSizes.length > 0 && !size) { toast.error("Please pick a size first"); return; }
    setReserving(true);
    try { trackPickupStart(product.id, sId); } catch {}
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("bf_customer_token") : null;
      const r = await apiClient.post<{ id: string; pickup_code: string; pickup_expires_at: string }>(
        "/api/orders",
        {
          items: [{
            id: product.id, qty: 1, size: size ?? "", price: product.price, name: product.name, store_id: sId, store_name: sName,
            ...(hasColorVariants && selectedVariant ? { color_variant_id: selectedVariant.id, color_name: selectedVariant.name } : {}),
          }],
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
  // G11 §12 — ETA now shows as store metadata inline in the store-info
  // row, not a standalone card (see DeliveryServiceability's own comment
  // for what moved and why). Same happy-path condition that component
  // used internally: not offline, not closed, and not a confirmed-
  // unserviceable address — never fabricated, `etaMin` is real store data
  // with only its numeric fallback (45) staying honest-default the same
  // way it already was before this change.
  const showInlineEta = !isOffline && !isClosed && !(hasConfirmedAddress && !serviceable);

  // Handlers passed to both PdpCtaRow instances — identical behavior either
  // time, only the surrounding position in the page differs.
  const handleBuyNow = () => handleAdd(() => router.push("/checkout"));
  const handleAddToBag = () => handleAdd(() => toast.success("Added to bag"));
  const handleNotify = () => setNotifyOpen(true);

  return (
    <>
      {/* ── Store info row: name + area + ETA, title, price, availability ── */}
      <div className="px-4 pt-4 pb-2 md:px-0 md:pt-0">
        {/* Store identity row — name, then locality, then ETA. G11 §12: ETA
            is metadata belonging to this row, not a separate product
            selling point — moved back here from the standalone
            DeliveryServiceability card (redesign-plan 3.7 had moved it out
            specifically to avoid two ETA surfaces; that card's happy path
            now renders nothing at all, see its own doc comment, so there's
            still only one place ETA shows on the happy path — just here
            instead). `etaMin` is real store data (product.store_eta_min,
            45 only as an honest fallback, never fabricated) and only shows
            when genuinely applicable (not offline/closed/unserviceable).
            Area is omitted entirely (not a placeholder) when the store
            predates that field. */}
        <div className="flex items-center flex-wrap gap-x-1.5" data-testid="store-info-row">
          {product.store_id ? (
            <Link href={`/store/${product.store_id}`} data-testid="store-name-link"
              className="text-[11px] text-brand-accent font-medium uppercase tracking-[0.02em] hover:underline">
              {product.store_name || "Lokl Store"}
            </Link>
          ) : (
            <span className="text-[11px] text-slate-gray font-medium uppercase tracking-[0.02em]">{product.store_name || "Lokl Store"}</span>
          )}
          {storeAreaLabel && (
            <span className="text-[11px] text-slate-gray">· {storeAreaLabel}</span>
          )}
          {showInlineEta && (
            <span className="text-[11px] text-slate-gray" data-testid="pdp-inline-eta">· {etaMin} min delivery</span>
          )}
        </div>

        {/* Brand line (Phase 1) — visually secondary to the store-info row
            above (plain slate-gray, no accent color, smaller emphasis than
            the store name link) since store identity is still primary on
            this page. Only rendered when brand_id resolved server-side to
            a real, still-existing brand — never a blank/broken state for
            untagged products. */}
        {product.brand && (
          <Link href={`/brand/${product.brand.slug}`} data-testid="pdp-brand-link"
            className="flex items-center gap-1.5 mt-1 group w-fit">
            {product.brand.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.brand.logo} alt="" className="w-4 h-4 rounded-full object-cover" />
            )}
            <span className="text-[11px] text-slate-gray group-hover:text-ink-navy group-hover:underline">
              by {product.brand.name}
            </span>
          </Link>
        )}

        {/* Title alone — no adjacent action cluster; wishlist lives in the
            header + the icon row below the gallery instead (see
            ProductGallery / ConsumerHeader). */}
        <h1 className="font-display text-[20px] font-medium text-ink-navy leading-snug mt-2">{product.name}</h1>

        {/* ── Price — the ONE price display on the page (current / struck
            MRP / %-off pill). ── */}
        <div className="flex items-baseline gap-2 mt-2">
          <span className="text-[20px] font-bold text-ink-navy">₹{Number(product.price).toLocaleString("en-IN")}</span>
          {product.mrp && product.mrp > product.price && (
            <>
              <span className="text-[13px] text-slate-gray line-through">₹{Number(product.mrp).toLocaleString("en-IN")}</span>
              <span className="inline-flex items-center rounded-full bg-moss-green-tint text-moss-green text-[11px] font-bold px-2 py-0.5">{discount}% off</span>
            </>
          )}
        </div>
        <p className="text-xs text-slate-gray mt-1">(Inclusive of all taxes) · <span data-testid="stock-status">{stockLabel}</span></p>

        {(product as any).review_count > 0 && (
          <div className="flex items-center gap-1.5 mt-2">
            <div className="flex items-center gap-1 bg-[#4F7363] text-white text-xs font-bold px-2 py-0.5 rounded-full">
              <span>{product.rating?.toFixed(1)}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
            </div>
            <span className="text-[12px] text-slate-gray">{(product as any).review_count} reviews</span>
          </div>
        )}

        {/* Availability SOP — Store-Offline callout. Add to bag/Buy now
            stay fully active below (see PdpCtaRow) — this exists purely
            to explain WHY checkout won't complete right now, positioned
            between price and Size so it reads as availability status
            rather than metadata stuck to the brand name. Amber/orange-
            tinted (the same bg-[#E68910]/10 border-[#E68910]/20 treatment
            already used for the "Away" and try-and-buy callouts elsewhere
            in this file), not gray — gray read as inert metadata. Away/
            Closed each already have their own existing callout elsewhere
            on the page (isAway below, DeliveryServiceability's "Opens X"),
            so this is Store-Offline only, not a generic multi-status
            pill. */}
        {isOffline && (
          <div
            className="mt-3 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#E68910]/10 border border-[#E68910]/20"
            data-testid="store-unavailable-callout"
          >
            <AlertCircle size={16} className="text-[#E68910] shrink-0" />
            <p className="text-xs text-[#E68910] font-semibold">Temporarily unavailable — you can still add this to your bag; checkout will open once the store is back.</p>
          </div>
        )}
      </div>

      <div className="h-px bg-[#F5F5F5] mx-4 my-1.5 md:mx-0" />

      {/* ── Color (before Size, per PDP spec) + Size (rounded-rectangle
          pills, not circles). Rectangles are auto-width from their own
          padding, so a long label like "Free Size" grows the pill instead
          of fighting a fixed-width circle for room. Same shape reused in
          the pickup-sheet's own size picker below, kept in sync via
          SIZE_PILL_BASE.

          Color pills carry NAME + an optional swatch dot, never a bare
          circle — "Olive"/"Dusty Rose"/"Wine" need a label a color patch
          alone can't convey. ── */}
      <div className="px-4 md:px-0 mt-2.5">
        {hasColorVariants && (
          <div className="mb-3.5" data-testid="color-selector">
            <div className="text-[12px] font-medium text-ink-navy mb-1.5">
              Color{selectedVariant ? <span className="text-slate-gray font-normal">: {selectedVariant.name}</span> : null}
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {colorVariants.map((v) => {
                const active = selectedVariant?.id === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onColorChange?.(v.id)}
                    data-testid={`color-${v.id}`}
                    aria-pressed={active}
                    className={`shrink-0 inline-flex items-center gap-1.5 ${SIZE_PILL_BASE} ${active ? "bg-brand-accent text-white border-brand-accent" : "bg-white text-ink-navy border-ink-navy"}`}
                  >
                    {v.hex && (
                      <span
                        className={`w-3 h-3 rounded-full border ${active ? "border-white/60" : "border-black/15"} shrink-0`}
                        style={{ backgroundColor: v.hex }}
                        aria-hidden="true"
                      />
                    )}
                    {v.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-4 px-4 md:px-0 flex-wrap">
        {availableSizes.length > 0 && (
          <div>
            <div className="text-[12px] font-medium text-ink-navy mb-1.5">Size</div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {availableSizes.map((s) => (
                <button key={s} onClick={() => setSize(s)} data-testid={`size-${s}`}
                  className={`shrink-0 ${SIZE_PILL_BASE} ${size === s ? "bg-brand-accent text-white border-brand-accent" : "bg-white text-ink-navy border-ink-navy"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {product.fit_note && (
          <p className="text-[11px] italic text-slate-gray w-full px-4 md:px-0 mt-1.5" data-testid="fit-note">
            {product.fit_note}
          </p>
        )}

        {/* The only CTA row on the page — directly below the size
            selector. An earlier version also had one directly below the
            price block; user testing called that a duplicate and it's
            gone now.

            No px-4 here — this div already lives inside the outer
            `flex ... px-4 md:px-0` wrapper above, which pads Size/title/
            price too. Adding a second px-4 on this div nested inside that
            already-padded one double-applied the padding, so the row sat
            ~16px further right than everything above it. w-full + mt-3
            only; left edge now lines up exactly with Size/title/price. */}
        <div className="w-full mt-3">
          <PdpCtaRow
            isOffline={isOffline}
            productId={product.id}
            size={size ?? ""}
            colorVariantId={selectedVariant?.id}
            product={product}
            onNotify={handleNotify}
            onBuyNow={handleBuyNow}
            onAddToBag={handleAddToBag}
          />
        </div>
      </div>

      {/* ── Below-fold trust/logistics signals + pickup + banners ── */}
      <div className="mt-4">

        {/* Serviceability — pincode-based (not GPS), see
            DeliveryServiceability's own doc comment. Happy-path ETA moved
            to the store-info row above (G11 §12); this now only ever
            renders the closed-store "Opens X" message or the
            unserviceable-pincode alert — nothing on the happy path. */}
        <div className="px-4 md:px-0">
          <DeliveryServiceability isClosed={isClosed} isOffline={isOffline} opensAtLabel={storeOpensAtLabel} />
        </div>

        {/* All four trust signals, one consistent list style (see
            TrustSignalsCompact's own doc comment) — used to be split
            across two different visual treatments; unified into one block
            near delivery/store info. */}
        <div className="mt-2.5 px-4 md:px-0">
          <TrustSignalsCompact />
        </div>

        {/* Hyperlocal social proof — renders nothing below the 5-order
            threshold or when the shopper's area can't be resolved; see
            LocalSocialProof's own doc comment. */}
        <div className="mt-2.5 px-4 md:px-0">
          <LocalSocialProof productId={product.id} />
        </div>

        {!isOffline && product.try_at_doorstep && (
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
                      {(selectedVariant || size) && (
                        <div className="text-[#595959] text-xs mt-0.5">
                          {[selectedVariant?.name, size ? `Size: ${size}` : null].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </div>
                    <div className="font-bold text-[#0A1F5C]">₹{product.price.toLocaleString()}</div>
                  </div>
                  {availableSizes.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-[#0A1F5C] mb-2">Size</div>
                      <div className="flex flex-wrap gap-2">
                        {availableSizes.map((s) => (
                          <button key={s} onClick={() => setSize(s)}
                            className={`${SIZE_PILL_BASE} ${size === s ? "bg-brand-accent text-white border-brand-accent" : "bg-white text-ink-navy border-ink-navy"}`}>
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
                  {/* Full-width is a deliberate exception to the cta variant's
                      usual "not full-width" rule — this is a bottom-sheet
                      footer action, where a content-width button would float
                      oddly in a wide sheet. Color/radius follow the shared
                      cta variant as normal; only width is overridden. */}
                  <Button
                    variant="cta"
                    onClick={() => void handleReservePickup()}
                    disabled={reserving || (availableSizes.length > 0 && !size) || (hasColorVariants && !selectedVariant)}
                    data-testid="confirm-reserve-btn"
                    className="w-full text-sm gap-2 mb-2"
                  >
                    <Store size={15} /> {reserving ? "Reserving…" : "Confirm & Reserve"}
                  </Button>
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
