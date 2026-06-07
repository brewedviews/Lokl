"use client";

/**
 * Admin Homepage CMS tab.
 *
 * Backend: GET/PUT /api/admin/site/homepage-config — shape is
 *   { id:"homepage", sections:[{id,label,enabled,rank}], hero:{...} }
 *
 * UI parts (per the iter-26 content-management spec):
 *   • Section order/visibility — up/down + toggle, no DnD (mobile-safe)
 *   • Hero banner editor — image url, headline, subheadline, CTAs
 *   • Text overrides — labels + empty-state strings (in hero block)
 *
 * Category-tiles + offers cards remain admin-DB-driven (existing /admin
 * Offers tab + auto-derived L1 tiles). Adding bespoke CMS fields for them
 * is a future enhancement — out of scope for this session.
 */
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, ChevronUp, ChevronDown, Save, Loader2 } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import type { HomepageConfig } from "@/types";

interface Section { id: string; label: string; enabled: boolean; rank: number }
interface Hero { image?: string; eyebrow?: string; title_line1?: string; title_line2?: string; subtitle?: string; cta_primary_label?: string; cta_primary_link?: string; cta_secondary_label?: string; cta_secondary_link?: string }

export function CmsTab() {
  const [cfg, setCfg] = useState<HomepageConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try { setCfg(await adminApi.getHomepageConfig()); setDirty(false); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!cfg) return;
    setBusy(true);
    try {
      const saved = await adminApi.saveHomepageConfig(cfg);
      setCfg(saved); setDirty(false);
      toast.success("Homepage published — customers see changes within 60s");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const updateSection = (id: string, patch: Partial<Section>) => {
    if (!cfg) return;
    const sections = (cfg.sections as Section[]).map((s) =>
      s.id === id ? { ...s, ...patch } : s,
    );
    setCfg({ ...cfg, sections }); setDirty(true);
  };

  const move = (id: string, dir: -1 | 1) => {
    if (!cfg) return;
    const list = ([...(cfg.sections as Section[])]).sort((a, b) => a.rank - b.rank);
    const idx = list.findIndex((s) => s.id === id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= list.length) return;
    const a = list[idx];
    const b = list[next];
    if (!a || !b) return;
    list[idx] = b;
    list[next] = a;
    list.forEach((s, i) => { s.rank = i + 1; });
    setCfg({ ...cfg, sections: list }); setDirty(true);
  };

  const updateHero = (patch: Partial<Hero>) => {
    if (!cfg) return;
    setCfg({ ...cfg, hero: { ...(cfg.hero || {}), ...patch } as Hero }); setDirty(true);
  };

  if (!cfg) {
    return <div className="text-center py-16 text-text-secondary"><Loader2 size={24} className="animate-spin inline" /> Loading CMS…</div>;
  }

  const sections = ([...((cfg.sections as Section[]) || [])]).sort((a, b) => a.rank - b.rank);
  const hero = (cfg.hero || {}) as Hero;

  return (
    <div data-testid="cms-panel" className="space-y-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Homepage CMS</h2>
          <p className="text-xs text-[#595959] mt-1">Reorder sections, edit the hero banner, and publish live to all customers.</p>
        </div>
        <button
          onClick={save} disabled={!dirty || busy}
          data-testid="cms-save"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold bg-[#0A1F5C] text-white disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {busy ? "Publishing…" : (dirty ? "Publish changes" : "Saved")}
        </button>
      </div>

      {/* ─── Section order/visibility ─────────────────────────────── */}
      <section className="bg-white border border-[#E5E2DC] rounded-2xl p-5">
        <div className="text-[10px] uppercase tracking-widest text-[#595959] mb-3">Section order & visibility</div>
        <ul className="space-y-2">
          {sections.map((s, i) => (
            <li key={s.id} data-testid={`cms-section-${s.id}`}
                className="flex items-center gap-3 px-3 py-2 rounded-xl border border-[#E5E2DC] bg-[#FDFBF7]">
              <div className="flex flex-col gap-0.5">
                <button onClick={() => move(s.id, -1)} disabled={i === 0}
                  data-testid={`cms-up-${s.id}`}
                  className="w-6 h-5 rounded bg-white border border-[#E5E2DC] disabled:opacity-30 flex items-center justify-center"><ChevronUp size={12} /></button>
                <button onClick={() => move(s.id, 1)} disabled={i === sections.length - 1}
                  data-testid={`cms-down-${s.id}`}
                  className="w-6 h-5 rounded bg-white border border-[#E5E2DC] disabled:opacity-30 flex items-center justify-center"><ChevronDown size={12} /></button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[#0A1F5C]">{s.label}</div>
                <div className="text-[10px] text-[#595959]">rank {s.rank} · id {s.id}</div>
              </div>
              <button
                onClick={() => updateSection(s.id, { enabled: !s.enabled })}
                data-testid={`cms-toggle-${s.id}`}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold inline-flex items-center gap-1 ${s.enabled ? "bg-[#4F7363] text-white" : "bg-white border border-[#E5E2DC] text-[#595959]"}`}>
                {s.enabled ? <><Eye size={12} /> Visible</> : <><EyeOff size={12} /> Hidden</>}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* ─── Hero banner editor ──────────────────────────────────── */}
      <section className="bg-white border border-[#E5E2DC] rounded-2xl p-5">
        <div className="text-[10px] uppercase tracking-widest text-[#595959] mb-3">Hero banner</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Image URL"        v={hero.image || ""}              onChange={(v) => updateHero({ image: v })} testid="cms-hero-image" full />
          <Field label="Eyebrow"          v={hero.eyebrow || ""}            onChange={(v) => updateHero({ eyebrow: v })} testid="cms-hero-eyebrow" />
          <Field label="Subtitle"         v={hero.subtitle || ""}           onChange={(v) => updateHero({ subtitle: v })} testid="cms-hero-subtitle" />
          <Field label="Title line 1"     v={hero.title_line1 || ""}        onChange={(v) => updateHero({ title_line1: v })} testid="cms-hero-title1" />
          <Field label="Title line 2"     v={hero.title_line2 || ""}        onChange={(v) => updateHero({ title_line2: v })} testid="cms-hero-title2" />
          <Field label="Primary CTA label" v={hero.cta_primary_label || ""} onChange={(v) => updateHero({ cta_primary_label: v })} testid="cms-hero-cta1-label" />
          <Field label="Primary CTA link"  v={hero.cta_primary_link || ""}  onChange={(v) => updateHero({ cta_primary_link: v })} testid="cms-hero-cta1-link" />
          <Field label="Secondary CTA label" v={hero.cta_secondary_label || ""} onChange={(v) => updateHero({ cta_secondary_label: v })} testid="cms-hero-cta2-label" />
          <Field label="Secondary CTA link"  v={hero.cta_secondary_link || ""}  onChange={(v) => updateHero({ cta_secondary_link: v })} testid="cms-hero-cta2-link" />
        </div>
        {hero.image && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-widest text-[#595959] mb-1">Preview</div>
            { /* eslint-disable-next-line @next/next/no-img-element */ }
            <img src={hero.image} alt="Hero preview" className="w-full h-32 object-cover rounded-xl border border-[#E5E2DC]" />
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, v, onChange, testid, full }: { label: string; v: string; onChange: (v: string) => void; testid: string; full?: boolean }) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="text-[10px] uppercase tracking-widest text-[#595959]">{label}</span>
      <input
        type="text" value={v} onChange={(e) => onChange(e.target.value)} data-testid={testid}
        className="mt-1 w-full px-3 py-2 rounded-xl border border-[#E5E2DC] bg-[#FDFBF7] text-sm focus:bg-white focus:border-[#0A1F5C] outline-none"
      />
    </label>
  );
}
