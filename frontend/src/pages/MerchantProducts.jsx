import React, { useEffect, useState } from "react";
import { Plus, Package, Upload, X, ImagePlus, Rocket, Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import MerchantLayout from "../components/merchant/MerchantLayout";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

const SAMPLE_CSV = `name,description,l1,l2,gender,mrp,price,sizes,stock_per_size
Indigo Block-Print Kurta,Pure cotton hand-block,Women,Ethnic wear,,3499,1899,S;M;L;XL,50;100;39;10
Oversized Tee,240GSM oversized graphic tee,Men,T-shirts,,1499,899,M;L;XL,30;45;20
White Court Sneakers,Classic low-top court sneakers,Footwear,,women,4999,3499,7;8;9;10,8;12;10;6`;

export default function MerchantProducts() {
  const { merchant } = useAuth();
  const nav = useNavigate();
  const [products, setProducts] = useState([]);
  const [cats, setCats] = useState([]);
  const [openAdd, setOpenAdd] = useState(false);
  const [openImg, setOpenImg] = useState(null);
  const blankForm = { name: "", price: "", mrp: "", l1_id: "", l2_id: "", gender: "", description: "", images: [], stock: {} };
  const [form, setForm] = useState(blankForm);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const MAX_IMAGES = 5;

  const toggleSel = (id) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const clearSel = () => setSelectedIds(new Set());

  const bulkAction = async (op) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return toast.error("Pick at least one product");
    if (op === "delete" && !window.confirm(`Delete ${ids.length} product(s)? This cannot be undone.`)) return;
    try {
      await api.post("/merchant/products/bulk-action", { ids, action: op });
      toast.success(op === "delete" ? "Deleted" : op === "publish" ? "Marked live" : "Paused");
      clearSel(); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const togglePublish = async (p, to) => {
    try {
      await api.put(`/merchant/products/${p.id}`, { paused: to === "live" ? false : true });
      toast.success(to === "live" ? "Marked live" : "Paused");
      load();
    } catch { toast.error("Failed"); }
  };

  const load = () => api.get("/merchant/products").then((r) => setProducts(r.data));
  useEffect(() => { load(); api.get("/categories").then((r) => setCats(r.data)); }, []);

  const selectedL1 = cats.find((c) => c.id === form.l1_id);
  const needsL2 = selectedL1 && selectedL1.l2 && selectedL1.l2.length > 0;
  const needsGender = selectedL1 && !needsL2;

  // Size catalog depends on category — apparel uses S–XXL, footwear uses numeric.
  const isFootwear = form.l1_id === "l1-footwear" || form.l2_id?.includes("footwear");
  const SIZE_OPTIONS = isFootwear ? ["6", "7", "8", "9", "10", "11"] : ["XS", "S", "M", "L", "XL", "XXL"];

  const setStock = (size, qty) => {
    const next = { ...form.stock };
    const n = parseInt(qty, 10);
    if (!qty || isNaN(n) || n <= 0) delete next[size];
    else next[size] = n;
    setForm({ ...form, stock: next });
  };

  const onPickFile = (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("Image too large (max 5MB)");
    if (form.images.length >= MAX_IMAGES) return toast.error(`Max ${MAX_IMAGES} images per product`);
    setImageBusy(true);
    const r = new FileReader();
    r.onload = () => { setForm((f) => ({ ...f, images: [...f.images, r.result] })); setImageBusy(false); };
    r.onerror = () => { toast.error("Could not read image"); setImageBusy(false); };
    r.readAsDataURL(file);
  };

  const removeImage = (idx) => setForm((f) => ({ ...f, images: f.images.filter((_, i) => i !== idx) }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.l1_id) return toast.error("Pick a category");
    if (needsL2 && !form.l2_id) return toast.error("Pick a sub-category");
    if (needsGender && !form.gender) return toast.error("Pick gender for this category");
    if (!form.images.length) return toast.error("Upload at least one product image");
    const sizes = Object.keys(form.stock);
    if (sizes.length === 0) return toast.error("Add quantity for at least one size");
    try {
      await api.post("/merchant/products", {
        name: form.name, description: form.description,
        l1_id: form.l1_id, l2_id: form.l2_id, gender: form.gender,
        price: Number(form.price), mrp: Number(form.mrp) || null,
        image: form.images[0], images: form.images, sizes, stock: form.stock,
      });
      toast.success("Product added");
      setOpenAdd(false);
      setForm(blankForm);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleBulk = async (file) => {
    if (!file) return;
    setBulkBusy(true);
    const fd = new FormData(); fd.append("file", file);
    try {
      const { data } = await api.post("/merchant/products/bulk", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Imported ${data.created}${data.skipped?.length ? ` · skipped ${data.skipped.length}` : ""}`);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Bulk import failed"); }
    finally { setBulkBusy(false); }
  };

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "lokl-products-sample.csv"; a.click();
  };

  const goLive = async () => {
    try { await api.post("/merchant/publish"); toast.success("Going live within 1 hour"); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed to publish"); }
  };

  const hasStorefront = !!merchant?.storefront;

  return (
    <MerchantLayout>
      <div className="p-6 md:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 data-testid="products-title" className="display text-3xl md:text-4xl font-bold text-[#1A2B4C]">Products</h1>
            <p className="text-[#595959] text-sm mt-1">{products.length} product{products.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={downloadSample} title="CSV format: sizes=S;M;L  stock_per_size=50;100;39" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-[#E5E2DC] text-sm font-semibold hover:border-[#1A2B4C]"><Download size={14} /> Sample CSV</button>
            <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-[#E5E2DC] text-sm font-semibold hover:border-[#1A2B4C] cursor-pointer">
              <Upload size={14} /> {bulkBusy ? "Importing…" : "Bulk upload CSV"}
              <input data-testid="bulk-csv" type="file" accept=".csv" className="hidden" onChange={(e) => handleBulk(e.target.files?.[0])} />
            </label>
            <button onClick={() => setOpenAdd(true)} data-testid="add-product-btn" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#1A2B4C] text-white text-sm font-semibold hover:bg-[#101D36]"><Plus size={14} /> Add product</button>
          </div>
        </div>

        {hasStorefront && products.length >= 1 && products.every((p) => p.paused) && (
          <div className="mb-4 p-3 rounded-xl bg-[#E68910]/10 border border-[#E68910]/30 text-xs text-[#1A2B4C]">
            None of your products are live yet — hover over a product card and click <strong>Go live</strong>, or use bulk-select.
          </div>
        )}

        {!hasStorefront && (
          <div className="mb-6 p-4 rounded-2xl bg-[#E68910]/10 border border-[#E68910]/30 text-sm">
            <strong>Set up your storefront first</strong> — open Storefront in the sidebar.
          </div>
        )}

        {selectedIds.size > 0 && (
          <div data-testid="bulk-bar" className="sticky top-4 z-30 mb-3 bg-[#1A2B4C] text-white rounded-2xl px-4 py-3 flex items-center justify-between shadow-lg">
            <div className="text-sm font-semibold">{selectedIds.size} selected</div>
            <div className="flex gap-2">
              <button onClick={() => bulkAction("publish")} data-testid="bulk-publish" className="px-3 py-1.5 rounded-full bg-[#4F7363] text-xs font-semibold">Go live</button>
              <button onClick={() => bulkAction("pause")} data-testid="bulk-pause" className="px-3 py-1.5 rounded-full bg-white/15 text-xs font-semibold">Pause</button>
              <button onClick={() => bulkAction("delete")} data-testid="bulk-delete" className="px-3 py-1.5 rounded-full bg-red-500 text-xs font-semibold">Delete</button>
              <button onClick={clearSel} className="px-3 py-1.5 rounded-full bg-white/10 text-xs">Cancel</button>
            </div>
          </div>
        )}

        {products.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-[#E5E2DC]">
            <Package size={48} className="mx-auto text-[#E68910] mb-4" />
            <p className="text-[#595959]">No products yet. Add one or upload a CSV.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((p) => {
              const l1 = cats.find((c) => c.id === p.l1_id);
              const l2 = l1?.l2?.find((s) => s.id === p.l2_id);
              const isLive = !p.paused;
              const isSel = selectedIds.has(p.id);
              return (
                <div key={p.id} data-testid={`mp-${p.id}`} className={`group bg-white rounded-2xl border-2 overflow-hidden relative transition ${isSel ? "border-[#E68910]" : "border-[#E5E2DC]"}`}>
                  <label className="absolute top-2 left-2 z-10 cursor-pointer">
                    <input type="checkbox" checked={isSel} onChange={() => toggleSel(p.id)} data-testid={`sel-${p.id}`} className="w-5 h-5 accent-[#E68910]" />
                  </label>
                  {!isLive && (
                    <span className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide">paused</span>
                  )}
                  {p.image ? <img src={p.image} alt={p.name} className="w-full aspect-[4/5] object-cover" /> :
                            <div className="w-full aspect-[4/5] bg-[#FDFBF7] flex items-center justify-center"><Package className="text-[#E5E2DC]" size={36} /></div>}
                  {/* Per-product hover Go-Live (only when paused) */}
                  {!isLive && (
                    <button onClick={() => togglePublish(p, "live")} data-testid={`go-live-${p.id}`}
                      className="absolute inset-x-3 bottom-3 opacity-0 group-hover:opacity-100 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-[#E68910] text-white text-xs font-bold shadow-lg transition">
                      <Rocket size={12} /> Go live
                    </button>
                  )}
                  <div className="p-3">
                    <div className="font-semibold text-sm text-[#1A2B4C] truncate">{p.name}</div>
                    <div className="text-[10px] text-[#595959] uppercase">{l1?.name} {l2 ? `· ${l2.name}` : p.gender ? `· ${p.gender}` : ""}</div>
                    <div className="text-sm font-bold text-[#1A2B4C] mt-1">₹{Number(p.price).toLocaleString()}</div>
                    <button onClick={() => setOpenImg(p)} className="mt-2 w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold border border-[#E68910]/40 text-[#E68910] hover:bg-[#E68910]/10">
                      <ImagePlus size={11} /> {p.image ? "Edit images" : "Add images"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {openAdd && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <form onSubmit={submit} className="bg-white rounded-3xl w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-y-auto">
              <h2 className="display text-2xl font-bold text-[#1A2B4C] mb-2">New product</h2>
              <input required placeholder="Product name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" />
              <div className="grid grid-cols-2 gap-3">
                <input required type="number" placeholder="Selling price *" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" />
                <input type="number" placeholder="MRP" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" />
              </div>
              <select required value={form.l1_id} onChange={(e) => setForm({ ...form, l1_id: e.target.value, l2_id: "", gender: "" })} data-testid="prod-l1" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none">
                <option value="">Category (L1) *</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {needsL2 && (
                <select required value={form.l2_id} onChange={(e) => setForm({ ...form, l2_id: e.target.value })} data-testid="prod-l2" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none">
                  <option value="">Sub-category (L2) *</option>
                  {selectedL1.l2.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {needsGender && (
                <select required value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} data-testid="prod-gender" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none">
                  <option value="">Gender * (men/women/unisex/kids)</option>
                  <option value="women">Women</option><option value="men">Men</option><option value="unisex">Unisex</option><option value="kids">Kids</option>
                </select>
              )}
              {/* Image upload — up to 5 images, file → base64 */}
              <div>
                <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-1.5">Product images * <span className="text-[#595959] normal-case tracking-normal">({form.images.length}/{MAX_IMAGES})</span></div>
                <div className="flex flex-wrap gap-2 items-start">
                  {form.images.map((src, i) => (
                    <div key={i} className="relative w-20 h-24 rounded-xl overflow-hidden bg-[#FDFBF7] border border-[#E5E2DC]" data-testid={`prod-image-thumb-${i}`}>
                      <img src={src} alt={`preview-${i}`} className="w-full h-full object-cover" />
                      {i === 0 && <span className="absolute bottom-0 left-0 right-0 text-[9px] font-bold text-white bg-[#1A2B4C]/80 text-center py-0.5">COVER</span>}
                      <button type="button" onClick={() => removeImage(i)} aria-label={`Remove image ${i + 1}`} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/95 shadow flex items-center justify-center hover:bg-red-100">
                        <X size={11} className="text-red-500" />
                      </button>
                    </div>
                  ))}
                  {form.images.length < MAX_IMAGES && (
                    <label className="w-20 h-24 rounded-xl bg-[#FDFBF7] border border-dashed border-[#E5E2DC] flex flex-col items-center justify-center cursor-pointer hover:border-[#1A2B4C] text-[10px] text-[#595959] gap-1">
                      <ImagePlus size={18} className="text-[#E5E2DC]" />
                      <span>{imageBusy ? "Reading…" : "Add"}</span>
                      <input data-testid="prod-add-image" type="file" accept="image/*" className="hidden" onChange={(e) => { onPickFile(e.target.files?.[0]); e.target.value = ""; }} />
                    </label>
                  )}
                </div>
                <p className="text-[10px] text-[#595959] mt-1">First image becomes the cover. Customers see all images as a carousel on the product page.</p>
              </div>

              {/* Size + Quantity grid */}
              <div>
                <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-1.5">Sizes & quantity *</div>
                <div className="grid grid-cols-3 gap-2">
                  {SIZE_OPTIONS.map((sz) => (
                    <div key={sz} className="flex items-center gap-2 px-2 py-1.5 rounded-xl border border-[#E5E2DC] bg-white">
                      <span className="text-xs font-semibold text-[#1A2B4C] w-7">{sz}</span>
                      <input
                        type="number" min="0" placeholder="0"
                        data-testid={`prod-stock-${sz}`}
                        value={form.stock[sz] ?? ""}
                        onChange={(e) => setStock(sz, e.target.value)}
                        className="flex-1 min-w-0 px-1.5 py-1 text-sm rounded-md bg-transparent outline-none border border-transparent focus:border-[#E68910]"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-[#595959] mt-1">Enter quantity for each size you stock. Leave blank for sizes you don't carry.</p>
              </div>

              <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" />
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => { setOpenAdd(false); setForm(blankForm); }} className="flex-1 px-5 py-3 rounded-full border border-[#E5E2DC]">Cancel</button>
                <button type="submit" data-testid="save-product-btn" className="flex-1 px-5 py-3 rounded-full bg-[#E68910] text-white font-semibold">Save</button>
              </div>
            </form>
          </div>
        )}

        {openImg && <ImageManager product={openImg} onClose={() => { setOpenImg(null); load(); }} />}
      </div>
    </MerchantLayout>
  );
}

function ImageManager({ product, onClose }) {
  const initial = (product.images && product.images.length > 0)
    ? product.images
    : (product.image ? [product.image] : []);
  const [images, setImages] = useState(initial);
  const [busy, setBusy] = useState(false);
  const MAX = 5;

  const upload = async (f) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast.error("Image too large (max 5MB)");
    if (images.length >= MAX) return toast.error(`Max ${MAX} images per product`);
    setBusy(true);
    const r = new FileReader();
    r.onload = () => { setImages((arr) => [...arr, r.result]); setBusy(false); };
    r.onerror = () => { toast.error("Could not read image"); setBusy(false); };
    r.readAsDataURL(f);
  };

  const removeAt = (idx) => setImages((arr) => arr.filter((_, i) => i !== idx));
  const moveToFront = (idx) => setImages((arr) => {
    if (idx === 0) return arr;
    const next = arr.slice(); const [it] = next.splice(idx, 1); next.unshift(it); return next;
  });

  const save = async () => {
    if (!images.length) return toast.error("Add at least one image");
    try {
      await api.put(`/merchant/products/${product.id}`, { image: images[0], images });
      toast.success("Saved"); onClose();
    } catch { toast.error("Save failed"); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="display text-xl font-bold text-[#1A2B4C]">{product.name} — Images <span className="text-xs font-normal text-[#595959]">({images.length}/{MAX})</span></h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full border border-[#E5E2DC] flex items-center justify-center"><X size={16} /></button>
        </div>
        <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-2">Carousel preview (first = cover)</div>
        {images.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {images.map((src, i) => (
              <div key={i} data-testid={`mgr-thumb-${i}`} className={`relative aspect-square rounded-xl overflow-hidden border-2 ${i === 0 ? "border-[#1A2B4C]" : "border-[#E5E2DC]"}`}>
                <img src={src} alt={`img-${i}`} className="w-full h-full object-cover" />
                {i === 0 && <span className="absolute bottom-0 left-0 right-0 text-[9px] font-bold text-white bg-[#1A2B4C]/80 text-center py-0.5">COVER</span>}
                <div className="absolute top-1 right-1 flex flex-col gap-1">
                  <button type="button" onClick={() => removeAt(i)} aria-label="Remove" className="w-6 h-6 rounded-full bg-white/95 shadow flex items-center justify-center hover:bg-red-100"><X size={12} className="text-red-500" /></button>
                  {i !== 0 && (
                    <button type="button" onClick={() => moveToFront(i)} aria-label="Make cover" data-testid={`mgr-cover-${i}`} className="w-6 h-6 rounded-full bg-white/95 shadow flex items-center justify-center text-[#1A2B4C] text-[10px] font-bold hover:bg-[#E68910] hover:text-white">★</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="aspect-[4/5] rounded-2xl overflow-hidden bg-[#FDFBF7] border-2 border-dashed border-[#E5E2DC] flex items-center justify-center mb-3">
            <Package className="text-[#E5E2DC]" size={48} />
          </div>
        )}
        {images.length < MAX && (
          <label className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full border border-[#E5E2DC] cursor-pointer hover:border-[#1A2B4C]">
            <Upload size={14} /> <span className="text-sm">{busy ? "Reading…" : "Add image"}</span>
            <input data-testid="prod-image-upload" type="file" accept="image/*" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        )}
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-[#E5E2DC]">
          <button onClick={onClose} className="px-5 py-2.5 rounded-full border border-[#E5E2DC]">Close</button>
          <button onClick={save} data-testid="save-images" className="px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold">Save</button>
        </div>
      </div>
    </div>
  );
}
