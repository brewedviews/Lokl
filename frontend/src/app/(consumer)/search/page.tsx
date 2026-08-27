"use client";

/**
 * /search — G9 §16-17, redesigned P0-8 (G20 product review).
 *
 * G20 problem statement: suggestions/recent/popular all reused slightly
 * different pill treatments for the same "tap a term" affordance (three
 * visually distinct chip styles for one interaction), Browse Stores read
 * as a generic list row, and the page felt assembled section-by-section
 * rather than designed as one experience. This pass:
 *   - Drops the hardcoded QUICK_TERMS list entirely — it duplicated
 *     "Popular searches" (real trending data) with fabricated terms; one
 *     real, live-data section replaces both.
 *   - Recent searches render as plain text rows (Clock icon + term +
 *     remove), not pills — visually distinct from Popular searches,
 *     matching the brief's own "compact rows or simple text chips" vs
 *     "restrained horizontal chip treatment" split.
 *   - One section-label type scale used everywhere on this page
 *     (text-[11px] font-bold uppercase tracking-wide text-[#9CA3AF]) —
 *     the same convention already established on Profile/Orders/Support.
 *   - Browse Stores becomes a real discovery module (storefront icon,
 *     "Browse stores" / "Explore local sellers on Lokl", full-width tap
 *     target) instead of a generic bordered row.
 *   - Committed results now lead with Products (the primary commerce
 *     intent), then Stores — reordered, not re-fetched; same
 *     api.search.search response, only render order changed.
 *
 * Reuses, does not reinvent: `api.search.suggest` (live suggestions),
 * `api.search.search` (full results, unchanged), `api.search.trending`/
 * `api.products.popularInCity` (idle-state content), and the exact
 * `lokl_recent_searches` localStorage contract the old overlay used. No
 * new backend endpoint anywhere.
 *
 * Flow: query >= 2 chars -> debounced live suggestions (top stores/
 * products, "see all" to commit). Enter / tap a suggestion's "see all" /
 * tap a chip -> commits the query into `?q=`, fetches the full result set,
 * shows a real 2-column ProductCard grid. Empty query -> idle state
 * (recent, popular searches, Browse Stores, popular-right-now products).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, Search as SearchIcon, X, Store as StoreIcon, Clock, TrendingUp, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { ProductCard } from "@/components/consumer/ProductCard";
import type { ProductCard as ProductCardType, StoreCard } from "@/types";

interface SearchProduct { id: string; name: string; price?: number; image?: string }
interface SearchStoreRow { id: string; name: string; locality?: string; banner?: string }
interface SuggestResponse { products: SearchProduct[]; stores: SearchStoreRow[] }
interface TrendingRow { q: string; count?: number }

const RECENT_KEY = "lokl_recent_searches";
const MAX_RECENT = 6;

// One label style for every section on this page — matches the convention
// already established on Profile/Orders/Support (text-[11px] font-bold
// uppercase tracking-wide text-[#9CA3AF]), not a page-local variant.
function SectionLabel({ icon: Icon, children }: { icon?: typeof Clock; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#9CA3AF] mb-2.5">
      {Icon && <Icon size={12} />}
      {children}
    </div>
  );
}

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

export default function SearchPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const urlQ = sp.get("q") || "";

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [input, setInput] = useState(urlQ);
  const [committed, setCommitted] = useState(urlQ);

  const [suggestions, setSuggestions] = useState<SuggestResponse | null>(null);
  const [suggLoading, setSuggLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [trending, setTrending] = useState<TrendingRow[]>([]);
  const [trendingProducts, setTrendingProducts] = useState<SearchProduct[]>([]);

  const [results, setResults] = useState<{ products: ProductCardType[]; stores: StoreCard[] }>({ products: [], stores: [] });
  const [resultsBusy, setResultsBusy] = useState(false);

  // Focus immediately on mount — this is now a dedicated page, not a
  // sheet the user already tapped an icon to open, so the keyboard should
  // pop right away per §16.
  useEffect(() => { requestAnimationFrame(() => inputRef.current?.focus()); }, []);

  // Idle-state content, loaded once — same idle payload the old overlay
  // fetched on open.
  useEffect(() => {
    setRecent(readRecent());
    api.search.trending(10).then((r) => setTrending(r as unknown as TrendingRow[])).catch(() => setTrending([]));
    api.products.popularInCity(8).then((r) => setTrendingProducts(r as unknown as SearchProduct[])).catch(() => {});
  }, []);

  // Debounced live suggestions while typing, before commit.
  useEffect(() => {
    const term = input.trim();
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
  }, [input]);

  // Full results once a query is committed (from the URL on load, or via
  // submit below) — same api.search.search(q, 60) the pre-G9 page used.
  useEffect(() => {
    if (!committed) { setResults({ products: [], stores: [] }); return; }
    setResultsBusy(true);
    api.search.search(committed, 60).then((r) => setResults(r)).finally(() => setResultsBusy(false));
  }, [committed]);

  const submit = useCallback((termRaw?: string) => {
    const term = (termRaw ?? input).trim();
    if (!term) return;
    pushRecent(term);
    api.search.track(term).catch(() => { /* fire-and-forget */ });
    setInput(term);
    setCommitted(term);
    setSuggestions(null);
    router.replace(`/search?q=${encodeURIComponent(term)}`, { scroll: false });
  }, [input, router]);

  const removeRecent = useCallback((term: string) => {
    const list = readRecent().filter((x) => x !== term);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* private-mode */ }
    setRecent(list);
  }, []);

  const showSuggestions = !committed && input.trim().length >= 2;
  const showIdle = !committed && input.trim().length < 2;
  const showResults = !!committed;
  const suggProducts = suggestions?.products ?? [];
  const suggStores = suggestions?.stores ?? [];
  const hasResults = results.products.length > 0 || results.stores.length > 0;

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      {/* Search is the primary action on this page — a larger, more
          deliberate input than a generic header search field, directly
          below the compact back bar. */}
      <div className="sticky top-0 z-10 bg-[#FDFBF7]/95 backdrop-blur border-b border-[#E5E2DC]">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-2.5 pb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            data-testid="search-back"
            aria-label="Back"
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center hover:bg-[#E5E2DC]/60 transition"
          >
            <ChevronLeft size={20} className="text-[#0A1F5C]" />
          </button>
          <div className="flex-1 flex items-center gap-2.5 px-4 py-3 bg-white rounded-2xl border border-[#0A1F5C]/20 min-w-0 focus-within:border-[#0A1F5C]">
            <SearchIcon size={17} className="text-[#E68910] shrink-0" />
            <input
              ref={inputRef}
              data-testid="search-page-input"
              value={input}
              onChange={(e) => {
                const v = e.target.value;
                setInput(v);
                if (!v.trim()) { setCommitted(""); router.replace("/search", { scroll: false }); }
              }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
              placeholder="Search kurtas, sneakers, stores…"
              className="bg-transparent flex-1 outline-none text-sm min-w-0 text-[#0A1F5C]"
              autoComplete="off"
            />
            {input && (
              <button
                type="button"
                onClick={() => { setInput(""); setCommitted(""); setSuggestions(null); router.replace("/search", { scroll: false }); inputRef.current?.focus(); }}
                data-testid="search-page-clear"
                aria-label="Clear search"
                className="text-[#9CA3AF] hover:text-[#0A1F5C] transition shrink-0"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-5">
        {showSuggestions && (
          <div data-testid="search-suggestions">
            {suggLoading && (
              <div className="px-1 py-3 text-xs text-[#9CA3AF] inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Searching…
              </div>
            )}
            {!suggLoading && suggStores.length > 0 && (
              <>
                <SectionLabel>Stores</SectionLabel>
                <div className="mb-4">
                  {suggStores.slice(0, 4).map((s) => (
                    <Link key={s.id} href={`/store/${s.id}`} data-testid={`search-sugg-store-${s.id}`}
                      className="flex items-center gap-3 py-2 hover:bg-white rounded-xl -mx-1 px-1">
                      <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                        {s.banner && <Image src={s.banner} alt={s.name} fill sizes="40px" className="object-cover" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[#0A1F5C] line-clamp-1">{s.name}</div>
                        {s.locality && <div className="text-[11px] text-[#9CA3AF] line-clamp-1">{s.locality}</div>}
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
            {!suggLoading && suggProducts.length > 0 && (
              <>
                <SectionLabel>Products</SectionLabel>
                <div>
                  {suggProducts.slice(0, 8).map((p) => (
                    <Link key={p.id} href={`/product/${p.id}`} data-testid={`search-sugg-product-${p.id}`}
                      className="flex items-center gap-3 py-2 hover:bg-white rounded-xl -mx-1 px-1">
                      <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                        {p.image && <Image src={p.image} alt={p.name} fill sizes="40px" className="object-cover" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[#0A1F5C] line-clamp-1">{p.name}</div>
                        {p.price != null && <div className="text-[11px] text-[#9CA3AF]">₹{Number(p.price).toLocaleString()}</div>}
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
            {!suggLoading && (
              <button
                type="button"
                onClick={() => submit()}
                data-testid="search-sugg-see-all"
                className="w-full text-left py-3 mt-1 text-xs font-semibold text-[#E68910] hover:bg-white rounded-xl"
              >
                {suggProducts.length + suggStores.length === 0
                  ? `No quick matches — search all of Lokl for "${input}" →`
                  : `See all results for "${input}" →`}
              </button>
            )}
          </div>
        )}

        {showIdle && (
          <div className="space-y-7" data-testid="search-idle">
            {recent.length > 0 && (
              <section data-testid="search-recent">
                <SectionLabel icon={Clock}>Recent</SectionLabel>
                <div className="divide-y divide-[#E5E2DC]">
                  {recent.map((r) => (
                    <div key={r} className="flex items-center gap-3 group">
                      <button type="button" onClick={() => submit(r)} data-testid={`search-recent-${r}`}
                        className="flex-1 text-left py-2.5 text-sm text-[#0A1F5C]">
                        {r}
                      </button>
                      <button type="button" onClick={() => removeRecent(r)} aria-label={`Remove ${r}`}
                        data-testid={`search-recent-remove-${r}`}
                        className="text-[#9CA3AF] hover:text-[#0A1F5C] p-1 shrink-0">
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {trending.length > 0 && (
              <section data-testid="search-trending">
                <SectionLabel icon={TrendingUp}>Popular searches</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  {trending.map((t) => (
                    <button key={t.q} type="button" onClick={() => submit(t.q)} data-testid={`search-trending-${t.q}`}
                      className="px-3 py-1.5 rounded-full bg-white border border-[#E5E2DC] text-xs text-[#0A1F5C] font-medium hover:border-[#0A1F5C]/40 capitalize">
                      {t.q}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Browse Stores — a real discovery module, not a generic list
                row: storefront icon, two-line copy, full tap target. */}
            <Link
              href="/stores"
              data-testid="search-browse-stores"
              className="flex items-center gap-3.5 px-4 py-4 rounded-2xl bg-white border border-[#E5E2DC] hover:border-[#0A1F5C]/40 transition"
            >
              <div className="w-11 h-11 rounded-full bg-[#E68910]/12 flex items-center justify-center shrink-0">
                <StoreIcon size={19} className="text-[#E68910]" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#0A1F5C]">Browse stores</div>
                <div className="text-[11px] text-[#9CA3AF] mt-0.5">Explore local sellers on Lokl</div>
              </div>
            </Link>

            {trendingProducts.length > 0 && (
              <section>
                <SectionLabel>Popular right now</SectionLabel>
                <div className="grid grid-cols-3 gap-2.5">
                  {trendingProducts.slice(0, 6).map((p) => (
                    <Link key={p.id} href={`/product/${p.id}`} className="text-left rounded-xl overflow-hidden bg-white border border-[#E5E2DC]">
                      <div className="relative aspect-square bg-slate-100">
                        {p.image && <Image src={p.image} alt={p.name} fill sizes="30vw" className="object-cover" />}
                      </div>
                      <div className="p-1.5">
                        <div className="text-[11px] font-semibold text-[#0A1F5C] line-clamp-1">{p.name}</div>
                        {p.price != null && <div className="text-[10px] text-[#9CA3AF]">₹{Number(p.price).toLocaleString()}</div>}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {showResults && (
          <div data-testid="search-results">
            {resultsBusy && <p className="text-sm text-[#595959]">Searching…</p>}

            {/* Products lead (the primary commerce intent), Stores follow —
                same api.search.search response, only render order changed. */}
            {!resultsBusy && results.products.length > 0 && (
              <section className="mb-8">
                <SectionLabel>Products ({results.products.length})</SectionLabel>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
                  {results.products.map((p) => <ProductCard key={p.id} p={p} size="default" />)}
                </div>
              </section>
            )}

            {!resultsBusy && results.stores.length > 0 && (
              <section>
                <SectionLabel>Stores</SectionLabel>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {results.stores.map((s) => (
                    <Link key={s.id} href={`/store/${s.id}`} data-testid={`search-store-${s.id}`} className="bg-white rounded-2xl overflow-hidden border border-[#E5E2DC] hover:border-[#0A1F5C] transition">
                      <div className="relative aspect-[4/3] bg-[#FDFBF7]">
                        {s.image && <Image src={s.image} alt={s.name} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover" />}
                      </div>
                      <div className="p-3">
                        <div className="font-semibold text-[#0A1F5C] truncate">{s.name}</div>
                        {s.tagline && <div className="text-[11px] text-[#595959] truncate">{s.tagline}</div>}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {!resultsBusy && !hasResults && (
              <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-8 text-center">
                <p className="text-sm text-[#595959]">No matches for &ldquo;{committed}&rdquo;. Try a different keyword.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
