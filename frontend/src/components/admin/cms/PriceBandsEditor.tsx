"use client";

/**
 * Price bands editor — image override per homepage price-bento tile
 * ("Under ₹499" / "Under ₹999" / "Under ₹1,499" / "Premium"). Saves per-row
 * via PUT /api/admin/price-bands/{id}. Mirrors AreasEditor.tsx's
 * image-upload + save pattern; unlike areas, label/slug/order are fixed by
 * the band definitions — only the image is admin-editable. Leave the image
 * empty to fall back to the cheapest visible product's photo in that band.
 *
 * G13 §10 — Global / Women / Men / Kids surface tabs. Same 4 bands, same
 * endpoint, same ImageUploadField — only which field gets written differs
 * (top-level `image` for Global, `l1_overrides.<slug>` for an L1 tab). Not
 * a second CMS system: one `price_bands` doc per band, one editor, reusing
 * the exact upload-from-URL flow ImageUploadField already provides.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import { ImageUploadField } from "./ImageUploadField";
import type { CmsPriceBand } from "@/types";

const SURFACES = [
  { key: "global" as const, label: "Global" },
  { key: "women" as const, label: "Women" },
  { key: "men" as const, label: "Men" },
  { key: "kids" as const, label: "Kids" },
];
type SurfaceKey = (typeof SURFACES)[number]["key"];

/** Reads the value this surface tab is currently editing — the global
 *  top-level `image`, or that L1's own `l1_overrides` entry. */
function valueFor(row: CmsPriceBand, surface: SurfaceKey): string {
  if (surface === "global") return row.image || "";
  return row.l1_overrides?.[surface] || "";
}

export function PriceBandsEditor() {
  const [rows, setRows] = useState<CmsPriceBand[] | null>(null);
  const [surface, setSurface] = useState<SurfaceKey>("global");
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    adminApi.listPriceBands().then(setRows).catch((e) => toast.error(String(e)));
  }, []);

  const dirtyKey = (id: string) => `${surface}:${id}`;

  const patch = (id: string, value: string) => {
    setRows((r) => r?.map((b) => {
      if (b.id !== id) return b;
      if (surface === "global") return { ...b, image: value };
      return { ...b, l1_overrides: { ...b.l1_overrides, [surface]: value } };
    }) || null);
    setDirty((d) => ({ ...d, [dirtyKey(id)]: true }));
  };

  const save = async (row: CmsPriceBand) => {
    const key = dirtyKey(row.id);
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      const value = valueFor(row, surface);
      const updated = surface === "global"
        ? await adminApi.updatePriceBand(row.id, { image: value })
        : await adminApi.updatePriceBand(row.id, { image: value, l1: surface });
      setRows((r) => r?.map((b) => b.id === row.id ? updated : b) || null);
      setDirty((d) => { const n = { ...d }; delete n[key]; return n; });
      toast.success(`${row.label} (${SURFACES.find((s) => s.key === surface)?.label}) updated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  if (!rows) return <div className="p-6 text-center text-sm text-[#64748B]"><Loader2 size={18} className="inline animate-spin" /> Loading price bands…</div>;

  return (
    <div className="space-y-4" data-testid="cms-price-bands-editor">
      <div>
        <h3 className="font-display font-medium text-lg text-[#0A1F5C]">Picks for Every Budget images</h3>
        <p className="text-[11px] text-[#64748B]">
          The 4 price-filter tiles shown on Marketplace and each L1 page. Set an image to
          override the auto-picked photo (the cheapest — or, for Premium, priciest — in-stock
          product in that range) — leave empty to keep auto-pull.
        </p>
      </div>

      {/* Surface tabs — always visible so the admin knows exactly which
          surface they're editing before touching an image field. */}
      <div className="inline-flex rounded-full bg-[#F4F1E9] p-1" data-testid="cms-price-bands-surface-tabs">
        {SURFACES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSurface(s.key)}
            data-testid={`cms-price-bands-tab-${s.key}`}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition ${surface === s.key ? "bg-[#0A1F5C] text-white" : "text-[#0A1F5C]/60 hover:text-[#0A1F5C]"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-[#94A3B8]" data-testid="cms-price-bands-fallback-note">
        {surface === "global"
          ? "This is the Marketplace / default image, and the fallback every L1 tab uses when it has no override of its own."
          : `Falls back to the Global image above, then to a real product photo, if no ${SURFACES.find((s) => s.key === surface)?.label} override is set here.`}
      </p>

      <div className="space-y-3">
        {rows.map((b) => {
          const value = valueFor(b, surface);
          const key = dirtyKey(b.id);
          return (
            <div key={b.id} data-testid={`cms-price-band-row-${b.slug}-${surface}`} className="bg-white border border-[#E5E2DC] rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-[180px_1fr_auto] gap-4 items-start">
              <ImageUploadField
                label={`${b.label} image`} recommended="600×450"
                value={value} onChange={(v) => patch(b.id, v)}
                testid={`cms-price-band-image-${b.slug}-${surface}`}
              />
              <div>
                <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Label</span>
                <div className="mt-1 text-sm font-semibold text-[#0A1F5C]">{b.label}</div>
                <div className="mt-2 flex items-center gap-3 text-[10px] text-[#94A3B8]">
                  <span className="font-mono">slug: {b.slug}</span>
                  <span>{value ? "Override set for this surface" : "No override — using fallback (see note above)"}</span>
                </div>
              </div>
              <button
                onClick={() => save(b)} disabled={!dirty[key] || busy[key]}
                data-testid={`cms-price-band-save-${b.slug}-${surface}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-bold disabled:opacity-40 self-start"
              >
                {busy[key] ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {busy[key] ? "Saving…" : dirty[key] ? "Save" : "Saved"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
