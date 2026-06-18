"use client";

/**
 * ConsumerHeader — sticky glass header.
 *
 * Feb-26 refinement (iter-24):
 *   • Mobile (<lg): SINGLE row — Logo · LocationChip (flex-1) · Cart.
 *     The permanent search bar that used to sit in row-2 is GONE; mobile
 *     search now lives behind the central pill in the bottom nav, which
 *     opens the slide-up SearchOverlay (Zepto/Blinkit pattern).
 *   • Desktop (≥lg): single row — Logo · LocationChip · big Search · Stores
 *     · For Merchants · Profile · Cart. The Search input claims as much of
 *     the row as possible so the header doesn't have wasted whitespace.
 *
 * LocationChip handles its own auto-detect on mount and its own popover —
 * see the LocationChip component below.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Search, ShoppingBag, Store as StoreIcon, User, X, Crosshair, Home as HomeIcon } from "lucide-react";
import {
  useCartStore, useLocationStore, useCustomerAuthStore,
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
  full_address?: string;
  city_name?: string;
  is_default?: boolean;
  location?: { coordinates?: [number, number] };
}

export function ConsumerHeader() {
  const router = useRouter();
  const mounted = useMounted();
  const cartCount = useCartStore((s) => s.getItemCount());
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
    <header data-testid="consumer-header" className="sticky top-0 z-50 bf-glass border-b border-card-border">
      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-2.5 lg:py-3 flex items-center gap-2 lg:gap-4">
        {/* Logo */}
        <Link href="/" data-testid="brand-logo" className="flex items-center shrink-0">
          <span className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-brand-primary">
            lokl<span className="text-brand-accent">.</span>
          </span>
        </Link>

        {/* Location chip — fills the row on mobile, fixed-ish on desktop so
            the search input claims as much of the free row as possible. */}
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
        <Link
          href="/cart"
          data-testid="nav-cart"
          aria-label="Cart"
          className="relative flex items-center gap-1 px-3 py-2 rounded-full bg-brand-primary text-white hover:bg-brand-primary/90 transition shrink-0"
        >
          <ShoppingBag size={16} />
          {mounted && cartCount > 0 && <span className="text-xs font-semibold" data-testid="cart-badge">{cartCount}</span>}
        </Link>
      </div>
    </header>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────

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
 * LocationChip — auto-detect + smart popover.
 *
 * Display priority (highest first):
 *   1. Logged-in customer's default saved address  →  "Home • Smriti Nagar"
 *   2. Resolved Bhilai cluster                     →  "Smriti Nagar"
 *   3. Generic Bhilai city                          →  "Delivering to Bhilai"
 *
 * On mount we call `useLocationStore.autoDetectIfGranted()` which silently
 * fetches the position ONLY when the browser already has the permission —
 * first-time visitors are not surprise-prompted. After we have lat/lng we
 * resolve the cluster via GET /api/v1/location/cluster.
 *
 * Tap the chip:
 *   • Permission granted → popover with saved addresses + "Add address" CTA.
 *     The "Detect" button is HIDDEN because we already auto-detected.
 *   • Permission denied / prompt → popover keeps the "Detect" button so the
 *     user can opt-in (we surface the browser geolocation dialog), plus a
 *     manual fallback (saved addresses if any).
 */
function LocationChip({ phone }: { phone: string | null }) {
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const cluster = useLocationStore((s) => s.cluster);
  const cityName = useLocationStore((s) => s.cityName);
  const permission = useLocationStore((s) => s.permission);
  const requestLocation = useLocationStore((s) => s.requestLocation);
  const setLocation = useLocationStore((s) => s.setLocation);
  const autoDetect = useLocationStore((s) => s.autoDetectIfGranted);
  const ref = useRef<HTMLDivElement | null>(null);

  // Silent auto-detect on mount. Cheap no-op when permission isn't granted.
  useEffect(() => { void autoDetect(); }, [autoDetect]);

  // Saved-address fetch — only when popover opens for a logged-in customer.
  useEffect(() => {
    if (!open || !phone) return;
    apiClient.get<{ addresses: SavedAddress[] }>(`/api/v1/addresses/${phone}`)
      .then((r) => setAddresses(r.data.addresses || []))
      .catch(() => setAddresses([]));
  }, [open, phone]);

  // Outside-click close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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
  // Mobile value can be longer because the chip flexes to fill the row.
  const mobileValue = mounted ? (
    addrPreview ? `${addrPreview.label} · ${addrPreview.preview}`
    : cluster ? cluster
    : (lat != null && lng != null) ? "Detecting..."
    : cityName || "Bhilai"
  ) : "Bhilai";
  // Desktop chip is fixed-ish width — keep it short.
  const desktopValue = mounted ? (
    addrPreview ? addrPreview.label
    : cluster ? cluster
    : (lat != null && lng != null) ? "Detecting..."
    : cityName || "Bhilai"
  ) : "Bhilai";

  const showDetect = permission !== "granted";

  return (
    <div ref={ref} className="relative w-full lg:w-auto">
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
        <div
          data-testid="location-popover"
          role="dialog"
          className="absolute left-0 top-full mt-2 w-[280px] sm:w-[320px] bg-white border border-card-border rounded-2xl shadow-[0_16px_40px_rgba(10,31,92,0.18)] z-50 overflow-hidden"
        >
          {/* Saved addresses (logged-in only) */}
          {phone && addresses.length > 0 && (
            <div>
              <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-widest text-text-secondary">Saved addresses</div>
              {addresses.map((a) => (
                <button
                  key={a.address_id}
                  type="button"
                  onClick={() => pickAddress(a)}
                  data-testid={`location-saved-${a.address_id}`}
                  className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-[#FDFBF7] text-left"
                >
                  <div className="w-7 h-7 rounded-full bg-brand-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    {(a.label || "").toLowerCase().includes("office")
                      ? <StoreIcon size={13} className="text-brand-primary" />
                      : <HomeIcon size={13} className="text-brand-primary" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-brand-primary">{a.label || "Address"}</div>
                    <div className="text-[11px] text-text-secondary line-clamp-1">{a.full_address}</div>
                  </div>
                </button>
              ))}
              <Link
                href="/account/addresses"
                onClick={() => setOpen(false)}
                data-testid="location-manage"
                className="block border-t border-card-border px-4 py-2.5 text-[12px] font-semibold text-brand-accent hover:bg-[#FDFBF7]"
              >
                Manage addresses →
              </Link>
            </div>
          )}

          {/* Detect — only when permission isn't already granted */}
          {showDetect && (
            <button
              type="button"
              onClick={detect}
              disabled={busy}
              data-testid="location-detect"
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FDFBF7] disabled:opacity-60 text-left border-t border-card-border first:border-t-0"
            >
              <div className="w-9 h-9 rounded-full bg-brand-accent/15 flex items-center justify-center shrink-0">
                {busy ? <Loader2 size={16} className="animate-spin text-brand-accent" /> : <Crosshair size={16} className="text-brand-accent" />}
              </div>
              <div>
                <div className="text-sm font-bold text-brand-primary">Detect my location</div>
                <div className="text-[11px] text-text-secondary">We&apos;ll match you to the nearest serviceable area</div>
              </div>
            </button>
          )}

          {/* Add-address / login CTA */}
          {phone ? (
            addresses.length === 0 && (
              <Link
                href="/account/addresses"
                onClick={() => setOpen(false)}
                data-testid="location-add"
                className="block border-t border-card-border px-4 py-3 text-xs font-semibold text-brand-accent hover:bg-[#FDFBF7]"
              >
                + Add an address
              </Link>
            )
          ) : (
            <Link
              href="/account/login"
              onClick={() => setOpen(false)}
              data-testid="location-login-cta"
              className="block border-t border-card-border px-4 py-3 text-xs text-text-secondary hover:bg-[#FDFBF7]"
            >
              Log in to save your address →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function clipAddress(a: SavedAddress): { label: string; preview: string } {
  const label = a.label || "Address";
  // "Home • Smriti Nagar"-style line: prefer the comma-separated locality
  // fragment when present, falling back to the first ~24 chars of the full
  // address. This keeps the chip readable on a 320px viewport.
  const full = (a.full_address || "").trim();
  const seg = full.split(",").map((s) => s.trim()).find((s) => s.length > 2 && s.length < 30);
  const preview = seg || (full.length > 28 ? full.slice(0, 26) + "…" : full || (a.city_name ?? "Bhilai"));
  return { label, preview };
}
