"use client";

/**
 * L2 Sub-Category editor — grouped by parent L1.
 * Same controls as L1: name, image, redirect URL. Saves per-row.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import { ImageUploadField } from "./ImageUploadField";
import { DestinationPicker } from "./DestinationPicker";
import type { CmsCategory, CmsSubcategory } from "@/types";

export function L2SubcategoriesEditor() {
  const [l1, setL1] = useState<CmsCategory[] | null>(null);
  const [l2, setL2] = useState<CmsSubcategory[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    Promise.all([adminApi.listCategories(), adminApi.listSubcategories()])
      .then(([a, b]) => { setL1(a); setL2(b); })
      .catch((e) => toast.error(String(e)));
  }, []);

  const patch = (id: string, p: Partial<CmsSubcategory>) => {
    setL2((r) => r?.map((s) => s.id === id ? { ...s, ...p } : s) || null);
    setDirty((d) => ({ ...d, [id]: true }));
  };

  const save = async (row: CmsSubcategory) => {
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      const updated = await adminApi.updateSubcategory(row.id, {
        name: row.name,
        image: row.image,
        redirect_url: row.redirect_url || "",
      });
      setL2((r) => r?.map((s) => s.id === row.id ? updated : s) || null);
      setDirty((d) => { const n = { ...d }; delete n[row.id]; return n; });
      toast.success(`${row.name} updated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  };

  if (!l1 || !l2) return <div className="p-6 text-center text-sm text-[#64748B]"><Loader2 size={18} className="inline animate-spin" /> Loading sub-categories…</div>;

  return (
    <div className="space-y-3" data-testid="cms-l2-editor">
      <div>
        <h3 className="font-display text-lg font-bold text-[#0A1F5C]">L2 Sub-Categories</h3>
        <p className="text-[11px] text-[#64748B]">Sub-categories shown on L1 landing pages (e.g. /c/men → Shirts, Jeans). Changes here reflect wherever L2 tiles are rendered.</p>
      </div>

      {l1.map((parent) => {
        const subs = l2.filter((s) => s.l1_id === parent.id);
        if (subs.length === 0) return null;
        const isOpen = openId === parent.id;
        return (
          <div key={parent.id} className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : parent.id)}
              data-testid={`cms-l2-group-${parent.slug}`}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#FDFBF7]"
            >
              <span className="flex items-center gap-2 font-semibold text-[#0A1F5C] text-sm">
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {parent.name}
                <span className="text-[10px] font-normal text-[#94A3B8]">({subs.length} sub-categories)</span>
              </span>
            </button>
            {isOpen && (
              <div className="px-4 pb-4 space-y-3 border-t border-[#F1F5F9] pt-4">
                {subs.map((s) => (
                  <div key={s.id} data-testid={`cms-l2-row-${s.id}`} className="border border-[#E5E2DC] rounded-xl p-3 grid grid-cols-1 lg:grid-cols-[140px_1fr_auto] gap-3 items-start">
                    <ImageUploadField
                      label={s.name} recommended="600×600"
                      value={s.image || ""} onChange={(v) => patch(s.id, { image: v })}
                      testid={`cms-l2-image-${s.id}`}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <label className="block">
                        <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Name</span>
                        <input
                          type="text" value={s.name} onChange={(e) => patch(s.id, { name: e.target.value })}
                          data-testid={`cms-l2-name-${s.id}`}
                          className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none"
                        />
                      </label>
                      <div>
                        <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C] mb-1 block">Redirect URL</span>
                        <DestinationPicker
                          value={s.redirect_url || ""} onChange={(v) => patch(s.id, { redirect_url: v })}
                          testid={`cms-l2-redirect-${s.id}`}
                          placeholder={`Default: /c/${s.slug}`}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => save(s)} disabled={!dirty[s.id] || busy[s.id]}
                      data-testid={`cms-l2-save-${s.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0A1F5C] text-white text-[11px] font-bold disabled:opacity-40 self-start"
                    >
                      {busy[s.id] ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                      {busy[s.id] ? "Saving…" : dirty[s.id] ? "Save" : "Saved"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
