import React, { useState } from "react";
import { Sparkles, X, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import api from "../../lib/api";
import { toast } from "sonner";

const KIND_LABEL = {
  outdoor_1: "Outdoor · natural daylight",
  outdoor_2: "Outdoor · alt angle",
  studio_1: "Studio · white seamless",
  studio_2: "Studio · soft grey",
};
const ORDER = ["outdoor_1", "outdoor_2", "studio_1", "studio_2"];

/**
 * AI image enhancer modal.
 * Two modes:
 *  - product mode: pass `product` (must have an image). On apply, merges picked images into product via PUT.
 *  - draft mode: pass `sourceImage` (base64 data URL) and `onSelect(images: string[])`.
 *    No backend write — caller decides what to do with the picked images.
 */
export default function AIEnhanceModal({ product, sourceImage, onSelect, onClose, onApplied }) {
  const [outputs, setOutputs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const source =
    sourceImage ||
    (product && ((product.images && product.images[0]) || product.image)) ||
    "";

  const run = async () => {
    if (!source) { setError("Upload a clear product photo first."); return; }
    setBusy(true); setError("");
    try {
      const { data } = await api.post("/merchant/ai/enhance-image", { image: source });
      const ord = ORDER.map((k) => (data.outputs || []).find((o) => o.kind === k) || { kind: k, ok: false, image: null });
      setOutputs(ord.map((o) => ({ ...o, picked: !!o.ok })));
      const okCount = ord.filter((o) => o.ok).length;
      if (okCount === 0) setError("Generation returned no usable images. Try again or use a clearer source photo.");
      else toast.success(`Generated ${okCount} of 4 enhanced images`);
    } catch (e) {
      setError(e?.response?.data?.detail || "AI enhancement failed");
    } finally { setBusy(false); }
  };

  const togglePick = (idx) => setOutputs((arr) => arr.map((o, i) => (i === idx ? { ...o, picked: !o.picked } : o)));

  const applyPicked = async () => {
    const chosen = (outputs || []).filter((o) => o.picked && o.image).map((o) => o.image);
    if (chosen.length === 0) return toast.error("Tick at least one image first");

    // Draft mode — hand off to caller
    if (onSelect) {
      onSelect(chosen);
      onClose();
      return;
    }

    // Product-PUT mode
    if (!product) { toast.error("Nothing to apply to"); return; }
    const existing = (product.images && product.images.length > 0) ? product.images : (product.image ? [product.image] : []);
    const merged = [...existing, ...chosen].slice(0, 5);
    try {
      await api.put(`/merchant/products/${product.id}`, { image: merged[0], images: merged });
      toast.success(`Added ${chosen.length} image(s)`);
      onApplied && onApplied();
      onClose();
    } catch { toast.error("Could not save enhanced images"); }
  };

  const title = product?.name || "New product";

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl w-full max-w-3xl p-6 max-h-[92vh] overflow-y-auto" data-testid="ai-enhance-modal">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="display text-2xl font-bold text-[#1A2B4C] flex items-center gap-2"><Sparkles size={20} className="text-[#E68910]" /> AI catalog images</h3>
            <p className="text-[11px] text-[#595959] mt-0.5">2 outdoor · 2 studio · standalone images · Gemini Nano Banana</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full border border-[#E5E2DC] flex items-center justify-center"><X size={16} /></button>
        </div>

        <div className="flex items-start gap-3 mb-4 p-3 bg-[#FDFBF7] rounded-xl border border-[#E5E2DC]">
          {source ? <img src={source} alt="source" className="w-16 h-20 object-cover rounded-lg shrink-0" /> :
            <div className="w-16 h-20 bg-white border border-dashed border-[#E5E2DC] rounded-lg" />}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-[#595959]">Source photo</div>
            <div className="font-semibold text-sm text-[#1A2B4C] truncate">{title}</div>
            <p className="text-[11px] text-[#595959] mt-0.5 leading-snug">Lokl will generate exactly 4 standalone images — 2 outdoor (natural daylight, neutral backdrop) + 2 studio (white seamless / soft grey). Garment shape, colour, print and texture stay identical. No models added unless your photo already has one.</p>
          </div>
        </div>

        {error && <div className="mb-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

        {!outputs && !busy && (
          <button data-testid="ai-enhance-start" onClick={run} disabled={!source} className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-[#1A2B4C] text-white font-semibold hover:bg-[#101D36] disabled:opacity-50">
            <Sparkles size={14} /> Generate 4 catalog images
          </button>
        )}

        {busy && (
          <div className="py-12 text-center text-sm text-[#595959]" data-testid="ai-enhance-loading">
            <Loader2 size={28} className="animate-spin text-[#E68910] mx-auto mb-2" />
            Generating 4 images in parallel… usually 15–25 seconds.
          </div>
        )}

        {outputs && !busy && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {outputs.map((o, idx) => (
                <div key={o.kind} data-testid={`ai-out-${o.kind}`}
                  className={`relative rounded-2xl overflow-hidden border-2 transition cursor-pointer ${o.picked ? "border-[#E68910] shadow-lg" : "border-[#E5E2DC]"}`}
                  onClick={() => o.ok && togglePick(idx)}>
                  <div className="aspect-[4/5] bg-[#FDFBF7] relative">
                    {o.ok && o.image ? (
                      <img src={o.image} alt={KIND_LABEL[o.kind]} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-[#595959] px-3 text-center">Generation failed</div>
                    )}
                    {o.picked && (
                      <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-[#E68910] text-white flex items-center justify-center shadow"><CheckCircle2 size={16} /></div>
                    )}
                  </div>
                  <div className="px-3 py-2 bg-white text-[11px] font-semibold text-[#1A2B4C] flex items-center justify-between">
                    {KIND_LABEL[o.kind]}
                    {!o.ok && <span className="text-red-500 text-[10px]">Failed</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end flex-wrap">
              <button onClick={run} data-testid="ai-enhance-retry" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-[#E5E2DC] text-sm font-semibold hover:border-[#1A2B4C]"><RefreshCw size={13} /> Regenerate</button>
              <button onClick={applyPicked} data-testid="ai-enhance-apply" className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#E68910] text-white text-sm font-semibold hover:bg-[#cc7a0a]"><Sparkles size={13} /> Use picked images</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
