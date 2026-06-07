"use client";

/**
 * Merchant products — full CRUD with image upload, category pickers,
 * per-size stock, bulk actions and bulk xlsx upload.
 *
 * Image uploads go directly to Cloudinary via `/api/merchant/upload-image`.
 * Mongo stores ONLY `{image, image_public_id}` cover + `{images[], image_public_ids[]}`
 * carousel — never base64 blobs.
 */
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Package, Plus, Download, ExternalLink, Upload, X, Star, Edit3, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { downloads } from "@/lib/downloads";
import { useMerchantAuthStore } from "@/stores";
import { uploadImage, deleteUploadedImage } from "@/lib/uploads";
import type { Product } from "@/types";

const STATUS_TONE: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  pending_review: "bg-[#E68910]/15 text-[#E68910]",
  active: "bg-[#4F7363]/15 text-[#4F7363]",
  paused: "bg-red-100 text-red-500",
};

interface L2 { id: string; name: string }
interface Category { id: string; name: string; l2: L2[] }

const GENDERS = ["women", "men", "unisex", "kids"];
const MAX_IMAGES = 5;
const blankForm = {
  name: "", price: "", mrp: "", description: "",
  l1_id: "", l2_id: "", gender: "",
  sizes: [] as string[], stock: {} as Record<string, number>,
  images: [] as string[], image_public_ids: [] as string[],
  return_eligible: false,
};

export default function MerchantProductsPage() {
  const token = useMerchantAuthStore((s) => s.token);
  const [items, setItems] = useState<Product[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [openAdd, setOpenAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkUploadBusy, setBulkUploadBusy] = useState(false);
  const bulkInputRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    try { setItems(await api.merchant.listProducts()); } catch { /* ignore */ }
  };
  useEffect(() => { void load(); void loadCats(); }, []);
  const loadCats = async () => {
    try {
      const r = await apiClient.get<Category[]>("/api/categories");
      setCats(r.data);
    } catch { /* ignore */ }
  };

  const filtered = items.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    if (form.images.length >= MAX_IMAGES) return toast.error(`Max ${MAX_IMAGES} images`);
    setImageBusy(true);
    try {
      const { image_url, public_id } = await uploadImage(file, "product");
      setForm((f) => ({
        ...f,
        images: [...f.images, image_url],
        image_public_ids: [...f.image_public_ids, public_id],
      }));
      toast.success("Image uploaded");
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setImageBusy(false); }
  };

  const removeImage = async (idx: number) => {
    const pid = form.image_public_ids[idx];
    setForm((f) => ({
      ...f,
      images: f.images.filter((_, i) => i !== idx),
      image_public_ids: f.image_public_ids.filter((_, i) => i !== idx),
    }));
    if (pid) void deleteUploadedImage(pid);
  };

  const toggleSize = (sz: string) => setForm((f) => {
    const has = f.sizes.includes(sz);
    return {
      ...f,
      sizes: has ? f.sizes.filter((x) => x !== sz) : [...f.sizes, sz],
      stock: has ? Object.fromEntries(Object.entries(f.stock).filter(([k]) => k !== sz)) : f.stock,
    };
  });

  const submit = async () => {
    if (!form.name || !form.price || !form.l1_id) return toast.error("Name, price and category are required");
    const l1 = cats.find((c) => c.id === form.l1_id);
    const hasL2 = l1 && l1.l2 && l1.l2.length > 0;
    if (hasL2 && !form.l2_id) return toast.error("Sub-category is required for this category");
    if (!hasL2 && !form.gender) return toast.error("Gender is required for this category");
    if (form.images.length === 0) return toast.error("At least one product image is required");
    setSubmitBusy(true);
    try {
      const body = {
        name: form.name,
        price: Number(form.price),
        mrp: form.mrp ? Number(form.mrp) : undefined,
        description: form.description || undefined,
        l1_id: form.l1_id,
        l2_id: form.l2_id || "",
        gender: form.gender || "",
        sizes: form.sizes,
        stock: form.stock,
        image: form.images[0] || "",
        image_public_id: form.image_public_ids[0] || "",
        images: form.images,
        image_public_ids: form.image_public_ids,
        return_eligible: form.return_eligible,
      };
      if (editingId) {
        await api.merchant.updateProduct(editingId, body as Partial<Product>);
        toast.success("Product updated");
      } else {
        await api.merchant.createProduct(body as Partial<Product>);
        toast.success("Product created");
      }
      setOpenAdd(false); setEditingId(null); setForm(blankForm);
      void load();
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSubmitBusy(false); }
  };

  const openEdit = async (p: Product) => {
    try {
      // GET /api/products/{pid} returns { product, similar }, so we have to
      // unwrap before populating the form. Reading the top-level fields was
      // the iter-44 regression that opened the edit modal blank.
      const r = await apiClient.get<{ product: Product & { image_public_id?: string; image_public_ids?: string[]; stock?: Record<string, number>; sizes?: string[]; l1_id?: string; l2_id?: string; gender?: string; mrp?: number; return_eligible?: boolean; images?: string[] } }>(`/api/products/${p.id}`);
      const d = r.data.product;
      setEditingId(p.id);
      setForm({
        name: d.name || "",
        price: String(d.price || ""),
        mrp: d.mrp != null ? String(d.mrp) : "",
        description: d.description || "",
        l1_id: d.l1_id || "",
        l2_id: d.l2_id || "",
        gender: d.gender || "",
        sizes: d.sizes || [],
        stock: d.stock || {},
        images: d.images && d.images.length ? d.images : (d.image ? [d.image] : []),
        image_public_ids: d.image_public_ids && d.image_public_ids.length ? d.image_public_ids : (d.image_public_id ? [d.image_public_id] : []),
        return_eligible: !!d.return_eligible,
      });
      setOpenAdd(true);
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const bulkAction = async (action: "publish" | "pause" | "delete") => {
    if (selected.length === 0) return;
    setBulkBusy(true);
    try {
      await api.merchant.bulkAction(selected, action);
      toast.success(`${action} done`);
      setSelected([]); void load();
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setBulkBusy(false); }
  };

  const togglePublish = async (p: Product, target: "live" | "paused") => {
    try {
      await api.merchant.updateProduct(p.id, { paused: target !== "live" } as Partial<Product>);
      void load();
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const handleBulkUpload = async (file: File | undefined) => {
    if (!file) return;
    setBulkUploadBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.merchant.bulkCreateProducts(fd);
      toast.success(`Imported ${r.created} products`);
      void load();
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setBulkUploadBusy(false); }
  };

  const publishStore = async () => {
    try { await api.merchant.publish(); toast.success("Going live within 1 hour"); void load(); }
    catch (e) { toast.error(getErrorMessage(e)); }
  };

  const currentL1 = cats.find((c) => c.id === form.l1_id);
  const hasL2 = !!(currentL1 && currentL1.l2 && currentL1.l2.length > 0);
  const SIZE_PRESETS = ["XS", "S", "M", "L", "XL", "XXL", "Free"];

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
          <label data-testid="bulk-upload-trigger" className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-[#E5E2DC] text-sm font-semibold hover:border-[#1A2B4C] cursor-pointer">
            {bulkUploadBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Bulk upload
            <input ref={bulkInputRef} data-testid="bulk-csv" type="file" accept=".xlsx,.csv" className="hidden"
              onChange={(e) => { handleBulkUpload(e.target.files?.[0]); if (bulkInputRef.current) bulkInputRef.current.value = ""; }} />
          </label>
          <button onClick={() => { setEditingId(null); setForm(blankForm); setOpenAdd(true); }} data-testid="add-product-btn" className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#E68910] text-white text-sm font-semibold hover:bg-[#C9770E]">
            <Plus size={14} /> Add product
          </button>
          <button onClick={publishStore} data-testid="publish-store-btn" className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#4F7363] text-white text-sm font-semibold hover:bg-[#3D5A4C]">
            Go live
          </button>
        </div>
      </div>

      <input data-testid="products-search" placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)}
        className="w-full max-w-md mb-5 px-4 py-2.5 rounded-full border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />

      {selected.length > 0 && (
        <div data-testid="bulk-bar" className="sticky top-4 z-30 mb-3 bg-[#1A2B4C] text-white rounded-2xl px-4 py-3 flex items-center justify-between shadow-lg">
          <span className="text-sm font-semibold">{selected.length} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => bulkAction("publish")} disabled={bulkBusy} data-testid="bulk-publish" className="px-3 py-1.5 rounded-full bg-[#4F7363] text-xs font-semibold disabled:opacity-50">{bulkBusy ? "Working…" : "Go live"}</button>
            <button onClick={() => bulkAction("pause")} disabled={bulkBusy} data-testid="bulk-pause" className="px-3 py-1.5 rounded-full bg-white/15 text-xs font-semibold disabled:opacity-50">Pause</button>
            <button onClick={() => bulkAction("delete")} disabled={bulkBusy} data-testid="bulk-delete" className="px-3 py-1.5 rounded-full bg-red-500 text-xs font-semibold disabled:opacity-50">Delete</button>
            <button onClick={() => setSelected([])} className="px-3 py-1.5 rounded-full bg-white/10 text-xs">Cancel</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center" data-testid="products-empty">
          <Package size={28} className="mx-auto text-[#94A3B8] mb-2" />
          <h3 className="font-display text-xl font-bold text-[#1A2B4C]">No products yet</h3>
          <p className="text-sm text-[#595959] mt-1">Click <strong>Add product</strong> to upload your first item.</p>
        </div>
      ) : (
        <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
              <tr>
                <th className="px-3 py-3 w-10"></th>
                <th className="px-4 py-3">Product</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Price</th><th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const status = (p as Product & { paused?: boolean }).paused ? "paused" : "active";
                const isSel = selected.includes(p.id);
                return (
                  <tr key={p.id} className="border-t border-[#E5E2DC]" data-testid={`mp-${p.id}`}>
                    <td className="px-3 py-3">
                      <input type="checkbox" data-testid={`sel-${p.id}`} checked={isSel}
                        onChange={() => setSelected((s) => isSel ? s.filter((x) => x !== p.id) : [...s, p.id])}
                        className="w-4 h-4 accent-[#E68910]" />
                    </td>
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
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${STATUS_TONE[status]}`}>{status}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">₹{Number(p.price).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      <a href={`/product/${p.id}`} target="_blank" rel="noopener noreferrer" data-testid={`preview-${p.id}`} title="Preview PDP" className="inline-flex items-center gap-1 text-xs font-semibold text-[#1A2B4C] hover:underline">
                        Preview <ExternalLink size={11} />
                      </a>
                      <button onClick={() => openEdit(p)} data-testid={`edit-product-${p.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#1A2B4C] hover:underline">
                        <Edit3 size={11} /> Edit
                      </button>
                      {status === "paused" ? (
                        <button onClick={() => togglePublish(p, "live")} data-testid={`go-live-${p.id}`} className="text-xs font-semibold text-[#4F7363] hover:underline">Go live</button>
                      ) : (
                        <button onClick={() => togglePublish(p, "paused")} data-testid={`pause-${p.id}`} className="text-xs font-semibold text-[#E68910] hover:underline">Pause</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openAdd && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpenAdd(false)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="new-product-modal">
            <h2 className="font-display text-2xl font-bold text-[#1A2B4C] mb-4">{editingId ? "Edit product" : "New product"}</h2>
            <div className="space-y-3">
              <input data-testid="prod-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Product name *" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <div className="grid grid-cols-2 gap-3">
                <input data-testid="prod-price" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Selling price (₹) *" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
                <input data-testid="prod-mrp" inputMode="numeric" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} placeholder="MRP (₹)" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              </div>

              {/* Category */}
              <select data-testid="prod-l1" required value={form.l1_id} onChange={(e) => setForm({ ...form, l1_id: e.target.value, l2_id: "", gender: "" })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none bg-white">
                <option value="">Select category *</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {hasL2 ? (
                <select data-testid="prod-l2" required value={form.l2_id} onChange={(e) => setForm({ ...form, l2_id: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none bg-white">
                  <option value="">Select sub-category *</option>
                  {(currentL1?.l2 || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              ) : form.l1_id ? (
                <select data-testid="prod-gender" required value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none bg-white">
                  <option value="">Select gender *</option>
                  {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              ) : null}

              {/* Image upload */}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">Product images (up to {MAX_IMAGES}) *</div>
                <div className="flex flex-wrap gap-2">
                  {form.images.map((img, i) => (
                    <div key={i} className="relative w-20 h-24 rounded-xl overflow-hidden bg-[#FDFBF7] border border-[#E5E2DC]" data-testid={`prod-image-thumb-${i}`}>
                      <Image src={img} alt={`image ${i + 1}`} fill sizes="80px" className="object-cover" unoptimized />
                      <button type="button" onClick={() => removeImage(i)} aria-label={`Remove image ${i + 1}`} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/95 shadow flex items-center justify-center hover:bg-red-100">
                        <X size={12} className="text-red-500" />
                      </button>
                      {i === 0 && <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-full bg-[#1A2B4C] text-white text-[9px] font-bold flex items-center gap-0.5"><Star size={8} /> COVER</div>}
                    </div>
                  ))}
                  {form.images.length < MAX_IMAGES && (
                    <label className="w-20 h-24 rounded-xl border-2 border-dashed border-[#E5E2DC] hover:border-[#1A2B4C] flex flex-col items-center justify-center gap-1 cursor-pointer text-[#595959] text-[10px]">
                      {imageBusy ? <Loader2 size={16} className="animate-spin" /> : <><Upload size={14} /><span>Upload</span></>}
                      <input data-testid="prod-add-image" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { onPickFile(e.target.files?.[0]); e.target.value = ""; }} />
                    </label>
                  )}
                </div>
              </div>

              {/* Sizes + stock */}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">Sizes & inventory</div>
                <div className="flex flex-wrap gap-2 mb-2">
                  {SIZE_PRESETS.map((sz) => {
                    const has = form.sizes.includes(sz);
                    return (
                      <button key={sz} type="button" onClick={() => toggleSize(sz)} data-testid={`size-toggle-${sz}`}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${has ? "bg-[#1A2B4C] text-white border-[#1A2B4C]" : "bg-white text-[#1A2B4C] border-[#E5E2DC]"}`}>
                        {sz}
                      </button>
                    );
                  })}
                </div>
                {form.sizes.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {form.sizes.map((sz) => (
                      <label key={sz} className="text-xs">
                        <span className="text-[#595959]">{sz} stock</span>
                        <input data-testid={`prod-stock-${sz}`} type="number" min={0} value={form.stock[sz] ?? 0}
                          onChange={(e) => setForm((f) => ({ ...f, stock: { ...f.stock, [sz]: Math.max(0, Number(e.target.value || 0)) } }))}
                          className="mt-0.5 w-full px-3 py-1.5 rounded-lg border border-[#E5E2DC] outline-none" />
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <textarea data-testid="prod-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Product description" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />

              <label className="flex items-start gap-2 text-xs">
                <input data-testid="prod-return-eligible" type="checkbox" checked={form.return_eligible} onChange={(e) => setForm({ ...form, return_eligible: e.target.checked })} className="mt-0.5 w-4 h-4 accent-[#E68910]" />
                <span><strong>Return eligible</strong> — customers can return this within 24 hours of delivery</span>
              </label>
            </div>
            <div className="flex gap-2 pt-5">
              <button onClick={() => { setOpenAdd(false); setEditingId(null); setForm(blankForm); }} className="flex-1 px-5 py-2.5 rounded-full border border-[#E5E2DC]">Cancel</button>
              <button onClick={submit} disabled={submitBusy || imageBusy} data-testid="save-product-btn" className="flex-1 px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold disabled:opacity-50">
                {submitBusy ? "Saving…" : editingId ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
