"use client";

/**
 * Creatable Brand combobox — search existing brands or create a new one
 * inline. Styled to match the merchant product modal's form fields
 * (rounded-xl bordered inputs, uppercase micro-labels) since this is
 * net-new UI with no closer precedent to inherit from.
 *
 * Wired into the product create/edit modal's step 1, alongside L1/L2.
 * Setting a brand is optional — the parent never blocks save on it.
 */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { brandsApi } from "@/lib/api/brands";
import type { Brand } from "@/types";

interface Props {
  value: string;
  onChange: (brandId: string) => void;
  testid?: string;
}

export function BrandCombobox({ value, onChange, testid = "prod-brand" }: Props) {
  const [query, setQuery] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Resolve the display label whenever `value` changes from outside this
  // component (e.g. opening the edit modal for a product that already has
  // a brand_id but no name attached to the local form state).
  useEffect(() => {
    if (!value) { setSelectedLabel(""); return; }
    let cancelled = false;
    brandsApi.getBySlugOrId(value)
      .then((r) => { if (!cancelled) setSelectedLabel(r.brand.name); })
      .catch(() => { if (!cancelled) setSelectedLabel(""); });
    return () => { cancelled = true; };
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setLoading(true);
      brandsApi.list({ search: query, limit: 20 })
        .then((r) => setResults(r.brands))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  const pick = (b: Brand) => {
    onChange(b.id);
    setSelectedLabel(b.name);
    setOpen(false);
    setQuery("");
  };

  const clear = () => {
    onChange("");
    setSelectedLabel("");
  };

  const trimmed = query.trim();
  const exactMatch = results.some((b) => b.name.toLowerCase() === trimmed.toLowerCase());
  const canCreate = trimmed.length > 0 && !exactMatch;

  const createAndPick = async () => {
    if (!trimmed) return;
    setCreating(true);
    try {
      const brand = await brandsApi.create(trimmed);
      pick(brand);
      toast.success(`Brand "${brand.name}" created`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create brand");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <label className="text-xs font-bold text-[#595959] uppercase tracking-wide block mb-1">
        Brand <span className="normal-case font-normal text-[#9CA3AF]">(optional)</span>
      </label>

      {selectedLabel && !open ? (
        <div data-testid={testid} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] text-sm flex items-center justify-between">
          <span className="text-[#1A2B4C] font-semibold">{selectedLabel}</span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setOpen(true)} className="text-xs text-[#E68910] font-semibold">
              Change
            </button>
            <button type="button" onClick={clear} aria-label="Clear brand" className="text-[#9CA3AF] hover:text-[#595959]">
              <X size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div className="relative">
          <input
            data-testid={testid}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search or type a new brand…"
            className="w-full px-4 py-3 pr-9 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-sm"
          />
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] pointer-events-none" />
        </div>
      )}

      {open && (
        <div data-testid={`${testid}-dropdown`} className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-[#E5E2DC] rounded-xl shadow-xl max-h-64 overflow-y-auto">
          {loading && <div className="p-3 text-center text-xs text-[#9CA3AF]">Searching…</div>}
          {!loading && results.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => pick(b)}
              data-testid={`${testid}-option-${b.id}`}
              className="w-full flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-[#F5F5F5] text-left text-sm"
            >
              <span className="text-[#1A2B4C] font-medium truncate">{b.name}</span>
              {b.id === value && <Check size={14} className="text-[#E68910] flex-shrink-0" />}
            </button>
          ))}
          {!loading && results.length === 0 && !trimmed && (
            <div className="p-3 text-center text-xs text-[#9CA3AF]">Start typing to search brands</div>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={() => void createAndPick()}
              disabled={creating}
              data-testid={`${testid}-create`}
              className="w-full flex items-center gap-2 px-4 py-2.5 border-t border-[#F1F5F9] hover:bg-[#FDF3E7] text-left text-sm font-semibold text-[#E68910] disabled:opacity-50"
            >
              {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Create &ldquo;{trimmed}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
