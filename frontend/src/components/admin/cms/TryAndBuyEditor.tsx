"use client";

/**
 * Try & Buy editor — the single photo used in the homepage "Try & Buy"
 * strip (rider waits while you try, keep what you love). Saves via
 * PUT /api/admin/site/homepage-config { try_and_buy_image }. Same
 * upload-or-paste-URL ImageUploadField as every other CMS image field;
 * unlike categories/areas this is one global value, not a list, so it's
 * a single-row card rather than a repeated-row editor.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import { ImageUploadField } from "./ImageUploadField";
import type { HomepageConfig } from "@/types";

export function TryAndBuyEditor() {
  const [cfg, setCfg] = useState<HomepageConfig | null>(null);
  const [image, setImage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi.getHomepageConfig().then((c) => {
      setCfg(c);
      setImage(c.try_and_buy_image || "");
    }).catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  }, []);

  const save = async () => {
    if (!cfg) return;
    setBusy(true);
    try {
      const r = await adminApi.saveHomepageConfig({ ...cfg, try_and_buy_image: image });
      setCfg(r);
      setImage(r.try_and_buy_image || "");
      setDirty(false);
      toast.success("Try & Buy image published — customers see changes within 60s");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return <div className="p-6 text-center text-sm text-[#64748B]"><Loader2 size={18} className="inline animate-spin" /> Loading…</div>;

  return (
    <div className="space-y-4" data-testid="cms-try-and-buy-editor">
      <div>
        <h3 className="font-display text-lg font-bold text-[#0A1F5C]">Try &amp; Buy</h3>
        <p className="text-[11px] text-[#64748B]">
          The photo shown in the homepage &quot;Try &amp; Buy&quot; strip — a try-on or
          rider-at-door moment works well. Leave empty to show a neutral placeholder
          instead of a broken image.
        </p>
      </div>

      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-[220px_1fr_auto] gap-4 items-start" data-testid="cms-try-and-buy-row">
        <ImageUploadField
          label="Try & Buy photo" recommended="600×450"
          value={image} onChange={(v) => { setImage(v); setDirty(true); }}
          testid="cms-try-and-buy-image"
        />
        <p className="text-[11px] text-[#94A3B8] pt-1 self-center">
          Appears on the left of the compact homepage strip, next to the &quot;try before
          you pay&quot; copy.
        </p>
        <button
          onClick={save} disabled={!dirty || busy}
          data-testid="cms-try-and-buy-save"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-bold disabled:opacity-40 self-start"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {busy ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
      </div>
    </div>
  );
}
