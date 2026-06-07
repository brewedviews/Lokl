"use client";

/**
 * DestinationPicker — searchable selector that hits
 * GET /api/admin/cms/search-destinations and lets the admin pick a redirect
 * target across Stores, Products, Categories, Sub-Categories, Offers — or
 * fall back to a manually entered Custom URL.
 *
 * Output: a string URL (e.g. "/c/women", "/store/abc", "/offers/festive-sale").
 */
import { useState, useEffect, useRef } from "react";
import { Search, ExternalLink, Store, Package, Tag, Folder, Sparkles, Link2 } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import type { CmsDestinationSearch, CmsDestination } from "@/types";

interface Props {
  value: string;
  onChange: (url: string) => void;
  testid: string;
  placeholder?: string;
}

const KIND_META: Record<string, { label: string; Icon: React.ComponentType<{ size?: number }> }> = {
  stores:        { label: "Stores",         Icon: Store },
  products:      { label: "Products",       Icon: Package },
  categories:    { label: "Categories",     Icon: Tag },
  subcategories: { label: "Sub-categories", Icon: Folder },
  offers:        { label: "Offers",         Icon: Sparkles },
};

export function DestinationPicker({ value, onChange, testid, placeholder }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CmsDestinationSearch | null>(null);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setLoading(true);
      adminApi.searchDestinations(q)
        .then(setResults)
        .catch(() => setResults(null))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  const pick = (d: CmsDestination) => {
    onChange(d.url);
    setOpen(false);
    setQ("");
  };

  const totalCount = results
    ? results.stores.length + results.products.length + results.categories.length +
      results.subcategories.length + results.offers.length
    : 0;

  return (
    <div ref={boxRef} className="relative" data-testid={testid}>
      <div className="flex items-stretch gap-0 rounded-full border border-[#E5E2DC] bg-white overflow-hidden focus-within:border-[#0A1F5C]">
        <Link2 size={12} className="text-[#94A3B8] ml-3 self-center" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder || "Redirect URL (e.g. /c/women) or pick →"}
          data-testid={`${testid}-input`}
          className="flex-1 px-2 py-1.5 text-[11px] bg-transparent outline-none"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          data-testid={`${testid}-toggle`}
          className="px-3 bg-[#0A1F5C] text-white text-[10px] font-bold tracking-wider flex items-center gap-1"
          title="Pick destination"
        >
          <Search size={11} /> PICK
        </button>
      </div>

      {open && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-[#E5E2DC] rounded-xl shadow-xl max-h-[420px] overflow-y-auto" data-testid={`${testid}-dropdown`}>
          <div className="sticky top-0 bg-white border-b border-[#E5E2DC] p-2">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              placeholder="Search stores, products, categories, offers…"
              data-testid={`${testid}-search`}
              className="w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-[#FDFBF7] text-[11px] outline-none focus:border-[#0A1F5C]"
            />
          </div>

          {loading && <div className="p-4 text-center text-[11px] text-[#94A3B8]">Searching…</div>}

          {!loading && results && totalCount === 0 && (
            <div className="p-4 text-center text-[11px] text-[#94A3B8]">No results. Type a Custom URL in the field above instead.</div>
          )}

          {!loading && results && (Object.keys(results) as (keyof CmsDestinationSearch)[]).map((kind) => {
            const list = results[kind];
            if (!list || list.length === 0) return null;
            const meta = KIND_META[kind];
            if (!meta) return null;
            const { label, Icon } = meta;
            return (
              <div key={kind} className="border-t border-[#F1F5F9] first:border-t-0">
                <div className="px-3 py-1.5 text-[9px] uppercase tracking-widest font-bold text-[#94A3B8] flex items-center gap-1.5 bg-[#FDFBF7]">
                  <Icon size={10} /> {label}
                </div>
                {list.map((d) => (
                  <button
                    key={d.id || d.url}
                    type="button"
                    onClick={() => pick(d)}
                    data-testid={`${testid}-result-${d.id}`}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-[#FDFBF7] text-left"
                  >
                    <span className="text-[12px] text-[#0A1F5C] font-semibold truncate">{d.label}</span>
                    <span className="text-[10px] text-[#94A3B8] font-mono truncate flex items-center gap-1 shrink-0">
                      {d.url} <ExternalLink size={9} />
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
