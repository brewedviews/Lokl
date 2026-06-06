"use client";

/**
 * Merchant products — minimal CRUD list. Full bulk-action UI and the inline
 * editor live in the legacy app; this Session D.2 port covers the essential
 * list + create + publish/pause flow. Bulk template download is wired via
 * `downloads.merchantProductsTemplate()`.
 */
import { useEffect, useState } from "react";
import Image from "next/image";
import { Package, Plus, Sparkles, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import { downloads } from "@/lib/downloads";
import { useMerchantAuthStore } from "@/stores";
import type { Product } from "@/types";

const STATUS_TONE: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  pending_review: "bg-[#E68910]/15 text-[#E68910]",
  active: "bg-[#4F7363]/15 text-[#4F7363]",
  paused: "bg-red-100 text-red-500",
};

export default function MerchantProductsPage() {
  const token = useMerchantAuthStore((s) => s.token);
  const [items, setItems] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", price: "", mrp: "", description: "", sizes: "" });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setItems(await api.merchant.listProducts()); } catch { /* ignore */ }
  };
  useEffect(() => { void load(); }, []);

  const filtered = items.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));

  const createProduct = async () => {
    if (!form.name || !form.price) return toast.error("Name & price are required");
    setBusy(true);
    try {
      await api.merchant.createProduct({
        name: form.name, price: Number(form.price),
        mrp: form.mrp ? Number(form.mrp) : undefined,
        description: form.description || undefined,
        sizes: form.sizes ? form.sizes.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      });
      toast.success("Product created — review and publish from the list.");
      setShowNew(false);
      setForm({ name: "", price: "", mrp: "", description: "", sizes: "" });
      void load();
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const bulkAction = async (id: string, action: "publish" | "pause" | "delete") => {
    try {
      await api.merchant.bulkAction([id], action);
      toast.success(`${action} done`);
      void load();
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  return (
    <div className="p-6 md:p-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 data-testid="products-title" className="font-display text-3xl md:text-4xl font-bold text-[#1A2B4C] flex items-center gap-2">
            <Package size={26} /> Products
          </h1>
          <p className="text-[#595959] text-sm mt-1">{items.length} product{items.length === 1 ? "" : "s"} in your catalog</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => downloads.merchantProductsTemplate(token)} data-testid="download-template" className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-[#E5E2DC] text-sm font-semibold hover:border-[#1A2B4C]">
            <Download size={14} /> Bulk template
          </button>
          <a href="/merchant/ai-studio" data-testid="open-ai-studio" className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1A2B4C] text-white text-sm font-semibold hover:bg-[#0F1D38]">
            <Sparkles size={14} /> AI Studio
          </a>
          <button onClick={() => setShowNew(true)} data-testid="open-new-product" className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#E68910] text-white text-sm font-semibold hover:bg-[#C9770E]">
            <Plus size={14} /> New product
          </button>
        </div>
      </div>

      <input data-testid="products-search" placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)}
        className="w-full max-w-md mb-5 px-4 py-2.5 rounded-full border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />

      {filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center" data-testid="products-empty">
          <Package size={28} className="mx-auto text-[#94A3B8] mb-2" />
          <h3 className="font-display text-xl font-bold text-[#1A2B4C]">No products yet</h3>
          <p className="text-sm text-[#595959] mt-1">Use the AI Studio to turn a phone shot into a magazine-quality catalog photo, then click <strong>New product</strong>.</p>
        </div>
      ) : (
        <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
              <tr><th className="px-4 py-3">Product</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Price</th><th className="px-4 py-3 text-right">Stock</th><th className="px-4 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-t border-[#E5E2DC]" data-testid={`prod-row-${p.id}`}>
                  <td className="px-4 py-3 flex items-center gap-3">
                    {p.image ? (
                      <Image src={p.image} alt={p.name} width={48} height={48} className="w-12 h-12 rounded-xl object-cover bg-[#FDFBF7] border border-[#E5E2DC]" unoptimized />
                    ) : <div className="w-12 h-12 rounded-xl bg-[#FDFBF7] border border-[#E5E2DC]" />}
                    <div className="min-w-0">
                      <div className="font-semibold text-[#1A2B4C] truncate">{p.name}</div>
                      <div className="text-[11px] text-[#595959] truncate">{p.description?.slice(0, 60) || "—"}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${STATUS_TONE[(p as Product & { status?: string }).status || "draft"] || STATUS_TONE.draft}`}>
                      {(p as Product & { status?: string }).status || "draft"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">₹{Number(p.price).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-xs text-[#595959]">{(p as Product & { stock?: number }).stock ?? "—"}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <a href={`/product/${p.id}`} target="_blank" rel="noopener noreferrer" data-testid={`preview-${p.id}`} title="Preview PDP" className="inline-flex items-center gap-1 text-xs font-semibold text-[#1A2B4C] hover:underline">
                      Preview <ExternalLink size={11} />
                    </a>
                    <button onClick={() => bulkAction(p.id, "publish")} data-testid={`publish-${p.id}`} className="text-xs font-semibold text-[#4F7363] hover:underline">Publish</button>
                    <button onClick={() => bulkAction(p.id, "pause")} data-testid={`pause-${p.id}`} className="text-xs font-semibold text-[#E68910] hover:underline">Pause</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()} data-testid="new-product-modal">
            <h2 className="font-display text-2xl font-bold text-[#1A2B4C] mb-4">New product</h2>
            <div className="space-y-3">
              <input data-testid="prod-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Product name *" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <div className="grid grid-cols-2 gap-3">
                <input data-testid="prod-price" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Selling price (₹) *" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
                <input data-testid="prod-mrp" inputMode="numeric" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} placeholder="MRP (₹)" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              </div>
              <input data-testid="prod-sizes" value={form.sizes} onChange={(e) => setForm({ ...form, sizes: e.target.value })} placeholder="Sizes (comma-separated, e.g. S, M, L)" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <textarea data-testid="prod-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Product description" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
            </div>
            <div className="flex gap-2 pt-5">
              <button onClick={() => setShowNew(false)} className="flex-1 px-5 py-2.5 rounded-full border border-[#E5E2DC]">Cancel</button>
              <button onClick={createProduct} disabled={busy} data-testid="prod-create" className="flex-1 px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold disabled:opacity-50">
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
