"use client";

/**
 * Store Sections editor (redesign Phase G4) — admin-curated banner +
 * pinned display cards for the Footwear/Ethnic/Lingerie-or-Innerwear
 * Store sections (StoreSectionModule in L1PageClient.tsx).
 *
 * Deliberately narrow, not a generic CMS: the module list below mirrors
 * L1PageClient's own WOMEN_STORE_MODULES/MEN_STORE_MODULES exactly
 * (same three L2 slugs per gender) because that's the ONLY place this
 * override is ever consumed — building UI for L2s the consumer component
 * never renders would be pure noise. If that module list ever changes,
 * both places need the coordinated edit, same as SHOP_BY_CATEGORY_TILES's
 * own hardcoded spec already does.
 *
 * One doc per (l1_id, l2_id), saved as a single whole-doc PUT (banner +
 * the entire pinned_stores array together) rather than per-card CRUD —
 * pinned cards are never independently addressed anywhere else. Reuses
 * ImageUploadField (same "cms" asset folder every other homepage image
 * uploads into) and DestinationPicker (same redirect-URL picker Offers/
 * Hero Slides already use) for the pinned card's optional link.
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import { Save, Loader2, Trash2, Plus, RotateCcw, Store as StoreIcon } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import { catalogApi } from "@/lib/api";
import { ImageUploadField } from "./ImageUploadField";
import { DestinationPicker } from "./DestinationPicker";
import type { CategoryNode, CmsStoreSectionOverride, CmsPinnedStoreCard } from "@/types";

interface ModuleSpec { label: string; l2Slug: string }

const WOMEN_MODULES: ModuleSpec[] = [
  { label: "Footwear", l2Slug: "footwear" },
  { label: "Ethnic", l2Slug: "ethnic-wear" },
  { label: "Lingerie", l2Slug: "lingerie" },
];

const MEN_MODULES: ModuleSpec[] = [
  { label: "Footwear", l2Slug: "footwear" },
  { label: "Ethnic", l2Slug: "ethnic-wear" },
  { label: "Innerwear Store", l2Slug: "innerwear" },
];

const L1_OPTIONS: { slug: string; label: string; modules: ModuleSpec[] }[] = [
  { slug: "women", label: "Women", modules: WOMEN_MODULES },
  { slug: "men", label: "Men", modules: MEN_MODULES },
];

const blankCard = (): CmsPinnedStoreCard => ({ id: `new-${Math.random().toString(36).slice(2, 10)}`, name: "", image: "", link: "" });

export function StoreSectionsEditor() {
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [overrides, setOverrides] = useState<CmsStoreSectionOverride[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeL1Slug, setActiveL1Slug] = useState<string>("women");
  const [activeL2Slug, setActiveL2Slug] = useState<string>("footwear");

  const [bannerImage, setBannerImage] = useState("");
  const [pinnedStores, setPinnedStores] = useState<CmsPinnedStoreCard[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [cats, rows] = await Promise.all([catalogApi.categories(), adminApi.listStoreSectionOverrides()]);
      setCategories(cats);
      setOverrides(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load store sections");
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const activeL1 = useMemo(() => categories.find((c) => c.slug === activeL1Slug), [categories, activeL1Slug]);
  const activeModules = L1_OPTIONS.find((o) => o.slug === activeL1Slug)?.modules ?? [];
  const activeL2 = useMemo(() => activeL1?.l2.find((s) => s.slug === activeL2Slug), [activeL1, activeL2Slug]);
  const activeOverride = useMemo(
    () => activeL1 ? overrides.find((o) => o.l1_id === activeL1.id && o.l2_id === activeL2?.id) : undefined,
    [overrides, activeL1, activeL2],
  );

  // Load the selected L1+category's saved override (or a blank slate)
  // into local editable state whenever the selection changes.
  useEffect(() => {
    setBannerImage(activeOverride?.banner_image || "");
    setPinnedStores(activeOverride?.pinned_stores ? activeOverride.pinned_stores.map((c) => ({ ...c })) : []);
    setDirty(false);
  }, [activeOverride]);

  const selectModule = (l1Slug: string, l2Slug: string) => {
    setActiveL1Slug(l1Slug);
    setActiveL2Slug(l2Slug);
  };

  const patchCard = (id: string, patch: Partial<CmsPinnedStoreCard>) => {
    setPinnedStores((rows) => rows.map((r) => r.id === id ? { ...r, ...patch } : r));
    setDirty(true);
  };
  const addCard = () => { setPinnedStores((rows) => [...rows, blankCard()]); setDirty(true); };
  const removeCard = (id: string) => { setPinnedStores((rows) => rows.filter((r) => r.id !== id)); setDirty(true); };

  const save = async () => {
    if (!activeL1 || !activeL2) return;
    const clean = pinnedStores.filter((c) => c.name.trim());
    setBusy(true);
    try {
      const saved = await adminApi.saveStoreSectionOverride(activeL1.id, activeL2.id, {
        banner_image: bannerImage, pinned_stores: clean,
      });
      setOverrides((rows) => {
        const others = rows.filter((r) => !(r.l1_id === activeL1.id && r.l2_id === activeL2.id));
        return [...others, saved];
      });
      setPinnedStores(clean.map((c) => ({ ...c })));
      setDirty(false);
      toast.success("Store section saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const resetToDefault = async () => {
    if (!activeL1 || !activeL2 || !activeOverride) return;
    if (!confirm("Reset this section to defaults? Removes the CMS banner and every pinned card — real stores are unaffected.")) return;
    setBusy(true);
    try {
      await adminApi.deleteStoreSectionOverride(activeL1.id, activeL2.id);
      setOverrides((rows) => rows.filter((r) => !(r.l1_id === activeL1.id && r.l2_id === activeL2.id)));
      toast.success("Reset — showing the default L2 banner, no pinned cards");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return <div className="p-6 text-center text-sm text-[#64748B]"><Loader2 size={18} className="inline animate-spin" /> Loading store sections…</div>;
  }

  return (
    <div className="space-y-4" data-testid="cms-store-sections-editor">
      <div>
        <h3 className="font-display text-lg font-bold text-[#0A1F5C]">Store sections</h3>
        <p className="text-[11px] text-[#64748B]">
          Footwear / Ethnic / Lingerie-or-Innerwear Store sections. Real stores with products in this
          category always show first, automatically — this only adds an optional banner override and
          pinned display cards alongside them.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="cms-store-sections-l1-picker">
        {L1_OPTIONS.map((l1opt) => (
          <div key={l1opt.slug} className="flex flex-wrap gap-1.5">
            {l1opt.modules.map((m) => {
              const active = activeL1Slug === l1opt.slug && activeL2Slug === m.l2Slug;
              return (
                <button
                  key={`${l1opt.slug}-${m.l2Slug}`}
                  onClick={() => selectModule(l1opt.slug, m.l2Slug)}
                  data-testid={`cms-store-section-tab-${l1opt.slug}-${m.l2Slug}`}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                    active ? "bg-[#0A1F5C] text-white border-[#0A1F5C]" : "bg-white text-[#595959] border-[#E5E2DC]"
                  }`}
                >
                  {l1opt.label} {m.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {!activeL1 || !activeL2 ? (
        <div className="p-6 text-center text-sm text-[#64748B]">This category isn&apos;t set up on this L1 yet.</div>
      ) : (
        <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0A1F5C]">
              <StoreIcon size={15} />
              {L1_OPTIONS.find((o) => o.slug === activeL1Slug)?.label} · {activeModules.find((m) => m.l2Slug === activeL2Slug)?.label}
            </div>
            <div className="flex items-center gap-2">
              {activeOverride && (
                <button onClick={() => void resetToDefault()} disabled={busy} data-testid="cms-store-section-reset"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-[#FCA5A5] text-[#DC2626] text-[11px] font-bold disabled:opacity-40">
                  <RotateCcw size={11} /> Reset to default
                </button>
              )}
              <button onClick={() => void save()} disabled={!dirty || busy} data-testid="cms-store-section-save"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-bold disabled:opacity-40">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {busy ? "Saving…" : dirty ? "Save" : "Saved"}
              </button>
            </div>
          </div>

          <ImageUploadField
            label="Banner image" recommended="1200×500"
            value={bannerImage} onChange={(v) => { setBannerImage(v); setDirty(true); }}
            testid="cms-store-section-banner"
          />
          <p className="text-[10px] text-[#94A3B8] -mt-2">
            Leave blank to use the category&apos;s own default image ({activeL2.image ? "currently set" : "not set for this category"}).
          </p>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Pinned cards</span>
              <button onClick={addCard} data-testid="cms-store-section-card-add"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#0A1F5C] text-white text-[10px] font-bold">
                <Plus size={10} /> Add card
              </button>
            </div>

            {pinnedStores.length === 0 ? (
              <div className="bg-[#FDFBF7] border border-dashed border-[#E5E2DC] rounded-xl p-6 text-center text-[12px] text-[#94A3B8]">
                No pinned cards yet. Real stores with products here still show automatically.
              </div>
            ) : (
              <div className="space-y-3">
                {pinnedStores.map((card) => (
                  <div key={card.id} data-testid={`cms-store-section-card-${card.id}`}
                    className="grid grid-cols-1 lg:grid-cols-[140px_1fr_auto] gap-3 items-start border border-[#E5E2DC] rounded-xl p-3">
                    <ImageUploadField
                      label="Card image" recommended="600×800"
                      value={card.image || ""} onChange={(v) => patchCard(card.id, { image: v })}
                      testid={`cms-store-section-card-image-${card.id}`}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <label className="block">
                        <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Name</span>
                        <input
                          type="text" value={card.name} onChange={(e) => patchCard(card.id, { name: e.target.value })}
                          placeholder="e.g. Step & Sole"
                          data-testid={`cms-store-section-card-name-${card.id}`}
                          className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none"
                        />
                      </label>
                      <div className="sm:col-span-2">
                        <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C] mb-1 block">Link (optional)</span>
                        <DestinationPicker
                          value={card.link || ""} onChange={(v) => patchCard(card.id, { link: v })}
                          testid={`cms-store-section-card-link-${card.id}`}
                          placeholder={`defaults to /c/${activeL1Slug}/${activeL2.slug}`}
                        />
                      </div>
                    </div>
                    <button onClick={() => removeCard(card.id)} data-testid={`cms-store-section-card-remove-${card.id}`}
                      className="w-8 h-8 rounded-full bg-white border border-[#FCA5A5] text-[#DC2626] flex items-center justify-center">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
