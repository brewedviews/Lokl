"use client";

/**
 * Price bands editor — image override per homepage price-bento tile
 * ("Under ₹499" / "Most Loved" / "Premium"). Saves per-row via
 * PUT /api/admin/price-bands/{id}. Mirrors AreasEditor.tsx's image-upload
 * + save pattern; unlike areas, label/slug/order are fixed by the band
 * definitions — only the image is admin-editable. Leave the image empty
 * to fall back to the cheapest visible product's photo in that band.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import { ImageUploadField } from "./ImageUploadField";
import type { CmsPriceBand } from "@/types";

export function PriceBandsEditor() {
  const [rows, setRows] = useState<CmsPriceBand[] | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    adminApi.listPriceBands().then(setRows).catch((e) => toast.error(String(e)));
  }, []);

  const patch = (id: string, p: Partial<CmsPriceBand>) => {
    setRows((r) => r?.map((b) => b.id === id ? { ...b, ...p } : b) || null);
    setDirty((d) => ({ ...d, [id]: true }));
  };

  const save = async (row: CmsPriceBand) => {
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      const updated = await adminApi.updatePriceBand(row.id, { image: row.image });
      setRows((r) => r?.map((b) => b.id === row.id ? updated : b) || null);
      setDirty((d) => { const n = { ...d }; delete n[row.id]; return n; });
      toast.success(`${row.label} updated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  };

  if (!rows) return <div className="p-6 text-center text-sm text-[#64748B]"><Loader2 size={18} className="inline animate-spin" /> Loading price bands…</div>;

  return (
    <div className="space-y-4" data-testid="cms-price-bands-editor">
      <div>
        <h3 className="font-display text-lg font-bold text-[#0A1F5C]">Price bands</h3>
        <p className="text-[11px] text-[#64748B]">
          The 3 price-filter tiles on the homepage. Set an image to override the
          auto-picked photo (the cheapest in-stock product in that range) — leave
          empty to keep auto-pull. Labels and ranges are fixed.
        </p>
      </div>

      <div className="space-y-3">
        {rows.map((b) => (
          <div key={b.id} data-testid={`cms-price-band-row-${b.slug}`} className="bg-white border border-[#E5E2DC] rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-[180px_1fr_auto] gap-4 items-start">
            <ImageUploadField
              label={`${b.label} image`} recommended="600×450"
              value={b.image || ""} onChange={(v) => patch(b.id, { image: v })}
              testid={`cms-price-band-image-${b.slug}`}
            />
            <div>
              <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Label</span>
              <div className="mt-1 text-sm font-semibold text-[#0A1F5C]">{b.label}</div>
              <div className="mt-2 flex items-center gap-3 text-[10px] text-[#94A3B8]">
                <span className="font-mono">slug: {b.slug}</span>
                <span>{b.image ? "Override set — auto-pull disabled" : "No override — showing cheapest product's photo"}</span>
              </div>
            </div>
            <button
              onClick={() => save(b)} disabled={!dirty[b.id] || busy[b.id]}
              data-testid={`cms-price-band-save-${b.slug}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-bold disabled:opacity-40 self-start"
            >
              {busy[b.id] ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {busy[b.id] ? "Saving…" : dirty[b.id] ? "Save" : "Saved"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
