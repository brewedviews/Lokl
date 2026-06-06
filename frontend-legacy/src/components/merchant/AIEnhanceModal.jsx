import React, { useState } from "react";
import { Sparkles, X, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import api from "../../lib/api";
import { toast } from "sonner";

const KIND_LABEL = {
  outdoor_1: "Outdoor · natural daylight",
  studio_1: "Studio · white seamless",
};
const ORDER = ["outdoor_1", "studio_1"];

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
    // Optimistic: render 4 loading tiles immediately, replace as each call resolves.
    const initial = ORDER.map((k) => ({ kind: k, ok: false, image: null, picked: false, loading: true }));
    setOutputs(initial);
    // Fire 4 parallel per-kind calls — each finishes in 10-20s, well under the 60s ingress cap.
    const tasks = ORDER.map((kind) =>
      api.post("/merchant/ai/enhance-image/one", { image: source, kind })
        .then(({ data }) => ({ ...data, picked: !!data.ok, loading: false }))
        .catch((e) => ({ kind, ok: false, image: null, picked: false, loading: false, err: e?.response?.data?.detail || "failed" }))
    );
    // Stream results as they arrive
    let okCount = 0;
    await Promise.all(tasks.map(async (t, idx) => {
      const res = await t;
      okCount += res.ok ? 1 : 0;
      setOutputs((arr) => arr.map((o, i) => (i === idx ? res : o)));
    }));
    if (okCount === 0) setError("Generation returned no usable images. Try a clearer source photo.");
    else toast.success(`Generated ${okCount} of 4 enhanced images`);
    setBusy(false);
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
            <p className="text-[11px] text-[#595959] mt-0.5">1 outdoor · 1 studio · model wearing your product · Gemini Nano Banana</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full border border-[#E5E2DC] flex items-center justify-center"><X size={16} /></button>
        </div>

        <div className="flex items-start gap-3 mb-4 p-3 bg-[#FDFBF7] rounded-xl border border-[#E5E2DC]">
          {source ? <img src={source} alt="source" className="w-16 h-20 object-cover rounded-lg shrink-0" /> :
            <div className="w-16 h-20 bg-white border border-dashed border-[#E5E2DC] rounded-lg" />}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-[#595959]">Source photo</div>
            <div className="font-semibold text-sm text-[#1A2B4C] truncate">{title}</div>
            <p className="text-[11px] text-[#595959] mt-0.5 leading-snug">Lokl generates 2 catalog images — 1 outdoor (natural daylight) + 1 studio (white seamless). Garment shape, colour, print and texture stay identical. If your photo has no model, we add a real-looking one wearing the product.</p>
          </div>
        </div>

        {error && <div className="mb-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

        {!outputs && !busy && (
          <button data-testid="ai-enhance-start" onClick={run} disabled={!source} className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-[#1A2B4C] text-white font-semibold hover:bg-[#101D36] disabled:opacity-50">
            <Sparkles size={14} /> Generate 2 catalog images
          </button>
        )}

        {busy && !outputs && (
          <div className="py-8 text-center text-sm text-[#595959]">
            <Loader2 size={24} className="animate-spin text-[#E68910] mx-auto mb-2" />
            Working…
          </div>
        )}

        {outputs && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {outputs.map((o, idx) => (
                <div key={o.kind} data-testid={`ai-out-${o.kind}`}
                  className={`relative rounded-2xl overflow-hidden border-2 transition ${o.ok ? "cursor-pointer" : ""} ${o.picked ? "border-[#E68910] shadow-lg" : "border-[#E5E2DC]"}`}
                  onClick={() => o.ok && togglePick(idx)}>
                  <div className="aspect-[4/5] bg-[#FDFBF7] relative">
                    {o.loading ? (
                      <div className="w-full h-full flex flex-col items-center justify-center text-xs text-[#595959] gap-2">
                        <Loader2 size={22} className="animate-spin text-[#E68910]" />
                        Generating…
                      </div>
                    ) : o.ok && o.image ? (
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
                    {!o.loading && !o.ok && <span className="text-red-500 text-[10px]">Failed</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end flex-wrap">
              <button onClick={run} disabled={busy} data-testid="ai-enhance-retry" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-[#E5E2DC] text-sm font-semibold hover:border-[#1A2B4C] disabled:opacity-50"><RefreshCw size={13} /> Regenerate</button>
              <button onClick={applyPicked} disabled={busy} data-testid="ai-enhance-apply" className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#E68910] text-white text-sm font-semibold hover:bg-[#cc7a0a] disabled:opacity-50"><Sparkles size={13} /> Use picked images</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
