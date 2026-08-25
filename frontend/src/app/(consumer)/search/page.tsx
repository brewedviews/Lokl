"use client";

/**
 * /search — G9 §16-17. Previously two disconnected halves: the bottom
 * nav's Search tab opened `MobileSearchSheet` (a header-anchored overlay
 * with recent/suggestions/trending, never navigating anywhere), while this
 * route rendered results-only for whatever `?q=` happened to already be in
 * the URL — no input field of its own. G9 makes this the single real
 * entry point: StickyBottomNav's Search tab now `<Link href="/search">`s
 * here directly, and this page owns the whole flow itself.
 *
 * Reuses, does not reinvent: `api.search.suggest` (live suggestions),
 * `api.search.search` (full results, unchanged from the pre-G9 page),
 * `api.search.trending`/`api.products.popularInCity` (idle-state content),
 * and the exact `lokl_recent_searches` localStorage contract the old
 * overlay used — a returning user's recent list survives this rework.
 * Every piece of this UI already existed and worked inside
 * MobileSearchSheet (ConsumerHeader.tsx); this page ports that logic to a
 * real, focusable, back-navigable page instead of an overlay sheet tied to
 * header height. No new backend endpoint anywhere.
 *
 * Flow: query >= 2 chars -> debounced live suggestions (top stores/
 * products, "see all" to commit). Enter / tap a suggestion's "see all" /
 * tap a chip -> commits the query into `?q=`, fetches the full result set
 * via the same `api.search.search` the old page always used, and shows a
 * real 2-column ProductCard grid. Empty query -> idle state (quick-term
 * chips, recent, trending, popular-right-now products, Browse Stores).
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
const QUICK_TERMS = ["Kurta", "Jeans", "Sneakers", "Saree", "Kids wear", "Ethnic"];

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

  const clearRecent = useCallback(() => {
    try { localStorage.removeItem(RECENT_KEY); } catch { /* private-mode */ }
    setRecent([]);
  }, []);

  const showSuggestions = !committed && input.trim().length >= 2;
  const showIdle = !committed && input.trim().length < 2;
  const showResults = !!committed;
  const suggProducts = suggestions?.products ?? [];
  const suggStores = suggestions?.stores ?? [];
  const hasResults = results.products.length > 0 || results.stores.length > 0;

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      {/* Compact top bar — back + input, matching the L2 PLP's header
          treatment rather than the old page's giant title. */}
      <div className="sticky top-0 z-10 bg-[#FDFBF7]/95 backdrop-blur border-b border-[#E5E2DC]">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            data-testid="search-back"
            aria-label="Back"
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center hover:bg-[#E5E2DC]/60 transition"
          >
            <ChevronLeft size={20} className="text-[#0A1F5C]" />
          </button>
          <div className="flex-1 flex items-center gap-2.5 px-4 py-2.5 bg-white rounded-full border border-brand-primary min-w-0">
            <SearchIcon size={16} className="text-brand-accent shrink-0" />
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
              className="bg-transparent flex-1 outline-none text-sm min-w-0 text-brand-primary"
              autoComplete="off"
            />
            {input && (
              <button
                type="button"
                onClick={() => { setInput(""); setCommitted(""); setSuggestions(null); router.replace("/search", { scroll: false }); inputRef.current?.focus(); }}
                data-testid="search-page-clear"
                aria-label="Clear search"
                className="text-text-secondary hover:text-brand-primary transition shrink-0"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 py-4">
        {showSuggestions && (
          <div data-testid="search-suggestions">
            {suggLoading && (
              <div className="px-2 py-3 text-xs text-text-secondary inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Searching…
              </div>
            )}
            {!suggLoading && suggStores.length > 0 && (
              <>
                <div className="px-1 pt-1 pb-1 text-[10px] uppercase tracking-widest text-text-secondary">Stores</div>
                {suggStores.slice(0, 4).map((s) => (
                  <Link key={s.id} href={`/store/${s.id}`} data-testid={`search-sugg-store-${s.id}`}
                    className="flex items-center gap-3 px-1 py-2 hover:bg-white rounded-xl">
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
            {!suggLoading && suggProducts.length > 0 && (
              <>
                <div className="px-1 pt-3 pb-1 text-[10px] uppercase tracking-widest text-text-secondary">Products</div>
                {suggProducts.slice(0, 8).map((p) => (
                  <Link key={p.id} href={`/product/${p.id}`} data-testid={`search-sugg-product-${p.id}`}
                    className="flex items-center gap-3 px-1 py-2 hover:bg-white rounded-xl">
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
            {!suggLoading && (
              <button
                type="button"
                onClick={() => submit()}
                data-testid="search-sugg-see-all"
                className="w-full text-left px-1 py-3 text-xs font-semibold text-brand-accent hover:bg-white rounded-xl"
              >
                {suggProducts.length + suggStores.length === 0
                  ? `No quick matches — search all of Lokl for "${input}" →`
                  : `See all results for "${input}" →`}
              </button>
            )}
          </div>
        )}

        {showIdle && (
          <div className="space-y-6" data-testid="search-idle">
            <Link
              href="/stores"
              data-testid="search-browse-stores"
              className="flex items-center gap-3 px-3 py-2.5 rounded-2xl border border-card-border hover:bg-white transition"
            >
              <div className="w-9 h-9 rounded-full bg-brand-accent/15 flex items-center justify-center shrink-0">
                <StoreIcon size={16} className="text-brand-accent" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-brand-primary">Browse Stores</div>
                <div className="text-[11px] text-text-secondary">Every local seller on Lokl</div>
              </div>
            </Link>

            <div className="flex flex-wrap gap-2">
              {QUICK_TERMS.map((term) => (
                <button key={term} type="button" onClick={() => submit(term)}
                  data-testid={`search-quick-${term}`}
                  className="px-3 py-1.5 bg-white border border-card-border rounded-full text-sm text-brand-primary font-medium">
                  {term}
                </button>
              ))}
            </div>

            {recent.length > 0 && (
              <section data-testid="search-recent">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-widest text-text-secondary flex items-center gap-1.5">
                    <Clock size={12} /> Recent
                  </div>
                  <button type="button" onClick={clearRecent} data-testid="search-recent-clear"
                    className="text-[11px] font-semibold text-brand-accent hover:underline">
                    Clear
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recent.map((r) => (
                    <button key={r} type="button" onClick={() => submit(r)} data-testid={`search-recent-${r}`}
                      className="px-3 py-1.5 rounded-full bg-white border border-card-border text-xs text-brand-primary hover:bg-[#F4F1E9]">
                      {r}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {trending.length > 0 && (
              <section data-testid="search-trending">
                <div className="text-[10px] uppercase tracking-widest text-text-secondary flex items-center gap-1.5 mb-2">
                  <TrendingUp size={12} /> Popular searches
                </div>
                <div className="flex flex-wrap gap-2">
                  {trending.map((t) => (
                    <button key={t.q} type="button" onClick={() => submit(t.q)} data-testid={`search-trending-${t.q}`}
                      className="px-3 py-1.5 rounded-full bg-brand-primary/8 border border-brand-primary/20 text-xs text-brand-primary font-medium hover:bg-brand-primary/15 capitalize">
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
                    <Link key={p.id} href={`/product/${p.id}`} className="text-left rounded-xl overflow-hidden bg-white border border-card-border">
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

        {showResults && (
          <div data-testid="search-results">
            {resultsBusy && <p className="text-sm text-[#595959]">Searching…</p>}

            {!resultsBusy && results.stores.length > 0 && (
              <section className="mb-8">
                <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-3">Stores</div>
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

            {!resultsBusy && results.products.length > 0 && (
              <section>
                <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-3">Products ({results.products.length})</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
                  {results.products.map((p) => <ProductCard key={p.id} p={p} size="default" />)}
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
