"use client";

/**
 * Hero slides editor (redesign Phase A) — per-L1 multi-slide hero
 * carousel management. A GENUINELY SEPARATE system from HeroEditor.tsx's
 * single site-wide Hero banner above (this tab does not replace or
 * migrate that one; they coexist).
 *
 * UI pattern: pick an L1 at the top (pill row, same visual language as
 * BrandsEditor/PriceBandsEditor's row cards), manage that L1's slide list
 * below. Unlike BrandsEditor (server-paginated, can grow unbounded), this
 * list is small/fixed per L1 — full CRUD (create, edit every field,
 * delete, reorder) but no search/pagination, per the task's own scoping
 * call. Reuses ImageUploadField (same "cms" asset type the site-wide Hero
 * banner and Offers already upload into) and DestinationPicker (the
 * exact same redirect-URL picker the site-wide Hero banner's own
 * redirect_url field uses) rather than building new equivalents.
 */
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Save, Loader2, Trash2, Plus, Image as ImgIcon, ChevronUp, ChevronDown } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import { catalogApi } from "@/lib/api";
import { ImageUploadField } from "./ImageUploadField";
import { DestinationPicker } from "./DestinationPicker";
import type { HeroSlide, CategoryNode } from "@/types";

export function HeroSlidesEditor() {
  const [l1s, setL1s] = useState<CategoryNode[]>([]);
  const [activeL1, setActiveL1] = useState<string | null>(null);
  const [rows, setRows] = useState<HeroSlide[] | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    catalogApi.categories()
      .then((cats) => { setL1s(cats); if (cats[0]) setActiveL1(cats[0].id); })
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  }, []);

  const load = useCallback(async () => {
    if (!activeL1) return;
    setRows(null);
    try {
      const list = await adminApi.listHeroSlides(activeL1);
      setRows([...list].sort((a, b) => a.order - b.order));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load hero slides");
      setRows([]);
    }
  }, [activeL1]);

  useEffect(() => { void load(); }, [load]);

  const patch = (id: string, p: Partial<HeroSlide>) => {
    setRows((r) => r?.map((s) => s.id === id ? { ...s, ...p } : s) || null);
    setDirty((d) => ({ ...d, [id]: true }));
  };

  const save = async (row: HeroSlide) => {
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      const updated = await adminApi.updateHeroSlide(row.id, {
        image: row.image, image_public_id: row.image_public_id || "",
        eyebrow: row.eyebrow || "", headline: row.headline || "",
        subheadline: row.subheadline || "", highlight_text: row.highlight_text || "",
        cta_link: row.cta_link || "", active: row.active, order: row.order,
      });
      setRows((r) => r?.map((s) => s.id === row.id ? updated : s) || null);
      setDirty((d) => { const n = { ...d }; delete n[row.id]; return n; });
      toast.success("Slide updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  };

  const createNew = async () => {
    if (!activeL1) return;
    setCreating(true);
    try {
      const nextOrder = (rows && rows.length > 0) ? Math.max(...rows.map((s) => s.order)) + 1 : 1;
      await adminApi.createHeroSlide({ l1_id: activeL1, order: nextOrder, active: true });
      await load();
      toast.success("Slide created — add an image and headline below");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (row: HeroSlide) => {
    if (!confirm(`Delete this hero slide?${row.headline ? ` ("${row.headline}")` : ""} This cannot be undone.`)) return;
    try {
      await adminApi.deleteHeroSlide(row.id);
      await load();
      toast.success("Slide deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  // Reorder is just a save of the swapped `order` values on the two
  // affected rows — same "renumber by position" approach SectionsPanel's
  // own move() uses for homepage sections.
  const move = async (row: HeroSlide, dir: -1 | 1) => {
    if (!rows) return;
    const idx = rows.findIndex((s) => s.id === row.id);
    const otherIdx = idx + dir;
    if (idx < 0 || otherIdx < 0 || otherIdx >= rows.length) return;
    const other = rows[idx]!;
    const swapWith = rows[otherIdx]!;
    setBusy((b) => ({ ...b, [row.id]: true, [swapWith.id]: true }));
    try {
      const [updatedA, updatedB] = await Promise.all([
        adminApi.updateHeroSlide(other.id, { order: swapWith.order }),
        adminApi.updateHeroSlide(swapWith.id, { order: other.order }),
      ]);
      setRows((r) => r?.map((s) => s.id === updatedA.id ? updatedA : s.id === updatedB.id ? updatedB : s)
        .sort((a, b) => a.order - b.order) || null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reorder failed");
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false, [swapWith.id]: false }));
    }
  };

  return (
    <div className="space-y-4" data-testid="cms-hero-slides-editor">
      <div>
        <h3 className="font-display text-lg font-bold text-[#0A1F5C]">Hero slides</h3>
        <p className="text-[11px] text-[#64748B]">
          Per-category hero carousel slides. Pick a category below, then manage its slide list —
          image, headline, highlighted phrase, subheadline, redirect link, order, and active/hidden.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="cms-hero-slides-l1-picker">
        {l1s.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveL1(cat.id)}
            data-testid={`cms-hero-slides-l1-${cat.id}`}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
              activeL1 === cat.id ? "bg-[#0A1F5C] text-white border-[#0A1F5C]" : "bg-white text-[#595959] border-[#E5E2DC]"
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {!rows ? (
        <div className="p-6 text-center text-sm text-[#64748B]"><Loader2 size={18} className="inline animate-spin" /> Loading slides…</div>
      ) : (
        <>
          <button
            onClick={() => void createNew()}
            disabled={!activeL1 || creating}
            data-testid="cms-hero-slide-create"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-bold disabled:opacity-40"
          >
            {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} New slide
          </button>

          {rows.length === 0 ? (
            <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-8 text-center">
              <ImgIcon size={24} className="mx-auto text-[#94A3B8] mb-2" />
              <p className="text-sm text-[#595959]">No slides yet for this category — create the first one above.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((s, i) => (
                <div key={s.id} data-testid={`cms-hero-slide-row-${s.id}`} className="bg-white border border-[#E5E2DC] rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-[180px_1fr_auto] gap-4 items-start">
                  <ImageUploadField
                    label="Slide image" recommended="1200×500"
                    value={s.image || ""} onChange={(v) => patch(s.id, { image: v })}
                    testid={`cms-hero-slide-image-${s.id}`}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Eyebrow</span>
                      <input
                        type="text" value={s.eyebrow || ""} onChange={(e) => patch(s.id, { eyebrow: e.target.value })}
                        data-testid={`cms-hero-slide-eyebrow-${s.id}`}
                        className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Headline</span>
                      <input
                        type="text" value={s.headline || ""} onChange={(e) => patch(s.id, { headline: e.target.value })}
                        data-testid={`cms-hero-slide-headline-${s.id}`}
                        className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Highlighted phrase</span>
                      <input
                        type="text" value={s.highlight_text || ""} onChange={(e) => patch(s.id, { highlight_text: e.target.value })}
                        data-testid={`cms-hero-slide-highlight-${s.id}`}
                        placeholder="must match a substring of Headline, e.g. in minutes"
                        className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Subheadline</span>
                      <input
                        type="text" value={s.subheadline || ""} onChange={(e) => patch(s.id, { subheadline: e.target.value })}
                        data-testid={`cms-hero-slide-subheadline-${s.id}`}
                        className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none"
                      />
                    </label>
                    <div className="sm:col-span-2">
                      <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C] mb-1.5 block">Redirect link</span>
                      <DestinationPicker
                        value={s.cta_link || ""}
                        onChange={(v) => patch(s.id, { cta_link: v })}
                        testid={`cms-hero-slide-cta-${s.id}`}
                        placeholder="e.g. /c/women or /products?price=under-499"
                      />
                    </div>
                    <div className="sm:col-span-2 flex items-center gap-4">
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox" checked={s.active} onChange={(e) => patch(s.id, { active: e.target.checked })}
                          data-testid={`cms-hero-slide-active-${s.id}`}
                          className="h-3.5 w-3.5 accent-[#0A1F5C]"
                        />
                        <span className="text-[11px] font-bold text-[#0A1F5C]">{s.active ? "Active" : "Hidden"}</span>
                      </label>
                      <span className="text-[10px] text-[#94A3B8] font-mono">order: {s.order}</span>
                      <div className="flex items-center gap-1 ml-auto">
                        <button type="button" onClick={() => void move(s, -1)} disabled={i === 0 || busy[s.id]}
                          data-testid={`cms-hero-slide-up-${s.id}`}
                          className="w-6 h-6 rounded bg-white border border-[#E5E2DC] disabled:opacity-30 flex items-center justify-center"><ChevronUp size={12} /></button>
                        <button type="button" onClick={() => void move(s, 1)} disabled={i === rows.length - 1 || busy[s.id]}
                          data-testid={`cms-hero-slide-down-${s.id}`}
                          className="w-6 h-6 rounded bg-white border border-[#E5E2DC] disabled:opacity-30 flex items-center justify-center"><ChevronDown size={12} /></button>
                      </div>
                    </div>
                  </div>
                  <div className="flex lg:flex-col items-center gap-2">
                    <button onClick={() => void save(s)} disabled={!dirty[s.id] || busy[s.id]}
                      data-testid={`cms-hero-slide-save-${s.id}`}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-bold disabled:opacity-40">
                      {busy[s.id] ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                      {busy[s.id] ? "Saving…" : dirty[s.id] ? "Save" : "Saved"}
                    </button>
                    <button onClick={() => void remove(s)}
                      data-testid={`cms-hero-slide-delete-${s.id}`}
                      className="w-8 h-8 rounded-full bg-white border border-[#FCA5A5] text-[#DC2626] flex items-center justify-center"><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
