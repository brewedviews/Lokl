"use client";

/**
 * Offers editor — full CRUD with image upload, destination picker,
 * enable/disable toggle, reorder, and per-row publish.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Loader2, Eye, EyeOff, ChevronUp, ChevronDown, Trash2, Plus } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import { ImageUploadField } from "./ImageUploadField";
import { DestinationPicker } from "./DestinationPicker";
import type { CmsOffer } from "@/types";

const BLANK_OFFER: Partial<CmsOffer> = {
  title: "New offer", subtitle: "", image: "",
  cta_label: "Shop now", cta_link: "", redirect_url: "",
  background: "#0A1F5C", rank: 100, published: false,
};

export function OffersEditor() {
  const [rows, setRows] = useState<CmsOffer[] | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const reload = () => adminApi.listOffers().then(setRows).catch((e) => toast.error(String(e)));
  useEffect(() => { void reload(); }, []);

  const patch = (id: string, p: Partial<CmsOffer>) => {
    setRows((r) => r?.map((o) => o.id === id ? { ...o, ...p } : o) || null);
    setDirty((d) => ({ ...d, [id]: true }));
  };

  const save = async (row: CmsOffer) => {
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      const r = await adminApi.updateOffer(row.id, {
        title: row.title, subtitle: row.subtitle, image: row.image,
        cta_label: row.cta_label, cta_link: row.cta_link, redirect_url: row.redirect_url || "",
        background: row.background, rank: row.rank, published: row.published,
        paused: !!row.paused, non_clickable: !!row.non_clickable,
      });
      setRows((rs) => rs?.map((o) => o.id === row.id ? r : o) || null);
      setDirty((d) => { const n = { ...d }; delete n[row.id]; return n; });
      toast.success(`${row.title} published`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  };

  const togglePublished = async (row: CmsOffer) => {
    await adminApi.updateOffer(row.id, { published: !row.published });
    await reload();
    toast.success(!row.published ? "Offer enabled" : "Offer disabled");
  };

  const move = async (row: CmsOffer, dir: -1 | 1) => {
    if (!rows) return;
    const sorted = [...rows].sort((a, b) => a.rank - b.rank);
    const idx = sorted.findIndex((o) => o.id === row.id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    const a = sorted[idx];
    if (!a) return;
    const [r1, r2] = [a.rank, swap.rank];
    await Promise.all([
      adminApi.updateOffer(a.id, { rank: r2 }),
      adminApi.updateOffer(swap.id, { rank: r1 }),
    ]);
    await reload();
  };

  const createNew = async () => {
    try {
      const created = await adminApi.createOffer(BLANK_OFFER);
      await reload();
      toast.success(`Created — drag it to the front via rank, edit & publish.`);
      setDirty((d) => ({ ...d, [created.id]: true }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    }
  };

  const remove = async (row: CmsOffer) => {
    if (!confirm(`Delete offer "${row.title}"? This cannot be undone.`)) return;
    await adminApi.deleteOffer(row.id);
    await reload();
    toast.success("Offer deleted");
  };

  if (!rows) return <div className="p-6 text-center text-sm text-[#64748B]"><Loader2 size={18} className="inline animate-spin" /> Loading offers…</div>;

  const sorted = [...rows].sort((a, b) => a.rank - b.rank);

  return (
    <div className="space-y-4" data-testid="cms-offers-editor">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-bold text-[#0A1F5C]">Offer banners</h3>
          <p className="text-[11px] text-[#64748B]">Limited-time campaigns shown in the homepage offers rail.</p>
        </div>
        <button
          onClick={createNew}
          data-testid="cms-offer-create"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-bold"
        >
          <Plus size={12} /> New offer
        </button>
      </div>

      <div className="space-y-3">
        {sorted.map((o, i) => (
          <div key={o.id} data-testid={`cms-offer-row-${o.id}`} className={`bg-white border border-[#E5E2DC] rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-[260px_1fr_auto] gap-4 items-start transition-opacity ${o.paused ? "opacity-50" : ""}`}>
            <ImageUploadField
              label={o.title} recommended="1200×675"
              value={o.image || ""} onChange={(v) => patch(o.id, { image: v })}
              testid={`cms-offer-image-${o.id}`}
            />
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Title</span>
                  <input type="text" value={o.title} onChange={(e) => patch(o.id, { title: e.target.value })}
                    data-testid={`cms-offer-title-${o.id}`}
                    className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none" />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Subtitle</span>
                  <input type="text" value={o.subtitle || ""} onChange={(e) => patch(o.id, { subtitle: e.target.value })}
                    data-testid={`cms-offer-subtitle-${o.id}`}
                    className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none" />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">CTA label</span>
                  <input type="text" value={o.cta_label || ""} onChange={(e) => patch(o.id, { cta_label: e.target.value })}
                    data-testid={`cms-offer-cta-${o.id}`}
                    className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none" />
                </label>
                <div>
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C] mb-1 block">Redirect URL</span>
                  <DestinationPicker
                    value={o.redirect_url || o.cta_link || ""} onChange={(v) => patch(o.id, { redirect_url: v })}
                    testid={`cms-offer-redirect-${o.id}`}
                    placeholder="/offers/festive-sale or /c/women"
                  />
                </div>
              </div>
              {/* iter-27 (Item 7) — paused + non-clickable toggles */}
              <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-[#F1F5F9]">
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] font-semibold text-[#0A1F5C]">
                  <input
                    type="checkbox" checked={!!o.non_clickable}
                    onChange={(e) => patch(o.id, { non_clickable: e.target.checked })}
                    data-testid={`cms-offer-nonclick-${o.id}`}
                    className="h-3.5 w-3.5 accent-[#0A1F5C]"
                  />
                  Make non-clickable
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] font-semibold text-[#0A1F5C]">
                  <input
                    type="checkbox" checked={!!o.paused}
                    onChange={(e) => patch(o.id, { paused: e.target.checked })}
                    data-testid={`cms-offer-paused-${o.id}`}
                    className="h-3.5 w-3.5 accent-[#0A1F5C]"
                  />
                  Paused
                </label>
                {o.paused && (
                  <span className="px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E] text-[10px] font-bold uppercase tracking-wider">Hidden from customers</span>
                )}
              </div>
            </div>
            <div className="flex lg:flex-col items-center gap-2">
              <div className="flex flex-col gap-1">
                <button onClick={() => move(o, -1)} disabled={i === 0}
                  data-testid={`cms-offer-up-${o.id}`}
                  className="w-7 h-6 rounded bg-white border border-[#E5E2DC] disabled:opacity-30 flex items-center justify-center"><ChevronUp size={12} /></button>
                <button onClick={() => move(o, 1)} disabled={i === sorted.length - 1}
                  data-testid={`cms-offer-down-${o.id}`}
                  className="w-7 h-6 rounded bg-white border border-[#E5E2DC] disabled:opacity-30 flex items-center justify-center"><ChevronDown size={12} /></button>
              </div>
              <button onClick={() => togglePublished(o)}
                data-testid={`cms-offer-toggle-${o.id}`}
                className={`px-3 py-1.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${o.published ? "bg-[#4F7363] text-white" : "bg-white border border-[#E5E2DC] text-[#94A3B8]"}`}>
                {o.published ? <><Eye size={11} /> LIVE</> : <><EyeOff size={11} /> OFF</>}
              </button>
              <button onClick={() => save(o)} disabled={!dirty[o.id] || busy[o.id]}
                data-testid={`cms-offer-save-${o.id}`}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#0A1F5C] text-white text-[11px] font-bold disabled:opacity-40">
                {busy[o.id] ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
              </button>
              <button onClick={() => remove(o)}
                data-testid={`cms-offer-delete-${o.id}`}
                className="w-7 h-7 rounded-full bg-white border border-[#FCA5A5] text-[#DC2626] flex items-center justify-center"><Trash2 size={11} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
