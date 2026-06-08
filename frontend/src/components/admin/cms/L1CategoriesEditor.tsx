"use client";

/**
 * L1 Category Tiles editor — name, image, redirect per category.
 * Saves per-row via PUT /api/admin/categories/{id}.
 *
 * Defaults to `/c/{slug}` if redirect_url is blank — admin only needs to
 * touch this when they want a non-standard landing page.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Loader2, ExternalLink } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import { ImageUploadField } from "./ImageUploadField";
import { DestinationPicker } from "./DestinationPicker";
import type { CmsCategory } from "@/types";

export function L1CategoriesEditor() {
  const [rows, setRows] = useState<CmsCategory[] | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    adminApi.listCategories().then(setRows).catch((e) => toast.error(String(e)));
  }, []);

  const patch = (id: string, p: Partial<CmsCategory>) => {
    setRows((r) => r?.map((c) => c.id === id ? { ...c, ...p } : c) || null);
    setDirty((d) => ({ ...d, [id]: true }));
  };

  const save = async (row: CmsCategory) => {
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      const updated = await adminApi.updateCategory(row.id, {
        name: row.name,
        image: row.image,
        redirect_url: row.redirect_url || "",
        paused: !!row.paused,
        non_clickable: !!row.non_clickable,
      });
      setRows((r) => r?.map((c) => c.id === row.id ? updated : c) || null);
      setDirty((d) => { const n = { ...d }; delete n[row.id]; return n; });
      toast.success(`${row.name} updated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  };

  if (!rows) return <div className="p-6 text-center text-sm text-[#64748B]"><Loader2 size={18} className="inline animate-spin" /> Loading categories…</div>;

  return (
    <div className="space-y-4" data-testid="cms-l1-editor">
      <div>
        <h3 className="font-display text-lg font-bold text-[#0A1F5C]">L1 Categories</h3>
        <p className="text-[11px] text-[#64748B]">Top-level tiles that appear in the &ldquo;Shop by category&rdquo; rail.</p>
      </div>

      <div className="space-y-3">
        {rows.map((c) => (
          <div key={c.id} data-testid={`cms-l1-row-${c.slug}`} className={`bg-white border border-[#E5E2DC] rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-[180px_1fr_auto] gap-4 items-start transition-opacity ${c.paused ? "opacity-50" : ""}`}>
            <ImageUploadField
              label={`${c.name} image`} recommended="800×800"
              value={c.image || ""} onChange={(v) => patch(c.id, { image: v })}
              testid={`cms-l1-image-${c.slug}`}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Name</span>
                <input
                  type="text" value={c.name} onChange={(e) => patch(c.id, { name: e.target.value })}
                  data-testid={`cms-l1-name-${c.slug}`}
                  className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none"
                />
              </label>
              <div>
                <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C] mb-1 block">Redirect URL</span>
                <DestinationPicker
                  value={c.redirect_url || ""} onChange={(v) => patch(c.id, { redirect_url: v })}
                  testid={`cms-l1-redirect-${c.slug}`}
                  placeholder={`Default: /c/${c.slug}`}
                />
              </div>
              <div className="sm:col-span-2 flex items-center gap-3 text-[10px] text-[#94A3B8]">
                <span className="font-mono">slug: {c.slug}</span>
                <span>order: {c.order ?? "—"}</span>
                {(c.redirect_url || c.image) && (
                  <a href={c.redirect_url || `/c/${c.slug}`} target="_blank" rel="noreferrer"
                     data-testid={`cms-l1-preview-${c.slug}`}
                     className="inline-flex items-center gap-1 ml-auto text-[#0A1F5C] font-semibold">
                    Preview <ExternalLink size={9} />
                  </a>
                )}
              </div>
              {/* iter-27 (Item 7) — paused + non-clickable toggles */}
              <div className="sm:col-span-2 flex flex-wrap items-center gap-5 pt-2 border-t border-[#F1F5F9]">
                <label className="inline-flex items-center gap-2 cursor-pointer text-[11px] font-semibold text-[#0A1F5C]">
                  <input
                    type="checkbox" checked={!!c.non_clickable}
                    onChange={(e) => patch(c.id, { non_clickable: e.target.checked })}
                    data-testid={`cms-l1-nonclick-${c.slug}`}
                    className="h-3.5 w-3.5 accent-[#0A1F5C]"
                  />
                  Make non-clickable
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer text-[11px] font-semibold text-[#0A1F5C]">
                  <input
                    type="checkbox" checked={!!c.paused}
                    onChange={(e) => patch(c.id, { paused: e.target.checked })}
                    data-testid={`cms-l1-paused-${c.slug}`}
                    className="h-3.5 w-3.5 accent-[#0A1F5C]"
                  />
                  Paused
                </label>
                {c.paused && (
                  <span className="px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E] text-[10px] font-bold uppercase tracking-wider">Hidden from customers</span>
                )}
              </div>
            </div>
            <button
              onClick={() => save(c)} disabled={!dirty[c.id] || busy[c.id]}
              data-testid={`cms-l1-save-${c.slug}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-bold disabled:opacity-40 self-start"
            >
              {busy[c.id] ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {busy[c.id] ? "Saving…" : dirty[c.id] ? "Save" : "Saved"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
