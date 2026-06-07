"use client";

/**
 * Quick-commerce search overlay (Zepto / Blinkit / Swiggy Instamart pattern).
 *
 * Slides up from the bottom on mobile, fades-in centered on desktop. Contains:
 *   • Full-width sticky search input
 *   • Recent searches (localStorage, last 6)
 *   • Popular searches (GET /api/search/trending)
 *   • Live suggestions while typing (GET /api/search/suggest, 250ms debounce)
 *
 * Submitting Enter or tapping a suggestion navigates to /search?q=... and
 * tracks the query via POST /api/search/track. Closes on X, Escape, or
 * outside-click. While open we lock the body scroll (mobile-first).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Search, X, Clock, TrendingUp, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface SearchProduct { id: string; name: string; price?: number; image?: string }
interface SearchStore { id: string; name: string; locality?: string; banner?: string }
interface SuggestResponse { products: SearchProduct[]; stores: SearchStore[] }
interface TrendingRow { q: string; count?: number }

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

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [trending, setTrending] = useState<TrendingRow[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestResponse | null>(null);
  const [loadingSugg, setLoadingSugg] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Load trending + recent every time the overlay opens. Trending is
  // cheap (one Mongo aggregation) so we re-fetch on each open to surface
  // queries that just trended this session.
  useEffect(() => {
    if (!open) return;
    setRecent(readRecent());
    api.search.trending(10).then((r) => setTrending(r as unknown as TrendingRow[])).catch(() => setTrending([]));
    // Reset transient state every time we re-open.
    setQ("");
    setSuggestions(null);
    setLoadingSugg(false);
    // Pop the keyboard up on mobile by focusing the input post-mount.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Body scroll lock while open so the underlying page doesn't ghost-scroll.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Debounced suggestion fetch.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setSuggestions(null); setLoadingSugg(false); return; }
    let cancelled = false;
    setLoadingSugg(true);
    const t = setTimeout(() => {
      api.search.suggest(term)
        .then((r) => { if (!cancelled) setSuggestions(r as unknown as SuggestResponse); })
        .catch(() => { if (!cancelled) setSuggestions({ products: [], stores: [] }); })
        .finally(() => { if (!cancelled) setLoadingSugg(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const submit = useCallback((termRaw?: string) => {
    const term = (termRaw ?? q).trim();
    if (!term) return;
    pushRecent(term);
    api.search.track(term).catch(() => { /* fire-and-forget */ });
    onClose();
    router.push(`/search?q=${encodeURIComponent(term)}`);
  }, [q, onClose, router]);

  const clearRecent = () => {
    try { localStorage.removeItem(RECENT_KEY); } catch { /* private-mode */ }
    setRecent([]);
  };

  if (!open) return null;

  const showResults = q.trim().length >= 2;
  const products = suggestions?.products ?? [];
  const stores = suggestions?.stores ?? [];

  return (
    <div
      data-testid="search-overlay"
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex flex-col bg-black/35 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-0 sm:mt-12 mx-auto w-full sm:max-w-2xl bg-white sm:rounded-3xl flex-1 sm:flex-none sm:max-h-[80vh] flex flex-col overflow-hidden animate-[slideUp_220ms_ease-out] shadow-[0_24px_60px_rgba(10,31,92,0.28)]"
        style={{ animationName: "slideUp" }}
      >
        {/* Sticky input */}
        <div className="sticky top-0 bg-white border-b border-card-border px-3 sm:px-4 py-3 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-[#FDFBF7] rounded-full border border-card-border focus-within:border-brand-primary">
            <Search size={16} className="text-text-secondary shrink-0" />
            <input
              ref={inputRef}
              data-testid="search-overlay-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
              placeholder="Search kurtas, sneakers, stores…"
              className="bg-transparent flex-1 outline-none text-sm min-w-0"
              autoComplete="off"
              autoFocus
            />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Clear" data-testid="search-overlay-clear" className="text-text-secondary hover:text-brand-primary">
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="search-overlay-close"
            aria-label="Close search"
            className="w-10 h-10 rounded-full bg-white border border-card-border flex items-center justify-center hover:bg-[#FDFBF7]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Live suggestions */}
          {showResults && (
            <div className="px-2 sm:px-4 py-2">
              {loadingSugg && (
                <div className="px-3 py-3 text-xs text-text-secondary inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Searching…
                </div>
              )}
              {!loadingSugg && stores.length > 0 && (
                <>
                  <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-widest text-text-secondary">Stores</div>
                  {stores.slice(0, 4).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { onClose(); router.push(`/store/${s.id}`); }}
                      data-testid={`search-overlay-store-${s.id}`}
                      className="w-full flex items-center gap-3 px-2 py-2 hover:bg-[#FDFBF7] rounded-xl text-left"
                    >
                      <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                        {s.banner && <Image src={s.banner} alt={s.name} fill sizes="40px" className="object-cover" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-brand-primary line-clamp-1">{s.name}</div>
                        {s.locality && <div className="text-[11px] text-text-secondary line-clamp-1">{s.locality}</div>}
                      </div>
                    </button>
                  ))}
                </>
              )}
              {!loadingSugg && products.length > 0 && (
                <>
                  <div className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-widest text-text-secondary">Products</div>
                  {products.slice(0, 8).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { onClose(); router.push(`/p/${p.id}`); }}
                      data-testid={`search-overlay-product-${p.id}`}
                      className="w-full flex items-center gap-3 px-2 py-2 hover:bg-[#FDFBF7] rounded-xl text-left"
                    >
                      <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                        {p.image && <Image src={p.image} alt={p.name} fill sizes="40px" className="object-cover" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-brand-primary line-clamp-1">{p.name}</div>
                        {p.price != null && <div className="text-[11px] text-text-secondary">₹{Number(p.price).toLocaleString()}</div>}
                      </div>
                    </button>
                  ))}
                </>
              )}
              {!loadingSugg && (
                <button
                  onClick={() => submit()}
                  data-testid="search-overlay-see-all"
                  className="w-full text-left px-3 py-3 text-xs font-semibold text-brand-accent hover:bg-[#FDFBF7] rounded-xl"
                >
                  {products.length + stores.length === 0
                    ? `No quick matches — search all of Lokl for "${q}" →`
                    : `See all results for "${q}" →`}
                </button>
              )}
            </div>
          )}

          {/* Recent + Popular (when no query) */}
          {!showResults && (
            <div className="px-3 sm:px-5 py-4 space-y-5">
              {recent.length > 0 && (
                <section data-testid="search-overlay-recent">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] uppercase tracking-widest text-text-secondary flex items-center gap-1.5">
                      <Clock size={12} /> Recent
                    </div>
                    <button
                      onClick={clearRecent}
                      data-testid="search-overlay-recent-clear"
                      className="text-[11px] font-semibold text-brand-accent hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recent.map((r) => (
                      <button
                        key={r}
                        onClick={() => submit(r)}
                        data-testid={`search-overlay-recent-${r}`}
                        className="px-3 py-1.5 rounded-full bg-white border border-card-border text-xs text-brand-primary hover:bg-[#FDFBF7]"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {trending.length > 0 && (
                <section data-testid="search-overlay-trending">
                  <div className="text-[10px] uppercase tracking-widest text-text-secondary flex items-center gap-1.5 mb-2">
                    <TrendingUp size={12} /> Popular searches
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {trending.map((t) => (
                      <button
                        key={t.q}
                        onClick={() => submit(t.q)}
                        data-testid={`search-overlay-trending-${t.q}`}
                        className="px-3 py-1.5 rounded-full bg-brand-primary/8 border border-brand-primary/20 text-xs text-brand-primary font-medium hover:bg-brand-primary/15 capitalize"
                      >
                        {t.q}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes slideUp {
          from { transform: translateY(28px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
