"use client";

/**
 * ConsumerHeader — sticky glass header.
 *
 * Mobile (<lg): ONE row — Logo · LocationChip (flex-1) · Wishlist.
 *   Redesign Phase B removed the persistent pinned search bar that used to
 *   sit in a second row here. G9 §16 finished that line of work: search's
 *   entry point is the bottom nav's Search tab (StickyBottomNav.tsx),
 *   which is now a plain `<Link href="/search">` — the mobile overlay
 *   sheet this header used to open via `useSearchOverlay` (recent/
 *   trending/live-suggestion UI) has been removed from here entirely; its
 *   logic was ported into `/search/page.tsx` itself, which now owns that
 *   whole experience as a real page instead of a header-anchored overlay.
 * Desktop (≥lg): single row — Logo · LocationChip · big Search · Stores
 *   · For Merchants · Profile · Wishlist. Untouched otherwise — desktop
 *   has no bottom nav, so its inline Search input + SuggestPanel dropdown
 *   stay exactly where they were.
 *
 * LocationChip handles its own auto-detect on mount and its own popover —
 * see the LocationChip component below.
 *
 * Phase G5 removed the header's cart button (moved to StickyBottomNav's
 * own Cart tab) and used the reclaimed space for a persistent ETA badge
 * + a rotating promo ticker. This visual-refinement pass removes BOTH of
 * those from the header in turn — not the underlying systems: ETAHeaderCard
 * itself is untouched and still renders on the hero (HeroCarousel.tsx),
 * PDP (DeliveryServiceability.tsx), and Checkout; GET /api/feed/delivery-
 * status is untouched. HeaderPromoTicker.tsx is deleted outright — it had
 * exactly one caller (this file) and no other reason to exist once removed
 * here, so keeping the file around unused would just be dead code. The
 * reclaimed space now holds a Wishlist link, reusing the existing
 * useWishlistStore (already used by ProductCard's per-card heart and the
 * standalone /wishlist page) rather than a new system — see WishlistLink
 * below for the hydration-safe read pattern, copied from ProductCard's
 * own established approach to the same store.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Search, Store as StoreIcon, User, Heart, X, Crosshair, Home as HomeIcon, Check } from "lucide-react";
import {
  useLocationStore, useCustomerAuthStore, useWishlistStore,
} from "@/stores";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { useMounted } from "@/hooks/useMounted";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";

interface SearchProduct { id: string; name: string; price?: number; image?: string }
interface SearchStore { id: string; name: string; locality?: string; banner?: string }
interface SuggestResponse { products: SearchProduct[]; stores: SearchStore[] }

interface SavedAddress {
  address_id: string;
  label?: string;
  line1?: string;
  full_address?: string;
  city_name?: string;
  is_default?: boolean;
  location?: { coordinates?: [number, number] };
}

export function ConsumerHeader() {
  const router = useRouter();
  const customerPhone = useCustomerAuthStore((s) => s.phone);
  useHeartbeat(customerPhone ? "customer" : "guest", { phone: customerPhone });

  // ─── Desktop search ─────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestResponse | null>(null);
  const [suggLoading, setSuggLoading] = useState(false);
  const [suggOpen, setSuggOpen] = useState(false);
  const desktopSearchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setSuggestions(null); setSuggLoading(false); return; }
    let cancelled = false;
    setSuggLoading(true);
    const t = setTimeout(() => {
      api.search.suggest(term)
        .then((r) => { if (!cancelled) setSuggestions(r as unknown as SuggestResponse); })
        .catch(() => { if (!cancelled) setSuggestions({ products: [], stores: [] }); })
        .finally(() => { if (!cancelled) setSuggLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const submitSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setSuggOpen(false);
    api.search.track(term).catch(() => { /* fire-and-forget */ });
    router.push(`/search?q=${encodeURIComponent(term)}`);
  };

  useEffect(() => {
    if (!suggOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!desktopSearchRef.current?.contains(e.target as Node)) setSuggOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSuggOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [suggOpen]);

  return (
    <>
    <header data-testid="consumer-header" className="sticky top-0 z-50 bf-glass border-b border-card-border">
      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-2.5 lg:py-3 flex items-center gap-2 lg:gap-4">
        {/* Logo */}
        <Link href="/" data-testid="brand-logo" className="flex items-center shrink-0">
          <span className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-brand-primary">
            lokl<span className="text-brand-accent">.</span>
          </span>
        </Link>

        {/* Location chip — flex-1 on mobile, fixed 200px on desktop. Back
            to its pre-Phase-G5 sizing now that neither the ticker nor the
            ETA badge compete with it for row width. */}
        <div className="flex-1 lg:flex-none lg:w-[200px] min-w-0">
          <LocationChip phone={customerPhone} />
        </div>

        {/* Desktop search — flex-1 to expand into ALL remaining space, with
            healthy gap-4 around it for breathing room next to the nav icons. */}
        <div ref={desktopSearchRef} className="hidden lg:flex flex-1 relative min-w-0">
          <SearchInput
            q={q}
            onChange={(v) => { setQ(v); setSuggOpen(true); }}
            onSubmit={() => submitSearch()}
            onFocus={() => setSuggOpen(true)}
          />
          {suggOpen && q.trim().length >= 2 && (
            <SuggestPanel
              loading={suggLoading}
              data={suggestions}
              q={q}
              onPick={() => setSuggOpen(false)}
            />
          )}
        </div>

        <Link
          href="/products"
          data-testid="nav-products"
          className="hidden lg:flex items-center gap-1.5 text-sm font-medium hover:text-brand-accent transition shrink-0"
        >
          Products
        </Link>
        <Link
          href="/stores"
          data-testid="nav-stores"
          className="hidden lg:flex items-center gap-1.5 text-sm font-medium hover:text-brand-accent transition shrink-0"
        >
          <StoreIcon size={16} /> Stores
        </Link>
        <Link
          href="/merchant/login"
          data-testid="nav-merchant"
          className="hidden lg:inline text-sm font-medium hover:text-brand-accent transition shrink-0"
        >
          For Merchants
        </Link>
        <Link
          href="/account"
          data-testid="nav-account"
          aria-label="Account"
          className="hidden lg:flex w-9 h-9 rounded-full bg-white border border-card-border items-center justify-center hover:border-brand-primary transition shrink-0"
        >
          <User size={16} />
        </Link>
        {/* Wishlist — reclaimed from the header ETA badge/ticker this pass
            removes. Same slot the header's old cart button, then the ETA
            badge, occupied — the one persistent icon at the end of the
            row on every breakpoint. */}
        <WishlistLink />
      </div>
    </header>
    </>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────

// WishlistLink — reuses useWishlistStore verbatim (the same store
// ProductCard's per-card heart and the standalone /wishlist page already
// read/write; no second wishlist system). Count read the same
// hydration-safe way ProductCard already established for this exact
// store: the store's own initializer reads localStorage SYNCHRONOUSLY on
// the client (unlike the zustand/persist-backed cart store, which only
// rehydrates post-mount), so a naive direct read would mismatch the
// server's always-empty SSR render. Starting local state at 0 and syncing
// it via useEffect (which never runs during SSR) keeps the first client
// render identical to the server's, then flips to the real count right
// after — same shape as ProductCard's own `wished` state.
function WishlistLink() {
  const liveCount = useWishlistStore((s) => s.products.length);
  const [count, setCount] = useState(0);
  useEffect(() => { setCount(liveCount); }, [liveCount]);

  return (
    <Link
      href="/wishlist"
      data-testid="nav-wishlist"
      aria-label="Wishlist"
      className="relative flex items-center justify-center w-9 h-9 rounded-full bg-white border border-card-border hover:border-brand-primary transition shrink-0"
    >
      <Heart size={16} />
      {count > 0 && (
        <span
          data-testid="wishlist-badge"
          className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-brand-accent text-white text-[9px] font-bold leading-4 text-center"
        >
          {count}
        </span>
      )}
    </Link>
  );
}

function SearchInput({
  q, onChange, onSubmit, onFocus,
}: {
  q: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onFocus: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-white border border-card-border rounded-full focus-within:border-brand-primary transition w-full">
      <Search size={16} className="text-text-secondary shrink-0" />
      <input
        data-testid="search-input"
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmit(); } }}
        placeholder="Search kurtas, sneakers, stores nearby…"
        className="bg-transparent flex-1 outline-none text-sm min-w-0"
        autoComplete="off"
      />
      {q && (
        <button
          type="button"
          onClick={() => onChange("")}
          data-testid="search-clear"
          aria-label="Clear search"
          className="text-text-secondary hover:text-brand-primary transition shrink-0"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function SuggestPanel({
  loading, data, q, onPick,
}: {
  loading: boolean;
  data: SuggestResponse | null;
  q: string;
  onPick: () => void;
}) {
  const products = data?.products ?? [];
  const stores = data?.stores ?? [];
  const empty = !loading && products.length === 0 && stores.length === 0;
  return (
    <div
      data-testid="search-suggestions"
      role="listbox"
      className="absolute left-0 right-0 top-full mt-2 bg-white border border-card-border rounded-2xl shadow-[0_12px_32px_rgba(10,31,92,0.18)] overflow-hidden z-50 max-h-[70vh] overflow-y-auto"
    >
      {loading && (
        <div className="px-4 py-3 text-xs text-text-secondary inline-flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Searching…
        </div>
      )}
      {!loading && stores.length > 0 && (
        <div className="py-1">
          <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-widest text-text-secondary">Stores</div>
          {stores.slice(0, 4).map((s) => (
            <Link key={s.id} href={`/store/${s.id}`} onClick={onPick}
              data-testid={`search-sugg-store-${s.id}`}
              className="flex items-center gap-3 px-4 py-2 hover:bg-[#FDFBF7]">
              <div className="relative w-9 h-9 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                {s.banner && <Image src={s.banner} alt={s.name} fill sizes="36px" className="object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-brand-primary line-clamp-1">{s.name}</div>
                {s.locality && <div className="text-[11px] text-text-secondary line-clamp-1">{s.locality}</div>}
              </div>
            </Link>
          ))}
        </div>
      )}
      {!loading && products.length > 0 && (
        <div className="py-1 border-t border-slate-100">
          <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-widest text-text-secondary">Products</div>
          {products.slice(0, 6).map((p) => (
            <Link key={p.id} href={`/p/${p.id}`} onClick={onPick}
              data-testid={`search-sugg-product-${p.id}`}
              className="flex items-center gap-3 px-4 py-2 hover:bg-[#FDFBF7]">
              <div className="relative w-9 h-9 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                {p.image && <Image src={p.image} alt={p.name} fill sizes="36px" className="object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-brand-primary line-clamp-1">{p.name}</div>
                {p.price != null && <div className="text-[11px] text-text-secondary">₹{Number(p.price).toLocaleString()}</div>}
              </div>
            </Link>
          ))}
        </div>
      )}
      {!loading && (
        <Link href={`/search?q=${encodeURIComponent(q)}`} onClick={onPick}
          data-testid="search-sugg-see-all"
          className="block px-4 py-2.5 text-xs font-semibold text-brand-accent hover:bg-[#FDFBF7] border-t border-slate-100">
          {empty ? `No quick matches — search all of Lokl for "${q}"` : `See all results for "${q}" →`}
        </Link>
      )}
    </div>
  );
}

/**
 * LocationChip — auto-detect + a light address picker.
 *
 * Display priority (highest first):
 *   1. Logged-in customer's default saved address  →  "Home • Sector 6"
 *   2. Resolved Bhilai cluster                     →  "Smriti Nagar"
 *   3. Generic Bhilai city                          →  "Delivering to Bhilai"
 *
 * On mount we call `useLocationStore.autoDetectIfGranted()` which silently
 * fetches the position ONLY when the browser already has the permission —
 * first-time visitors are not surprise-prompted. After we have lat/lng we
 * resolve the cluster via GET /api/v1/location/cluster.
 *
 * Tap the chip:
 *   • Mobile (<lg)  → LocationSheet, a bottom sheet (same family as the
 *     pickup-reservation sheet in ProductActions — full-width, rounded-t-3xl,
 *     drag handle, dimmed backdrop) — the thumb-friendly q-com pattern for
 *     something this important, and consistent with the mobile search top
 *     sheet just above it in this same header.
 *   • Desktop (≥lg) → LocationDropdown, a light anchored dropdown (desktop
 *     doesn't get a bottom sheet — that's a mobile-first pattern — but gets
 *     the same content/hierarchy, just presented inline under the chip).
 *   Both share AddressRow/DetectRow so the content and behavior are
 *   identical, only the shell differs. Permission granted → "Use current
 *   location" is hidden (already auto-detected); denied/prompt → it stays
 *   so the user can opt in.
 */
/** Exported (Phase 9C) so UnserviceableArea.tsx can reuse this exact
 *  component — same current-location display AND the same tap-to-open
 *  saved-address/detect picker — as its "Change location" control,
 *  instead of a second location-picker implementation. Nothing about
 *  ConsumerHeader's own usage below changes.
 *
 *  `variant="block"` (Phase 9C, UnserviceableArea.tsx) swaps ONLY the
 *  trigger button's visual presentation — a larger, full-width card
 *  instead of the compact header pill — for prominent standalone
 *  placement. Every other line of this component (address fetching,
 *  detect, the sheet/dropdown it opens, label resolution) is 100%
 *  shared/untouched; `variant` defaults to "chip" so ConsumerHeader's own
 *  usage below is unaffected.
 *
 *  `label` (Phase 9C review pass) optionally OVERRIDES the displayed text
 *  only — every other behavior (fetch, detect, the picker it opens) is
 *  identical either way. UnserviceableArea.tsx passes this because this
 *  component's own default resolution (below: saved address → cluster →
 *  "Bhilai") can land on "Bhilai" for a location that is confirmed OUTSIDE
 *  Bhilai — useLocationStore.setLocation() hardcodes cluster to the
 *  literal string "Bhilai" regardless of where the point actually is (a
 *  pre-existing bug, out of scope to fix at its source here). Undefined
 *  (every other caller, including ConsumerHeader's own usage below) keeps
 *  the exact original resolution — zero behavior change for them. */
export function LocationChip(
  { phone, variant = "chip", label }: { phone: string | null; variant?: "chip" | "block"; label?: string },
) {
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const permission = useLocationStore((s) => s.permission);
  const requestLocation = useLocationStore((s) => s.requestLocation);
  const setLocation = useLocationStore((s) => s.setLocation);
  const autoDetect = useLocationStore((s) => s.autoDetectIfGranted);

  // Silent auto-detect on mount. Cheap no-op when permission isn't granted.
  useEffect(() => { void autoDetect(); }, [autoDetect]);

  // Eager fetch on mount so chip shows saved address immediately for logged-in customers.
  useEffect(() => {
    if (!phone) return;
    apiClient.get<{ addresses: SavedAddress[] }>(`/api/v1/addresses/${phone}`)
      .then((r) => setAddresses(r.data.addresses || []))
      .catch(() => {});
  }, [phone]);

  // Refresh when the picker opens to pick up any new addresses.
  useEffect(() => {
    if (!open || !phone) return;
    apiClient.get<{ addresses: SavedAddress[] }>(`/api/v1/addresses/${phone}`)
      .then((r) => setAddresses(r.data.addresses || []))
      .catch(() => {});
  }, [open, phone]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock body scroll while the mobile bottom sheet specifically is showing
  // (the desktop dropdown doesn't cover the page, so it doesn't need this).
  useEffect(() => {
    if (!open) return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const detect = async () => {
    setBusy(true);
    try { await requestLocation(); }
    finally { setBusy(false); setOpen(false); }
  };

  const pickAddress = (a: SavedAddress) => {
    const coords = a.location?.coordinates;
    if (coords && coords.length === 2) {
      const [lng_, lat_] = coords;
      setLocation(lat_, lng_);
    }
    setOpen(false);
  };

  // Build the chip label. The Feb-26 spec asks for a SINGLE LINE in every
  // case to keep the header chrome calm — no eyebrow row, no two-tier text.
  //
  // Mobile  → "Delivering in <value>"   (prefix included)
  // Desktop → "<value>"                  (no prefix; the chip is tighter)
  //
  // Resolution order for <value>:
  //   1. Saved default address  →  "<Title> · <preview>" (mobile) / "<Title>" (desktop)
  //   2. Resolved cluster        →  "Smriti Nagar"
  //   3. City fallback           →  "Bhilai"
  const defaultAddr = addresses.find((a) => a.is_default) || addresses[0];
  const addrPreview = defaultAddr ? clipAddress(defaultAddr) : null;
  // `label`, when passed, wins outright — see this function's own doc
  // comment for why (Phase 9C review pass: this component's own default
  // resolution below can be wrong for a confirmed-outside-Bhilai point).
  // Mobile value can be longer because the chip flexes to fill the row.
  const mobileValue = label ?? (mounted ? (
    addrPreview ? `${addrPreview.label} · ${addrPreview.preview}` : "Bhilai"
  ) : "Bhilai");
  // Desktop chip is fixed-ish width — keep it short.
  const desktopValue = label ?? (mounted ? (
    addrPreview ? addrPreview.label : "Bhilai"
  ) : "Bhilai");

  const showDetect = permission !== "granted";

  if (variant === "block") {
    return (
      <div className="relative w-full">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          data-testid="city-display-block"
          aria-haspopup="dialog"
          aria-expanded={open}
          className="flex items-center gap-3 w-full px-4 py-3.5 rounded-2xl bg-white border border-card-border hover:border-brand-primary transition min-w-0 text-left"
        >
          <div className="w-10 h-10 rounded-full bg-brand-accent/12 flex items-center justify-center shrink-0">
            <MapPin size={18} className="text-brand-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-text-secondary">Delivering to</div>
            <div className="text-sm font-bold text-brand-primary truncate" suppressHydrationWarning>{mobileValue}</div>
          </div>
          <span className="shrink-0 text-xs font-bold text-brand-accent">Change</span>
        </button>

        {open && (
          <LocationSheet
            phone={phone}
            addresses={addresses}
            selectedId={defaultAddr?.address_id}
            busy={busy}
            showDetect={showDetect}
            onDetect={detect}
            onPick={pickAddress}
            onClose={() => setOpen(false)}
          />
        )}
        {open && (
          <LocationDropdown
            phone={phone}
            addresses={addresses}
            selectedId={defaultAddr?.address_id}
            busy={busy}
            showDetect={showDetect}
            onDetect={detect}
            onPick={pickAddress}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full lg:w-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="city-display"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-2 w-full lg:w-auto lg:max-w-[200px] px-3 py-2 rounded-full bg-white border border-card-border text-sm hover:border-brand-primary transition min-w-0"
      >
        <MapPin size={15} className="text-brand-accent shrink-0" />
        <div className="flex-1 min-w-0 text-left">
          {/* Mobile — single line with "Delivering in" prefix */}
          <div className="lg:hidden text-[12px] font-semibold text-brand-primary truncate" suppressHydrationWarning>
            Delivering in <span className="font-bold">{mobileValue}</span>
          </div>
          {/* Desktop — short label only */}
          <div className="hidden lg:block text-[12px] font-semibold text-brand-primary truncate" suppressHydrationWarning>
            {desktopValue}
          </div>
        </div>
        <svg width="10" height="6" viewBox="0 0 10 6" className="shrink-0 text-brand-primary/60"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
      </button>

      {open && (
        <LocationSheet
          phone={phone}
          addresses={addresses}
          selectedId={defaultAddr?.address_id}
          busy={busy}
          showDetect={showDetect}
          onDetect={detect}
          onPick={pickAddress}
          onClose={() => setOpen(false)}
        />
      )}
      {open && (
        <LocationDropdown
          phone={phone}
          addresses={addresses}
          selectedId={defaultAddr?.address_id}
          busy={busy}
          showDetect={showDetect}
          onDetect={detect}
          onPick={pickAddress}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// Shared row renderers — used by both the mobile sheet and the desktop
// dropdown so content/behavior stay identical, only the shell differs.

function DetectRow({ busy, onDetect }: { busy: boolean; onDetect: () => void }) {
  return (
    <button
      type="button"
      onClick={onDetect}
      disabled={busy}
      data-testid="location-detect"
      className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-[#FDFBF7] disabled:opacity-60 text-left transition"
    >
      <div className="w-9 h-9 rounded-full bg-brand-accent/15 flex items-center justify-center shrink-0">
        {busy ? <Loader2 size={16} className="animate-spin text-brand-accent" /> : <Crosshair size={16} className="text-brand-accent" />}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold text-brand-primary">Use current location</div>
        <div className="text-[11px] text-text-secondary">We&apos;ll find the nearest serviceable area</div>
      </div>
    </button>
  );
}

function AddressRow({ a, selected, onPick }: { a: SavedAddress; selected: boolean; onPick: () => void }) {
  const isOffice = (a.label || "").toLowerCase().includes("office");
  const line = a.line1 || a.full_address;
  return (
    <button
      type="button"
      onClick={onPick}
      data-testid={`location-saved-${a.address_id}`}
      className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-2xl text-left transition ${
        selected ? "bg-brand-accent/8" : "hover:bg-[#FDFBF7]"
      }`}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${selected ? "bg-brand-accent/15" : "bg-brand-primary/8"}`}>
        {isOffice
          ? <StoreIcon size={14} className={selected ? "text-brand-accent" : "text-brand-primary"} />
          : <HomeIcon size={14} className={selected ? "text-brand-accent" : "text-brand-primary"} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-brand-primary">{a.label || "Address"}</span>
          {selected && <Check size={13} className="text-brand-accent shrink-0" strokeWidth={3} />}
        </div>
        {line && <div className="text-xs text-text-secondary mt-0.5 line-clamp-1">{line}</div>}
      </div>
    </button>
  );
}

interface LocationPickerProps {
  phone: string | null;
  addresses: SavedAddress[];
  selectedId?: string;
  busy: boolean;
  showDetect: boolean;
  onDetect: () => void;
  onPick: (a: SavedAddress) => void;
  onClose: () => void;
}

// Mobile — bottom sheet, same shell family as ProductActions' pickup sheet
// (rounded-t-3xl, drag handle, dimmed backdrop, slides up). z-[61]/[60]
// clears StickyBottomNav's z-50, so it renders over the nav, not behind it.
// Portaled to document.body: LocationChip (and this component with it) lives
// inside <header>, which has `backdrop-filter` (the bf-glass class) —
// backdrop-filter creates a new containing block for `position: fixed`
// descendants, which would otherwise confine this "fixed inset-0"/"fixed
// bottom-0" sheet to the header's own ~50px box instead of the viewport.
// (MobileSearchSheet dodges this by living outside <header> already; this
// one can't, since it hangs off the location pill deep inside the header.)
function LocationSheet({ phone, addresses, selectedId, busy, showDetect, onDetect, onPick, onClose }: LocationPickerProps) {
  return createPortal(
    <>
      <div
        data-testid="location-sheet-backdrop"
        onClick={onClose}
        className="lg:hidden fixed inset-0 z-[60] bg-[#0A1F5C]/45 search-sheet-backdrop-in"
      />
      <div
        data-testid="location-sheet"
        role="dialog"
        aria-modal="true"
        className="lg:hidden fixed bottom-0 inset-x-0 z-[61] bg-white rounded-t-3xl shadow-[0_-16px_40px_rgba(10,31,92,0.18)] max-h-[75vh] flex flex-col overflow-hidden location-sheet-in"
      >
        <div className="shrink-0 flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-[#E5E2DC] rounded-full" />
        </div>
        <div className="shrink-0 flex items-center justify-between px-5 pt-1 pb-2">
          <h2 className="font-display text-lg font-bold text-brand-primary">Deliver to</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="location-sheet-close"
            className="w-8 h-8 rounded-full bg-[#FDFBF7] border border-card-border flex items-center justify-center"
          >
            <X size={15} className="text-brand-primary" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          {showDetect && <DetectRow busy={busy} onDetect={onDetect} />}

          {phone && addresses.length > 0 && (
            <div className="mt-1">
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-text-secondary">Saved addresses</div>
              {addresses.map((a) => (
                <AddressRow key={a.address_id} a={a} selected={a.address_id === selectedId} onPick={() => onPick(a)} />
              ))}
            </div>
          )}

          {phone ? (
            <Link
              href="/account?tab=addresses"
              onClick={onClose}
              data-testid="location-manage"
              className="mt-1 flex items-center px-3 py-3 rounded-2xl hover:bg-[#FDFBF7] text-sm font-semibold text-brand-accent"
            >
              {addresses.length === 0 ? "+ Add an address" : "Manage addresses →"}
            </Link>
          ) : (
            <Link
              href="/account/login"
              onClick={onClose}
              data-testid="location-login-cta"
              className="mt-1 block px-3 py-3 rounded-2xl hover:bg-[#FDFBF7] text-sm text-text-secondary"
            >
              Log in to save your address →
            </Link>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

// Desktop — a light anchored dropdown (not a sheet; bottom sheets are a
// mobile-first pattern). Same content/order as LocationSheet, tighter
// spacing since it doesn't need thumb-sized touch targets.
//
// Two different positioning schemes, deliberately not both portaled:
//   • The click-outside-to-close catcher is `fixed inset-0`, so — same
//     backdrop-filter containing-block issue as LocationSheet above — it
//     must be portaled to document.body, or it'd be clipped to <header>'s
//     own small box and most of the page wouldn't count as "outside".
//   • The dropdown panel itself is `absolute left-0 top-full`, anchored to
//     LocationChip's own `relative` wrapper — `position: absolute` is NOT
//     affected by an ancestor's backdrop-filter (only `fixed` is), so it's
//     positioned correctly staying right where it is in the DOM. Portaling
//     it too would detach it from that anchor and break the positioning.
function LocationDropdown({ phone, addresses, selectedId, busy, showDetect, onDetect, onPick, onClose }: LocationPickerProps) {
  return (
    <>
      {createPortal(<div className="hidden lg:block fixed inset-0 z-40" onClick={onClose} />, document.body)}
      <div
        data-testid="location-popover"
        role="dialog"
        className="hidden lg:block absolute left-0 top-full mt-2 w-[300px] bg-white border border-card-border rounded-2xl shadow-[0_16px_40px_rgba(10,31,92,0.18)] z-50 overflow-hidden location-dropdown-in"
      >
        <div className="px-4 pt-3.5 pb-1">
          <h2 className="font-display text-sm font-bold text-brand-primary">Deliver to</h2>
        </div>
        <div className="px-2 pb-2 max-h-[60vh] overflow-y-auto">
          {showDetect && <DetectRow busy={busy} onDetect={onDetect} />}

          {phone && addresses.length > 0 && (
            <div className="mt-1">
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-text-secondary">Saved addresses</div>
              {addresses.map((a) => (
                <AddressRow key={a.address_id} a={a} selected={a.address_id === selectedId} onPick={() => onPick(a)} />
              ))}
            </div>
          )}

          {phone ? (
            <Link
              href="/account?tab=addresses"
              onClick={onClose}
              data-testid="location-manage"
              className="mt-1 flex items-center px-3 py-2.5 rounded-xl hover:bg-[#FDFBF7] text-xs font-semibold text-brand-accent"
            >
              {addresses.length === 0 ? "+ Add an address" : "Manage addresses →"}
            </Link>
          ) : (
            <Link
              href="/account/login"
              onClick={onClose}
              data-testid="location-login-cta"
              className="mt-1 block px-3 py-2.5 rounded-xl hover:bg-[#FDFBF7] text-xs text-text-secondary"
            >
              Log in to save your address →
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

// The old logic only looked past line1's raw start when line1 was empty —
// in practice line1 is almost always set, so the "smart" comma-segment
// fallback below almost never ran, and the pill instead showed a blind
// character-slice of line1 ("22, Sector 6, Near P…") which regularly starts
// mid-house-number and can get cut off again by the pill's own CSS
// `truncate` on a narrow phone. Now ALWAYS prefer a short, natural
// comma-separated segment (a locality name, not a raw slice) from whichever
// of line1/full_address has one, and only fall back to a short slice if
// neither does.
function clipAddress(a: SavedAddress): { label: string; preview: string } {
  const label = a.label || "Address";
  const candidates = [a.line1, a.full_address].filter((v): v is string => !!v && v.trim().length > 0);
  for (const raw of candidates) {
    const segment = raw.split(",").map((s) => s.trim()).find((s) => s.length > 2 && s.length <= 20 && !/^\d+$/.test(s));
    if (segment) return { label, preview: segment };
  }
  const fallback = (candidates[0] || a.city_name || "Bhilai").trim();
  const preview = fallback.length > 18 ? fallback.slice(0, 16) + "…" : fallback;
  return { label, preview };
}
