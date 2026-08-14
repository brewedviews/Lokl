"use client";

/**
 * ConsumerHeader — sticky glass header.
 *
 * Mobile (<lg): TWO rows, both inside the same sticky header element so
 *   they scroll together — Logo · LocationChip (flex-1) · Cart on row 1,
 *   then a full-width pinned search bar on row 2. Tapping it does NOT
 *   navigate or take over the screen — the bar itself turns into a real
 *   input in place, and a SHEET drops down from directly below the header
 *   (over a dimmed backdrop covering the rest of the page) with the same
 *   recent/trending/live-suggestion experience the old full-screen
 *   SearchOverlay had. See MobileSearchBar (idle vs active) and
 *   MobileSearchSheet below. Dismiss via backdrop tap, the X, Escape, or
 *   the device back gesture (a history entry is pushed while the sheet is
 *   open specifically so back-gesture has something to intercept — see the
 *   popstate effect below).
 * Desktop (≥lg): single row — Logo · LocationChip · big Search · Stores
 *   · For Merchants · Profile · Cart. The Search input claims as much of
 *   the row as possible so the header doesn't have wasted whitespace; its
 *   dropdown (SuggestPanel) was already an in-place, non-navigating
 *   pattern, so it's untouched by the mobile sheet rework above.
 *
 * LocationChip handles its own auto-detect on mount and its own popover —
 * see the LocationChip component below.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { Loader2, MapPin, Search, ShoppingBag, Store as StoreIcon, User, X, Crosshair, Home as HomeIcon, Clock, TrendingUp, Check } from "lucide-react";
import {
  useCartStore, useLocationStore, useCustomerAuthStore, useSearchOverlay,
} from "@/stores";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { useMounted } from "@/hooks/useMounted";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";

interface SearchProduct { id: string; name: string; price?: number; image?: string }
interface SearchStore { id: string; name: string; locality?: string; banner?: string }
interface SuggestResponse { products: SearchProduct[]; stores: SearchStore[] }
interface TrendingRow { q: string; count?: number }

/** Recent-search chips, mobile sheet only — same localStorage key/shape the
 *  old SearchOverlay used, so a user's recent list survives this rework. */
const RECENT_KEY = "lokl_recent_searches";
const MAX_RECENT = 6;

function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}
function pushRecent(q: string) {
  if (typeof window === "undefined") return;
  try {
    const list = [q, ...readRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* private-mode */ }
}

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
  const pathname = usePathname();
  const mounted = useMounted();
  const cartCount = useCartStore((s) => s.getItemCount());
  const customerPhone = useCustomerAuthStore((s) => s.phone);
  useHeartbeat(customerPhone ? "customer" : "guest", { phone: customerPhone });
  const mobileSearchOpen = useSearchOverlay((s) => s.open);
  const openMobileSearch = useSearchOverlay((s) => s.show);
  const closeMobileSearch = useSearchOverlay((s) => s.hide);

  // Header height, tracked live so the mobile sheet/backdrop can anchor
  // exactly below it via an inline `top` (ConsumerHeader is always the
  // first element on the page, so its rendered height IS how far down the
  // sheet should start — no scroll-position math needed).
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ─── Mobile search sheet ────────────────────────────────────────
  const [mobileQ, setMobileQ] = useState("");
  const [mobileSuggestions, setMobileSuggestions] = useState<SuggestResponse | null>(null);
  const [mobileSuggLoading, setMobileSuggLoading] = useState(false);
  const [mobileRecent, setMobileRecent] = useState<string[]>([]);
  const [mobileTrending, setMobileTrending] = useState<TrendingRow[]>([]);
  const [mobileTrendingProducts, setMobileTrendingProducts] = useState<SearchProduct[]>([]);

  // Reset + load idle-state content every time the sheet opens.
  useEffect(() => {
    if (!mobileSearchOpen) return;
    setMobileQ("");
    setMobileSuggestions(null);
    setMobileSuggLoading(false);
    setMobileRecent(readRecent());
    api.search.trending(10).then((r) => setMobileTrending(r as unknown as TrendingRow[])).catch(() => setMobileTrending([]));
    setMobileTrendingProducts([]);
    api.products.popularInCity(8).then((r) => setMobileTrendingProducts(r as unknown as SearchProduct[])).catch(() => {});
  }, [mobileSearchOpen]);

  // Debounced live suggestions as the user types in the pinned bar.
  useEffect(() => {
    if (!mobileSearchOpen) return;
    const term = mobileQ.trim();
    if (term.length < 2) { setMobileSuggestions(null); setMobileSuggLoading(false); return; }
    let cancelled = false;
    setMobileSuggLoading(true);
    const t = setTimeout(() => {
      api.search.suggest(term)
        .then((r) => { if (!cancelled) setMobileSuggestions(r as unknown as SuggestResponse); })
        .catch(() => { if (!cancelled) setMobileSuggestions({ products: [], stores: [] }); })
        .finally(() => { if (!cancelled) setMobileSuggLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [mobileQ, mobileSearchOpen]);

  // Lock body scroll while the sheet is open — the backdrop already implies
  // the page underneath is inert, don't let it ghost-scroll too.
  useEffect(() => {
    if (!mobileSearchOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [mobileSearchOpen]);

  // Back-gesture dismiss: push one history entry when the sheet opens so
  // there's something for the gesture/hardware-back to pop. Every dismissal
  // path (backdrop tap, X, Escape) also routes through history.back() below
  // instead of calling closeMobileSearch() directly, so popstate is the
  // single source of truth for "the sheet just closed" — no double-closes,
  // no drift between what the browser's back stack thinks and what's shown.
  useEffect(() => {
    if (!mobileSearchOpen) return;
    window.history.pushState({ loklSearchSheet: true }, "");
    const onPopState = () => closeMobileSearch();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [mobileSearchOpen, closeMobileSearch]);

  const dismissMobileSearch = useCallback(() => {
    if (mobileSearchOpen) window.history.back();
  }, [mobileSearchOpen]);

  useEffect(() => {
    if (!mobileSearchOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismissMobileSearch(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileSearchOpen, dismissMobileSearch]);

  const submitMobileSearch = useCallback((termRaw?: string) => {
    const term = (termRaw ?? mobileQ).trim();
    if (!term) return;
    pushRecent(term);
    api.search.track(term).catch(() => { /* fire-and-forget */ });
    // Forward navigation, not a dismissal — close the UI directly rather
    // than through history.back() (that would step backward, not to /search).
    closeMobileSearch();
    router.push(`/search?q=${encodeURIComponent(term)}`);
  }, [mobileQ, closeMobileSearch, router]);

  const clearMobileRecent = useCallback(() => {
    try { localStorage.removeItem(RECENT_KEY); } catch { /* private-mode */ }
    setMobileRecent([]);
  }, []);

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

  // The PDP has its own sticky header (back button + search/cart/wishlist,
  // transparent-over-image transitioning to solid on scroll) — showing
  // this generic site header there too would stack two sticky bars, and
  // "back" only makes sense as a product-detail-screen affordance, not a
  // site-wide one. All hooks above still run unconditionally every render;
  // this early return only skips the JSX.
  if (pathname.startsWith("/product/")) return null;

  return (
    <>
    <header ref={headerRef} data-testid="consumer-header" className="sticky top-0 z-50 bf-glass border-b border-card-border">
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
        <Link
          href="/cart"
          data-testid="nav-cart"
          aria-label="Bag"
          className="relative flex items-center gap-1 px-3 py-2 rounded-full bg-brand-primary text-white hover:bg-brand-primary/90 transition shrink-0"
        >
          <ShoppingBag size={16} />
          {mounted && cartCount > 0 && <span className="text-xs font-semibold" data-testid="cart-badge">{cartCount}</span>}
        </Link>
      </div>

      {/* Mobile pinned search bar — row 2, still inside the sticky header
          so it scrolls together with row 1. Tapping it does NOT navigate —
          it swaps in place to a real input, and MobileSearchSheet (a sibling
          of <header>, positioned by headerHeight below) drops down over the
          rest of the page. */}
      <div className="lg:hidden max-w-7xl mx-auto px-4 pb-2.5">
        <MobileSearchBar
          active={mobileSearchOpen}
          q={mobileQ}
          onChange={setMobileQ}
          onOpen={openMobileSearch}
          onSubmit={() => submitMobileSearch()}
          onClose={dismissMobileSearch}
        />
      </div>
    </header>

    {mobileSearchOpen && (
      <MobileSearchSheet
        topOffset={headerHeight}
        q={mobileQ}
        loading={mobileSuggLoading}
        suggestions={mobileSuggestions}
        recent={mobileRecent}
        trending={mobileTrending}
        trendingProducts={mobileTrendingProducts}
        onClose={dismissMobileSearch}
        onSubmit={submitMobileSearch}
        onClearRecent={clearMobileRecent}
      />
    )}
    </>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────

// Mobile pinned search bar — idle state looks like a text input (rounded,
// on-brand, whisper shadow, search glyph, cycling placeholder hint) but is
// really a button. Once active it swaps in place — same position/size — to
// a REAL input plus a close (X) button; the sheet below reads its value.
// The cycling placeholder pauses while active since a real value/placeholder
// takes over.
const SEARCH_HINTS = ["try: jeans", "try: kurtas", "try: sarees", "try: sneakers", "try: ethnic wear"];

function MobileSearchBar({
  active, q, onChange, onOpen, onSubmit, onClose,
}: {
  active: boolean;
  q: string;
  onChange: (v: string) => void;
  onOpen: () => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const [hintIndex, setHintIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (active) return; // real value/placeholder takes over once active
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    const tick = setInterval(() => {
      setVisible(false);
      fadeTimer = setTimeout(() => {
        setHintIndex((i) => (i + 1) % SEARCH_HINTS.length);
        setVisible(true);
      }, 180);
    }, 2200);
    return () => { clearInterval(tick); if (fadeTimer) clearTimeout(fadeTimer); };
  }, [active]);

  // Pop the keyboard as soon as the bar becomes the real input.
  useEffect(() => {
    if (active) requestAnimationFrame(() => inputRef.current?.focus());
  }, [active]);

  if (!active) {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid="mobile-search-bar"
        aria-label="Search"
        className="w-full flex items-center gap-2.5 px-4 py-2.5 bg-white rounded-full border border-card-border shadow-[0_2px_8px_rgba(10,31,92,0.06)] text-left active:scale-[0.99] transition"
      >
        <Search size={17} className="text-brand-accent shrink-0" />
        <span
          data-testid="mobile-search-hint"
          className={`flex-1 min-w-0 truncate text-sm text-text-secondary transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}
        >
          {SEARCH_HINTS[hintIndex]}
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 flex items-center gap-2.5 px-4 py-2.5 bg-white rounded-full border border-brand-primary shadow-[0_2px_8px_rgba(10,31,92,0.06)] min-w-0">
        <Search size={17} className="text-brand-accent shrink-0" />
        <input
          ref={inputRef}
          data-testid="mobile-search-input"
          value={q}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmit(); } }}
          placeholder="Search kurtas, sneakers, stores…"
          className="bg-transparent flex-1 outline-none text-sm min-w-0 text-brand-primary"
          autoComplete="off"
        />
        {q && (
          <button
            type="button"
            onClick={() => onChange("")}
            data-testid="mobile-search-clear"
            aria-label="Clear search"
            className="text-text-secondary hover:text-brand-primary transition shrink-0"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        data-testid="mobile-search-close"
        aria-label="Close search"
        className="w-9 h-9 shrink-0 rounded-full bg-white border border-card-border flex items-center justify-center hover:bg-[#FDFBF7] transition"
      >
        <X size={16} className="text-brand-primary" />
      </button>
    </div>
  );
}

// The top sheet itself — dropped below the header (topOffset = header's
// live height), over a dimmed backdrop. Reuses the exact recent/trending/
// live-suggestion data and layout the old full-screen SearchOverlay had,
// just repositioned into a shorter anchored panel instead of a full-screen
// takeover. z-[61]/[60] clears StickyBottomNav's z-50, so on a short page
// the sheet renders OVER the bottom nav rather than being hidden behind it.
function MobileSearchSheet({
  topOffset, q, loading, suggestions, recent, trending, trendingProducts, onClose, onSubmit, onClearRecent,
}: {
  topOffset: number;
  q: string;
  loading: boolean;
  suggestions: SuggestResponse | null;
  recent: string[];
  trending: TrendingRow[];
  trendingProducts: SearchProduct[];
  onClose: () => void;
  onSubmit: (term?: string) => void;
  onClearRecent: () => void;
}) {
  const showResults = q.trim().length >= 2;
  const products = suggestions?.products ?? [];
  const stores = suggestions?.stores ?? [];

  return (
    <>
      <div
        data-testid="search-sheet-backdrop"
        onClick={onClose}
        className="lg:hidden fixed inset-x-0 bottom-0 z-[60] bg-[#0A1F5C]/45 search-sheet-backdrop-in"
        style={{ top: topOffset }}
      />
      <div
        data-testid="search-sheet"
        role="dialog"
        aria-modal="true"
        className="lg:hidden fixed inset-x-0 z-[61] bg-white rounded-b-3xl shadow-[0_16px_40px_rgba(10,31,92,0.18)] flex flex-col overflow-hidden search-sheet-in"
        style={{ top: topOffset, maxHeight: `calc(100vh - ${topOffset}px)` }}
      >
        <div className="overflow-y-auto">
          {showResults ? (
            <div className="px-2 py-2">
              {loading && (
                <div className="px-3 py-3 text-xs text-text-secondary inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Searching…
                </div>
              )}
              {!loading && stores.length > 0 && (
                <>
                  <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-widest text-text-secondary">Stores</div>
                  {stores.slice(0, 4).map((s) => (
                    <Link key={s.id} href={`/store/${s.id}`} onClick={onClose}
                      data-testid={`search-sheet-store-${s.id}`}
                      className="flex items-center gap-3 px-2 py-2 hover:bg-[#FDFBF7] rounded-xl">
                      <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                        {s.banner && <Image src={s.banner} alt={s.name} fill sizes="40px" className="object-cover" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-brand-primary line-clamp-1">{s.name}</div>
                        {s.locality && <div className="text-[11px] text-text-secondary line-clamp-1">{s.locality}</div>}
                      </div>
                    </Link>
                  ))}
                </>
              )}
              {!loading && products.length > 0 && (
                <>
                  <div className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-widest text-text-secondary">Products</div>
                  {products.slice(0, 8).map((p) => (
                    <Link key={p.id} href={`/p/${p.id}`} onClick={onClose}
                      data-testid={`search-sheet-product-${p.id}`}
                      className="flex items-center gap-3 px-2 py-2 hover:bg-[#FDFBF7] rounded-xl">
                      <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                        {p.image && <Image src={p.image} alt={p.name} fill sizes="40px" className="object-cover" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-brand-primary line-clamp-1">{p.name}</div>
                        {p.price != null && <div className="text-[11px] text-text-secondary">₹{Number(p.price).toLocaleString()}</div>}
                      </div>
                    </Link>
                  ))}
                </>
              )}
              {!loading && (
                <button
                  type="button"
                  onClick={() => onSubmit()}
                  data-testid="search-sheet-see-all"
                  className="w-full text-left px-3 py-3 text-xs font-semibold text-brand-accent hover:bg-[#FDFBF7] rounded-xl"
                >
                  {products.length + stores.length === 0
                    ? `No quick matches — search all of Lokl for "${q}" →`
                    : `See all results for "${q}" →`}
                </button>
              )}
            </div>
          ) : (
            <div className="px-3 py-4 space-y-5">
              <section>
                <div className="flex flex-wrap gap-2">
                  {["Kurta", "Jeans", "Sneakers", "Saree", "Kids wear", "Ethnic"].map((term) => (
                    <button key={term} type="button" onClick={() => onSubmit(term)}
                      data-testid={`search-sheet-quick-${term}`}
                      className="px-3 py-1.5 bg-[#FDFBF7] border border-card-border rounded-full text-sm text-brand-primary font-medium">
                      {term}
                    </button>
                  ))}
                </div>
              </section>
              {recent.length > 0 && (
                <section data-testid="search-sheet-recent">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] uppercase tracking-widest text-text-secondary flex items-center gap-1.5">
                      <Clock size={12} /> Recent
                    </div>
                    <button
                      type="button"
                      onClick={onClearRecent}
                      data-testid="search-sheet-recent-clear"
                      className="text-[11px] font-semibold text-brand-accent hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recent.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => onSubmit(r)}
                        data-testid={`search-sheet-recent-${r}`}
                        className="px-3 py-1.5 rounded-full bg-white border border-card-border text-xs text-brand-primary hover:bg-[#FDFBF7]"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {trending.length > 0 && (
                <section data-testid="search-sheet-trending">
                  <div className="text-[10px] uppercase tracking-widest text-text-secondary flex items-center gap-1.5 mb-2">
                    <TrendingUp size={12} /> Popular searches
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {trending.map((t) => (
                      <button
                        key={t.q}
                        type="button"
                        onClick={() => onSubmit(t.q)}
                        data-testid={`search-sheet-trending-${t.q}`}
                        className="px-3 py-1.5 rounded-full bg-brand-primary/8 border border-brand-primary/20 text-xs text-brand-primary font-medium hover:bg-brand-primary/15 capitalize"
                      >
                        {t.q}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {trendingProducts.length > 0 && (
                <section>
                  <div className="text-[10px] uppercase tracking-widest text-text-secondary mb-2">Popular right now</div>
                  <div className="grid grid-cols-3 gap-2">
                    {trendingProducts.slice(0, 6).map((p) => (
                      <Link key={p.id} href={`/product/${p.id}`} onClick={onClose}
                        className="text-left rounded-xl overflow-hidden bg-white border border-card-border">
                        <div className="relative aspect-square bg-slate-100">
                          {p.image && <Image src={p.image} alt={p.name} fill sizes="30vw" className="object-cover" />}
                        </div>
                        <div className="p-1.5">
                          <div className="text-[11px] font-semibold text-brand-primary line-clamp-1">{p.name}</div>
                          {p.price != null && <div className="text-[10px] text-text-secondary">₹{Number(p.price).toLocaleString()}</div>}
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </>
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
function LocationChip({ phone }: { phone: string | null }) {
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
  // Mobile value can be longer because the chip flexes to fill the row.
  const mobileValue = mounted ? (
    addrPreview ? `${addrPreview.label} · ${addrPreview.preview}` : "Bhilai"
  ) : "Bhilai";
  // Desktop chip is fixed-ish width — keep it short.
  const desktopValue = mounted ? (
    addrPreview ? addrPreview.label : "Bhilai"
  ) : "Bhilai";

  const showDetect = permission !== "granted";

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
