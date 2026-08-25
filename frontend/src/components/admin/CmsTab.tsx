"use client";

/**
 * Admin → CMS → Homepage Assets parent tab.
 *
 * Sub-tabs: Sections (order + on/off for every homepage section — see
 * SectionsPanel below), Hero slides, L1 Categories, L2 Sub-cats, Areas,
 * Price bands, Try & Buy, Offers.
 *
 * Sections is the default/first tab and is fully load-bearing: its saves
 * go to site_config.homepage.sections via PUT /api/admin/site/homepage-
 * config, which HomeClient.tsx now treats as authoritative for section
 * order/visibility (previously the frontend's local rank silently
 * overrode whatever was saved here, so this panel edited a document with
 * no real effect — fixed alongside this comment).
 *
 * G10 §2 — the old "Hero banner" tab (HeroEditor.tsx, editing site_config
 * .homepage.hero) is REMOVED. Audited before removing: that document has
 * zero consumer-facing renderers — the only component that ever read it,
 * HeroV2.tsx, is itself dead code (never imported anywhere outside its
 * own file). An admin could reach a fully-functional-looking "Hero
 * banner" tab that silently changed nothing on the live site, sitting
 * right next to "Hero slides" (the real system HeroCarousel actually
 * renders) — that's the literal root of the "duplicate/confusing hero"
 * complaint, not a consumer-facing rendering bug (Marketplace vs Women's
 * hero content were already verified genuinely distinct in G8). Fixed at
 * the other end too — see HeroSlidesEditor.tsx's own comment on adding a
 * "Marketplace" option, since that tab previously had no way to reach the
 * global hero scope at all.
 */
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, ChevronUp, ChevronDown, Save, Loader2, LayoutTemplate, Images, Folder, Layers, Sparkles, MapPin, Tag, RotateCcw, Store } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import { HeroSlidesEditor } from "@/components/admin/cms/HeroSlidesEditor";
import { L1CategoriesEditor } from "@/components/admin/cms/L1CategoriesEditor";
import { L2SubcategoriesEditor } from "@/components/admin/cms/L2SubcategoriesEditor";
import { AreasEditor } from "@/components/admin/cms/AreasEditor";
import { PriceBandsEditor } from "@/components/admin/cms/PriceBandsEditor";
import { TryAndBuyEditor } from "@/components/admin/cms/TryAndBuyEditor";
import { OffersEditor } from "@/components/admin/cms/OffersEditor";
import { BrandsEditor } from "@/components/admin/cms/BrandsEditor";
import { StoreSectionsEditor } from "@/components/admin/cms/StoreSectionsEditor";
import { TopClicksWidget } from "@/components/admin/cms/TopClicksWidget";
import type { HomepageConfig } from "@/types";

interface Section { id: string; label: string; enabled: boolean; rank: number }

type SubTab = "sections" | "hero_slides" | "l1" | "l2" | "areas" | "price_bands" | "try_and_buy" | "offers" | "brands" | "store_sections";

const SUB_TABS: { id: SubTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "sections",     label: "Sections",      icon: LayoutTemplate },
  { id: "hero_slides",  label: "Hero slides",   icon: Images },
  { id: "l1",           label: "L1 Categories", icon: Folder },
  { id: "l2",           label: "L2 Sub-cats",   icon: Layers },
  { id: "areas",        label: "Areas",         icon: MapPin },
  { id: "price_bands",  label: "Price bands",   icon: Tag },
  { id: "try_and_buy",  label: "Try & Buy",     icon: RotateCcw },
  { id: "offers",       label: "Offers",        icon: Sparkles },
  { id: "brands",       label: "Brands",        icon: Tag },
  { id: "store_sections", label: "Store sections", icon: Store },
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
        {tab === "hero_slides" && <HeroSlidesEditor />}
        {tab === "l1"       && <L1CategoriesEditor />}
        {tab === "l2"       && <L2SubcategoriesEditor />}
        {tab === "areas"       && <AreasEditor />}
        {tab === "price_bands" && <PriceBandsEditor />}
        {tab === "try_and_buy" && <TryAndBuyEditor />}
        {tab === "offers"      && <OffersEditor />}
        {tab === "brands"      && <BrandsEditor />}
        {tab === "store_sections" && <StoreSectionsEditor />}
      </div>

      <TopClicksWidget />
    </div>
  );
}

// G7 — one shared, flat sections list still backs both "/" (Marketplace
// Home) and "/c/[slug]" (L1 Shopping Home); a section simply doesn't
// render on a surface whose own frontend renderer map doesn't register
// its id (see MarketplaceHomeClient.tsx / L1PageClient.tsx's own top
// comments — no new CMS schema, this map is purely informational so an
// admin isn't confused why toggling e.g. a Marketplace-only section does
// nothing on /c/women).
//
// G9 §5 — this map had drifted stale since before the G8 refactor: 6 of
// the then-18 live ids carried a wrong or accidentally-correct badge
// (best_deals/under_499/premium_picks showed "L1 pages" despite already
// rendering on both surfaces; offers showed "Both" despite G8 splitting
// it into marketplace_offers + a now-L1-only offers; other_categories/
// customer_love silently fell through to the "Marketplace" default
// despite being L1-only). Rebuilt here against the actual current
// sectionRenderers maps in both files, id-for-id — every id below is
// verified against what genuinely renders where, not assumed from its
// name. Keep in sync if a section ever moves surfaces.
const SECTION_SCOPE: Record<string, "Marketplace" | "L1 pages" | "Both"> = {
  hero: "Both",
  category_pills: "Marketplace",
  marketplace_offers: "Marketplace",
  shop_by_category: "L1 pages",
  best_deals: "Both",
  under_499: "Both",
  stores_near_you: "Marketplace",
  shop_by_store: "L1 pages",
  l1_footwear_rail: "L1 pages",
  l1_lingerie_rail: "L1 pages",
  global_store_ethnic: "Marketplace",
  merchant_cta: "Marketplace",
  premium_picks: "Both",
  offers: "L1 pages",
  global_store_footwear: "Marketplace",
  l1_ethnic_rail: "L1 pages",
  other_categories: "L1 pages",
  customer_love: "L1 pages",
};

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
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-[#0A1F5C]">{s.label}</span>
                <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                  SECTION_SCOPE[s.id] === "L1 pages" ? "bg-[#DBEAFE] text-[#1D4ED8]"
                  : SECTION_SCOPE[s.id] === "Both" ? "bg-[#F3E8FF] text-[#7E22CE]"
                  : "bg-[#FEF3C7] text-[#92400E]"
                }`} data-testid={`cms-section-scope-${s.id}`}>
                  {SECTION_SCOPE[s.id] || "Marketplace"}
                </span>
              </div>
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
