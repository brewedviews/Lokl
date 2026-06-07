"use client";

/**
 * Hero Banner editor — desktop + mobile image, copy, CTAs, redirect target.
 * Saves via PUT /api/admin/site/homepage-config { hero: {...} }.
 *
 * Mirrors `consumer/v2/HeroV2.tsx` props so the preview matches production.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Loader2, Eye } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import { ImageUploadField } from "./ImageUploadField";
import { DestinationPicker } from "./DestinationPicker";
import type { HeroConfig, HomepageConfig } from "@/types";

export function HeroEditor() {
  const [cfg, setCfg] = useState<HomepageConfig | null>(null);
  const [hero, setHero] = useState<HeroConfig>({});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    adminApi.getHomepageConfig().then((c) => {
      setCfg(c);
      setHero(c.hero || {});
    }).catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  }, []);

  const set = <K extends keyof HeroConfig>(k: K, v: HeroConfig[K]) => {
    setHero((h) => ({ ...h, [k]: v }));
    setDirty(true);
  };

  const save = async () => {
    if (!cfg) return;
    setBusy(true);
    try {
      const r = await adminApi.saveHomepageConfig({ ...cfg, hero });
      setCfg(r);
      setHero(r.hero || {});
      setDirty(false);
      toast.success("Hero published — customers see changes within 60s");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return <div className="p-6 text-center text-sm text-[#64748B]"><Loader2 size={18} className="inline animate-spin" /> Loading hero…</div>;

  return (
    <div className="space-y-5" data-testid="cms-hero-editor">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-bold text-[#0A1F5C]">Hero banner</h3>
          <p className="text-[11px] text-[#64748B]">The big banner at the top of the homepage.</p>
        </div>
        <button
          onClick={save} disabled={!dirty || busy}
          data-testid="cms-hero-save"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-bold disabled:opacity-40"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {busy ? "Publishing…" : dirty ? "Publish hero" : "Saved"}
        </button>
      </div>

      <section className="bg-white border border-[#E5E2DC] rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ImageUploadField
            label="Desktop image" recommended="1920×700"
            value={hero.image || ""} onChange={(v) => set("image", v)}
            testid="cms-hero-image-desktop"
          />
          <ImageUploadField
            label="Mobile image" recommended="1080×1350"
            value={hero.mobile_image || ""} onChange={(v) => set("mobile_image", v)}
            testid="cms-hero-image-mobile"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Eyebrow"           v={hero.eyebrow || ""}        onChange={(v) => set("eyebrow", v)}        testid="cms-hero-eyebrow" />
          <Field label="Subtitle"          v={hero.subtitle || ""}       onChange={(v) => set("subtitle", v)}       testid="cms-hero-subtitle" />
          <Field label="Title line 1"      v={hero.title_line1 || ""}    onChange={(v) => set("title_line1", v)}    testid="cms-hero-title1" />
          <Field label="Title line 2"      v={hero.title_line2 || ""}    onChange={(v) => set("title_line2", v)}    testid="cms-hero-title2" />
          <Field label="Primary CTA label" v={hero.cta_primary_label || ""} onChange={(v) => set("cta_primary_label", v)} testid="cms-hero-cta-label" />
          <div>
            <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C] mb-1.5 block">
              Redirect URL (whole hero clickable)
            </span>
            <DestinationPicker
              value={hero.redirect_url || ""}
              onChange={(v) => set("redirect_url", v)}
              testid="cms-hero-redirect"
              placeholder="e.g. /c/women or /offers/festive-sale"
            />
            <p className="text-[10px] text-[#94A3B8] mt-1">Falls back to Primary CTA link when blank.</p>
          </div>
          <Field label="Primary CTA link (fallback)" v={hero.cta_primary_link || ""} onChange={(v) => set("cta_primary_link", v)} testid="cms-hero-cta-link" />
        </div>
      </section>

      {/* Live preview */}
      <section className="bg-white border border-[#E5E2DC] rounded-2xl p-5">
        <div className="flex items-center gap-1.5 mb-3 text-[10px] uppercase tracking-widest font-semibold text-[#94A3B8]">
          <Eye size={11} /> Preview · {hero.redirect_url ? `clicks → ${hero.redirect_url}` : "no redirect set"}
        </div>
        <a
          href={hero.redirect_url || hero.cta_primary_link || "#"}
          target="_blank"
          rel="noreferrer"
          data-testid="cms-hero-preview-link"
          className="block rounded-xl overflow-hidden relative bg-[#1A2B4C] aspect-[16/7]"
        >
          {hero.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero.image} alt="hero" className="absolute inset-0 w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-[#FDFBF7]/95 via-[#FDFBF7]/55 to-transparent" />
          <div className="relative z-10 h-full flex flex-col justify-center max-w-2xl p-5 md:p-8">
            <span className="inline-flex w-fit items-center gap-1.5 px-3 py-1 rounded-full bg-white shadow-sm text-[10px] font-semibold text-[#0A1F5C] uppercase tracking-wide">{hero.eyebrow || "Eyebrow"}</span>
            <h1 className="font-display text-2xl md:text-4xl font-bold tracking-tight text-[#0A1F5C] mt-2">
              {hero.title_line1 || "Title line 1"} <span className="text-[#F59E0B]">{hero.title_line2 || "Title line 2"}</span>
            </h1>
            <p className="text-xs md:text-sm text-[#475569] mt-1.5 max-w-md">{hero.subtitle || "Subtitle"}</p>
            {hero.cta_primary_label && (
              <span className="mt-3 inline-flex w-fit px-4 py-1.5 rounded-full bg-[#0A1F5C] text-white text-[11px] font-bold">{hero.cta_primary_label}</span>
            )}
          </div>
        </a>
      </section>
    </div>
  );
}

function Field({ label, v, onChange, testid }: { label: string; v: string; onChange: (v: string) => void; testid: string }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">{label}</span>
      <input
        type="text" value={v} onChange={(e) => onChange(e.target.value)} data-testid={testid}
        className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none"
      />
    </label>
  );
}
