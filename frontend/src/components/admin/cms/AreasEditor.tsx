"use client";

/**
 * Areas editor — image + name per featured Bhilai area, for the homepage
 * "Shop by Area" section. Saves per-row via PUT /api/admin/areas/{id}.
 * Mirrors L1CategoriesEditor.tsx (same image-upload + save pattern);
 * areas don't need a redirect picker since they always link to
 * /stores?area={slug}.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import { ImageUploadField } from "./ImageUploadField";
import type { CmsArea } from "@/types";

export function AreasEditor() {
  const [rows, setRows] = useState<CmsArea[] | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    adminApi.listAreas().then(setRows).catch((e) => toast.error(String(e)));
  }, []);

  const patch = (id: string, p: Partial<CmsArea>) => {
    setRows((r) => r?.map((a) => a.id === id ? { ...a, ...p } : a) || null);
    setDirty((d) => ({ ...d, [id]: true }));
  };

  const save = async (row: CmsArea) => {
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      const updated = await adminApi.updateArea(row.id, {
        name: row.name,
        image: row.image,
      });
      setRows((r) => r?.map((a) => a.id === row.id ? updated : a) || null);
      setDirty((d) => { const n = { ...d }; delete n[row.id]; return n; });
      toast.success(`${row.name} updated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  };

  if (!rows) return <div className="p-6 text-center text-sm text-[#64748B]"><Loader2 size={18} className="inline animate-spin" /> Loading areas…</div>;

  return (
    <div className="space-y-4" data-testid="cms-areas-editor">
      <div>
        <h3 className="font-display text-lg font-bold text-[#0A1F5C]">Shop by Area</h3>
        <p className="text-[11px] text-[#64748B]">The 6 area tiles on the homepage. Each links to /stores?area={"{slug}"} — set an image per area; store counts update automatically.</p>
      </div>

      <div className="space-y-3">
        {rows.map((a) => (
          <div key={a.id} data-testid={`cms-area-row-${a.slug}`} className="bg-white border border-[#E5E2DC] rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-[180px_1fr_auto] gap-4 items-start">
            <ImageUploadField
              label={`${a.name} image`} recommended="600×600"
              value={a.image || ""} onChange={(v) => patch(a.id, { image: v })}
              testid={`cms-area-image-${a.slug}`}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Name</span>
                <input
                  type="text" value={a.name} onChange={(e) => patch(a.id, { name: e.target.value })}
                  data-testid={`cms-area-name-${a.slug}`}
                  className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none"
                />
              </label>
              <div className="sm:col-span-2 flex items-center gap-3 text-[10px] text-[#94A3B8]">
                <span className="font-mono">slug: {a.slug}</span>
                <span>order: {a.order ?? "—"}</span>
              </div>
            </div>
            <button
              onClick={() => save(a)} disabled={!dirty[a.id] || busy[a.id]}
              data-testid={`cms-area-save-${a.slug}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-bold disabled:opacity-40 self-start"
            >
              {busy[a.id] ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {busy[a.id] ? "Saving…" : dirty[a.id] ? "Save" : "Saved"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
