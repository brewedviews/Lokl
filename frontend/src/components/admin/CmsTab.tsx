"use client";

/**
 * Admin → CMS → Homepage Assets parent tab.
 *
 * Sub-tabs: Sections (order + on/off for every homepage section — see
 * SectionsPanel below), Hero banner, L1 Categories, L2 Sub-cats, Areas,
 * Price bands, Try & Buy, Offers.
 *
 * Sections is the default/first tab and is fully load-bearing: its saves
 * go to site_config.homepage.sections via PUT /api/admin/site/homepage-
 * config, which HomeClient.tsx now treats as authoritative for section
 * order/visibility (previously the frontend's local rank silently
 * overrode whatever was saved here, so this panel edited a document with
 * no real effect — fixed alongside this comment).
 */
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, ChevronUp, ChevronDown, Save, Loader2, LayoutTemplate, Image as ImgIcon, Folder, Layers, Sparkles, MapPin, Tag, RotateCcw } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import { HeroEditor } from "@/components/admin/cms/HeroEditor";
import { L1CategoriesEditor } from "@/components/admin/cms/L1CategoriesEditor";
import { L2SubcategoriesEditor } from "@/components/admin/cms/L2SubcategoriesEditor";
import { AreasEditor } from "@/components/admin/cms/AreasEditor";
import { PriceBandsEditor } from "@/components/admin/cms/PriceBandsEditor";
import { TryAndBuyEditor } from "@/components/admin/cms/TryAndBuyEditor";
import { OffersEditor } from "@/components/admin/cms/OffersEditor";
import { TopClicksWidget } from "@/components/admin/cms/TopClicksWidget";
import type { HomepageConfig } from "@/types";

interface Section { id: string; label: string; enabled: boolean; rank: number }

type SubTab = "sections" | "hero" | "l1" | "l2" | "areas" | "price_bands" | "try_and_buy" | "offers";

const SUB_TABS: { id: SubTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "sections",     label: "Sections",      icon: LayoutTemplate },
  { id: "hero",         label: "Hero banner",   icon: ImgIcon },
  { id: "l1",           label: "L1 Categories", icon: Folder },
  { id: "l2",           label: "L2 Sub-cats",   icon: Layers },
  { id: "areas",        label: "Areas",         icon: MapPin },
  { id: "price_bands",  label: "Price bands",   icon: Tag },
  { id: "try_and_buy",  label: "Try & Buy",     icon: RotateCcw },
  { id: "offers",       label: "Offers",        icon: Sparkles },
];

export function CmsTab() {
  const [tab, setTab] = useState<SubTab>("sections");

  return (
    <div data-testid="cms-panel" className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Homepage Assets</h2>
        <p className="text-xs text-[#595959] mt-1">Manage every CMS-driven element of the consumer homepage — no engineering required.</p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-[#E5E2DC]" data-testid="cms-subtabs">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} data-testid={`cms-subtab-${t.id}`}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 ${active ? "border-[#E68910] text-[#0A1F5C]" : "border-transparent text-[#94A3B8] hover:text-[#0A1F5C]"}`}>
              <Icon size={12} /> {t.label}
            </button>
          );
        })}
      </nav>

      <div>
        {tab === "sections" && <SectionsPanel />}
        {tab === "hero"     && <HeroEditor />}
        {tab === "l1"       && <L1CategoriesEditor />}
        {tab === "l2"       && <L2SubcategoriesEditor />}
        {tab === "areas"       && <AreasEditor />}
        {tab === "price_bands" && <PriceBandsEditor />}
        {tab === "try_and_buy" && <TryAndBuyEditor />}
        {tab === "offers"      && <OffersEditor />}
      </div>

      <TopClicksWidget />
    </div>
  );
}

// ─── Section order/visibility panel — reorder (up/down) + on/off toggle
// for every homepage section, saved to site_config.homepage.sections.
// This IS what controls the live homepage order now (see the merge fix
// in HomeClient.tsx's homepageConfig fetch effect). ───
function SectionsPanel() {
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
      toast.success("Sections published — customers see changes within 60s");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const updateSection = (id: string, patch: Partial<Section>) => {
    if (!cfg) return;
    const sections = (cfg.sections as Section[]).map((s) => s.id === id ? { ...s, ...patch } : s);
    setCfg({ ...cfg, sections }); setDirty(true);
  };

  const move = (id: string, dir: -1 | 1) => {
    if (!cfg) return;
    const list = [...(cfg.sections as Section[])].sort((a, b) => a.rank - b.rank);
    const idx = list.findIndex((s) => s.id === id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= list.length) return;
    const a = list[idx]; const b = list[next];
    if (!a || !b) return;
    list[idx] = b; list[next] = a;
    list.forEach((s, i) => { s.rank = (i + 1) * 10; });
    setCfg({ ...cfg, sections: list }); setDirty(true);
  };

  if (!cfg) return <div className="p-6 text-center text-sm text-[#64748B]"><Loader2 size={18} className="inline animate-spin" /> Loading…</div>;
  const sections = [...((cfg.sections as Section[]) || [])].sort((a, b) => a.rank - b.rank);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-bold text-[#0A1F5C]">Section order & visibility</h3>
          <p className="text-[11px] text-[#64748B]">Drag-free reorder via up/down. Toggle to hide a section from the homepage.</p>
        </div>
        <button onClick={save} disabled={!dirty || busy} data-testid="cms-save"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold bg-[#0A1F5C] text-white disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {busy ? "Publishing…" : (dirty ? "Publish changes" : "Saved")}
        </button>
      </div>

      <ul className="space-y-2">
        {sections.map((s, i) => (
          <li key={s.id} data-testid={`cms-section-${s.id}`}
              className="flex items-center gap-3 px-3 py-2 rounded-xl border border-[#E5E2DC] bg-white">
            <div className="flex flex-col gap-0.5">
              <button onClick={() => move(s.id, -1)} disabled={i === 0} data-testid={`cms-up-${s.id}`}
                className="w-6 h-5 rounded bg-white border border-[#E5E2DC] disabled:opacity-30 flex items-center justify-center"><ChevronUp size={12} /></button>
              <button onClick={() => move(s.id, 1)} disabled={i === sections.length - 1} data-testid={`cms-down-${s.id}`}
                className="w-6 h-5 rounded bg-white border border-[#E5E2DC] disabled:opacity-30 flex items-center justify-center"><ChevronDown size={12} /></button>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[#0A1F5C]">{s.label}</div>
              <div className="text-[10px] text-[#595959]">rank {s.rank} · id {s.id}</div>
            </div>
            <button onClick={() => updateSection(s.id, { enabled: !s.enabled })} data-testid={`cms-toggle-${s.id}`}
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold inline-flex items-center gap-1 ${s.enabled ? "bg-[#4F7363] text-white" : "bg-white border border-[#E5E2DC] text-[#595959]"}`}>
              {s.enabled ? <><Eye size={12} /> Visible</> : <><EyeOff size={12} /> Hidden</>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
