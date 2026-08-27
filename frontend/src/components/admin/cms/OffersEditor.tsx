"use client";

/**
 * Offers editor — full CRUD with image upload, destination picker,
 * enable/disable toggle, reorder, and per-row publish.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Save, Loader2, Eye, EyeOff, ChevronUp, ChevronDown, Trash2, Plus, Search, X, Store as StoreIcon } from "lucide-react";
import { adminApi, type AdminStoreSearchResult } from "@/lib/api/admin";
import { catalogApi } from "@/lib/api";
import { ImageUploadField } from "./ImageUploadField";
import { DestinationPicker } from "./DestinationPicker";
import type { CmsOffer, CategoryNode } from "@/types";

const BLANK_OFFER: Partial<CmsOffer> = {
  title: "New offer", subtitle: "", image: "", eyebrow: "",
  cta_label: "Shop now", cta_link: "", redirect_url: "",
  background: "#0A1F5C", rank: 100, published: false,
  kind: "banner", aspect_ratio: "21:9", placement: null, store_id: null,
};

const ASPECT_RATIO_OPTIONS: Array<CmsOffer["aspect_ratio"]> = ["21:9", "16:9", "3:1", "4:3"];

export function OffersEditor() {
  const [rows, setRows] = useState<CmsOffer[] | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [l1s, setL1s] = useState<CategoryNode[]>([]);
  const [storeNames, setStoreNames] = useState<Record<string, string>>({});

  const reload = () => adminApi.listOffers().then(setRows).catch((e) => toast.error(String(e)));
  useEffect(() => { void reload(); }, []);
  useEffect(() => { catalogApi.categories().then(setL1s).catch(() => setL1s([])); }, []);
  useEffect(() => {
    adminApi.searchStores("").then((rows) => {
      setStoreNames((c) => ({ ...c, ...Object.fromEntries(rows.map((r) => [r.id, r.name])) }));
    }).catch(() => {});
  }, []);

  const patch = (id: string, p: Partial<CmsOffer>) => {
    setRows((r) => r?.map((o) => o.id === id ? { ...o, ...p } : o) || null);
    setDirty((d) => ({ ...d, [id]: true }));
  };

  const save = async (row: CmsOffer) => {
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      const r = await adminApi.updateOffer(row.id, {
        title: row.title, subtitle: row.subtitle, image: row.image, eyebrow: row.eyebrow || "",
        cta_label: row.cta_label, cta_link: row.cta_link, redirect_url: row.redirect_url || "",
        background: row.background, rank: row.rank, published: row.published,
        paused: !!row.paused, non_clickable: !!row.non_clickable,
        kind: row.kind || "banner", aspect_ratio: row.aspect_ratio || "21:9",
        placement: row.placement ?? null, starts_at: row.starts_at ?? null,
        expires_at: row.expires_at ?? null, store_id: row.store_id ?? null,
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
          <h3 className="font-display text-lg font-bold text-[#0A1F5C]">Offers &amp; communication strip</h3>
          <p className="text-[11px] text-[#64748B]">Ad-hoc banners and the thin text strip near the hero — set Type, Show on and optional dates per row.</p>
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
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Eyebrow / event name</span>
                  <input type="text" value={o.eyebrow || ""} onChange={(e) => patch(o.id, { eyebrow: e.target.value })}
                    placeholder="Limited time"
                    data-testid={`cms-offer-eyebrow-${o.id}`}
                    className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none" />
                </label>
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
              {/* P0-6/P0-7 (G20 product review) — kind, placement,
                  aspect-ratio preset (banner only) and optional scheduling
                  window. Same fields power both the thin communication
                  strip and ad-hoc image banners; only `kind` decides
                  which one a given row renders as on the consumer app. */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-[#F1F5F9]">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Type</span>
                  <select value={o.kind || "banner"} onChange={(e) => patch(o.id, { kind: e.target.value as CmsOffer["kind"] })}
                    data-testid={`cms-offer-kind-${o.id}`}
                    className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none">
                    <option value="banner">Banner (image)</option>
                    <option value="strip">Strip (text only)</option>
                    <option value="bento">Bento (large campaign)</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Show on</span>
                  <select value={o.placement ?? ""} onChange={(e) => patch(o.id, { placement: e.target.value || null })}
                    data-testid={`cms-offer-placement-${o.id}`}
                    className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none">
                    <option value="">Everywhere</option>
                    <option value="global">Marketplace only</option>
                    {l1s.map((c) => <option key={c.id} value={c.id}>{c.name} only</option>)}
                  </select>
                </label>
                {(o.kind || "banner") !== "strip" && (
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Aspect ratio</span>
                    <select value={o.aspect_ratio || "21:9"} onChange={(e) => patch(o.id, { aspect_ratio: e.target.value as CmsOffer["aspect_ratio"] })}
                      data-testid={`cms-offer-aspect-${o.id}`}
                      className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none">
                      {ASPECT_RATIO_OPTIONS.map((ar) => <option key={ar} value={ar}>{ar}</option>)}
                    </select>
                  </label>
                )}
                <div className="col-span-2 sm:col-span-4">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C] mb-1 block">Store campaign (optional — this store&apos;s page only)</span>
                  <OfferStorePicker
                    storeId={o.store_id ?? null}
                    storeName={o.store_id ? (storeNames[o.store_id] || o.store_id) : ""}
                    onChange={(id, name) => {
                      patch(o.id, { store_id: id });
                      if (id && name) setStoreNames((c) => ({ ...c, [id]: name }));
                    }}
                    testid={`cms-offer-store-${o.id}`}
                  />
                </div>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Starts</span>
                  <input type="date" value={o.starts_at ? o.starts_at.slice(0, 10) : ""}
                    onChange={(e) => patch(o.id, { starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                    data-testid={`cms-offer-starts-${o.id}`}
                    className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none" />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Ends</span>
                  <input type="date" value={o.expires_at ? o.expires_at.slice(0, 10) : ""}
                    onChange={(e) => patch(o.id, { expires_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                    data-testid={`cms-offer-expires-${o.id}`}
                    className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none" />
                </label>
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

/** G21 P1-9 — inline store search + pick/clear, same debounced
 *  GET /admin/stores/search backing StoreSectionsEditor's picker, kept
 *  local (not a shared export) since this is a single-field inline use,
 *  not a modal flow. Clearing sends store_id back to null, i.e. this
 *  offer reverts to Marketplace/L1 `placement` scoping only. */
function OfferStorePicker({
  storeId, storeName, onChange, testid,
}: {
  storeId: string | null;
  storeName: string;
  onChange: (id: string | null, name?: string) => void;
  testid: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AdminStoreSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(() => {
      adminApi.searchStores(q)
        .then((r) => { if (!cancelled) setResults(r); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setBusy(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  if (!open) {
    return (
      <div className="flex items-center gap-2" data-testid={testid}>
        {storeId ? (
          <>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0A1F5C]/5 text-[#0A1F5C] text-[12px] font-semibold truncate max-w-[220px]">
              <StoreIcon size={12} className="shrink-0" /> {storeName}
            </span>
            <button type="button" onClick={() => setOpen(true)}
              data-testid={`${testid}-change`}
              className="text-[11px] font-semibold text-[#0A1F5C] underline">Change</button>
            <button type="button" onClick={() => onChange(null)}
              data-testid={`${testid}-clear`}
              className="text-[11px] text-[#94A3B8] inline-flex items-center gap-0.5"><X size={11} /> Clear</button>
          </>
        ) : (
          <button type="button" onClick={() => setOpen(true)}
            data-testid={`${testid}-open`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-[#E5E2DC] text-[#64748B] text-[12px]">
            <Search size={12} /> Pick a store…
          </button>
        )}
      </div>
    );
  }

  return (
    <div data-testid={testid}>
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#0A1F5C] bg-white">
        <Search size={13} className="text-[#94A3B8] shrink-0" />
        <input
          ref={inputRef}
          type="text" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search stores by name…"
          data-testid={`${testid}-input`}
          className="flex-1 text-[12px] outline-none min-w-0"
        />
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="shrink-0 text-[#94A3B8]"><X size={12} /></button>
      </div>
      <div className="mt-2 max-h-48 overflow-y-auto space-y-1 border border-[#E5E2DC] rounded-xl p-1.5 bg-white">
        {busy && <div className="text-[11px] text-[#94A3B8] px-2 py-1.5 inline-flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Searching…</div>}
        {!busy && results.length === 0 && (
          <div className="text-[11px] text-[#94A3B8] px-2 py-1.5">No stores match.</div>
        )}
        {!busy && results.map((s) => (
          <button
            key={s.id} type="button"
            onClick={() => { onChange(s.id, s.name); setOpen(false); setQ(""); }}
            data-testid={`${testid}-result-${s.id}`}
            className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[#FDFBF7] text-left"
          >
            <div className="relative w-8 h-8 rounded-lg overflow-hidden bg-[#F4F1E9] shrink-0">
              {s.image && <img src={s.image} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-[#0A1F5C] truncate">{s.name}</div>
              {s.area && <div className="text-[10px] text-[#94A3B8] truncate">{s.area}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
