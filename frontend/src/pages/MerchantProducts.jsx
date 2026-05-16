import React, { useEffect, useState } from "react";
import { Plus, Package, Upload, Sparkles, Wand2, X, ImagePlus, Rocket, Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import MerchantLayout from "../components/merchant/MerchantLayout";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

const SAMPLE_CSV = `name,description,l1,l2,gender,mrp,price,sizes,stock_per_size
Indigo Block-Print Kurta,Pure cotton hand-block,Women,Ethnic wear,,3499,1899,S;M;L;XL,10
Oversized Tee,240GSM oversized graphic tee,Men,T-shirts,,1499,899,M;L;XL,15
White Court Sneakers,Classic low-top court sneakers,Footwear,,women,4999,3499,7;8;9;10,8`;

export default function MerchantProducts() {
  const { merchant } = useAuth();
  const nav = useNavigate();
  const [products, setProducts] = useState([]);
  const [cats, setCats] = useState([]);
  const [openAdd, setOpenAdd] = useState(false);
  const [openImg, setOpenImg] = useState(null);
  const [form, setForm] = useState({ name: "", price: "", mrp: "", l1_id: "", l2_id: "", gender: "", description: "", image: "", sizes: "" });
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = () => api.get("/merchant/products").then((r) => setProducts(r.data));
  useEffect(() => { load(); api.get("/categories").then((r) => setCats(r.data)); }, []);

  const selectedL1 = cats.find((c) => c.id === form.l1_id);
  const needsL2 = selectedL1 && selectedL1.l2 && selectedL1.l2.length > 0;
  const needsGender = selectedL1 && !needsL2;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.l1_id) return toast.error("Pick a category");
    if (needsL2 && !form.l2_id) return toast.error("Pick a sub-category");
    if (needsGender && !form.gender) return toast.error("Pick gender for this category");
    try {
      await api.post("/merchant/products", {
        ...form, price: Number(form.price), mrp: Number(form.mrp) || null,
        sizes: form.sizes.split(",").map((s) => s.trim()).filter(Boolean),
      });
      toast.success("Product added");
      setOpenAdd(false);
      setForm({ name: "", price: "", mrp: "", l1_id: "", l2_id: "", gender: "", description: "", image: "", sizes: "" });
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
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "bharat-products-sample.csv"; a.click();
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
            <button onClick={downloadSample} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-[#E5E2DC] text-sm font-semibold hover:border-[#1A2B4C]"><Download size={14} /> Sample CSV</button>
            <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-[#E5E2DC] text-sm font-semibold hover:border-[#1A2B4C] cursor-pointer">
              <Upload size={14} /> {bulkBusy ? "Importing…" : "Bulk upload CSV"}
              <input data-testid="bulk-csv" type="file" accept=".csv" className="hidden" onChange={(e) => handleBulk(e.target.files?.[0])} />
            </label>
            <button onClick={() => setOpenAdd(true)} data-testid="add-product-btn" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#1A2B4C] text-white text-sm font-semibold hover:bg-[#101D36]"><Plus size={14} /> Add product</button>
            {hasStorefront && products.length >= 1 && (
              <button onClick={goLive} data-testid="go-live-btn" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#E68910] text-white text-sm font-semibold hover:bg-[#C9770E]"><Rocket size={14} /> Go live</button>
            )}
          </div>
        </div>

        {!hasStorefront && (
          <div className="mb-6 p-4 rounded-2xl bg-[#E68910]/10 border border-[#E68910]/30 text-sm">
            <strong>Set up your storefront first</strong> — open Storefront in the sidebar.
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
              return (
                <div key={p.id} data-testid={`mp-${p.id}`} className="bg-white rounded-2xl border border-[#E5E2DC] overflow-hidden">
                  {p.image ? <img src={p.image} alt={p.name} className="w-full aspect-[4/5] object-cover" /> :
                            <div className="w-full aspect-[4/5] bg-[#FDFBF7] flex items-center justify-center"><Package className="text-[#E5E2DC]" size={36} /></div>}
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
              <input placeholder="Image URL (optional)" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" />
              <input placeholder="Sizes (e.g. S, M, L)" value={form.sizes} onChange={(e) => setForm({ ...form, sizes: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" />
              <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" />
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setOpenAdd(false)} className="flex-1 px-5 py-3 rounded-full border border-[#E5E2DC]">Cancel</button>
                <button type="submit" className="flex-1 px-5 py-3 rounded-full bg-[#E68910] text-white font-semibold">Save</button>
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
  const [image, setImage] = useState(product.image || "");
  const [tryonImg, setTryonImg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);

  const upload = async (f) => {
    if (!f) return;
    setFile(f);
    const r = new FileReader();
    r.onload = () => setImage(r.result); r.readAsDataURL(f);
  };

  const tryOn = async () => {
    if (!file) return toast.error("Upload a product image file first");
    setBusy(true); setTryonImg(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post("/merchant/ai/tryon", fd, { headers: { "Content-Type": "multipart/form-data" } });
      if (data.image_base64) {
        setTryonImg(`data:image/png;base64,${data.image_base64}`);
        toast.success("AI model try-on ready");
      } else {
        toast.error(data.message || "AI couldn't process this image");
      }
    } catch (e) { toast.error("Try-on failed"); }
    finally { setBusy(false); }
  };

  const save = async () => {
    try {
      await api.put(`/merchant/products/${product.id}`, { image: tryonImg || image, ai_enhanced: !!tryonImg });
      toast.success("Saved"); onClose();
    } catch { toast.error("Save failed"); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="display text-xl font-bold text-[#1A2B4C]">{product.name} — Images</h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full border border-[#E5E2DC] flex items-center justify-center"><X size={16} /></button>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-2">Product image</div>
            <div className="aspect-[4/5] rounded-2xl overflow-hidden bg-[#FDFBF7] border-2 border-dashed border-[#E5E2DC] flex items-center justify-center">
              {image ? <img src={image} alt="product" className="w-full h-full object-cover" /> : <Package className="text-[#E5E2DC]" size={48} />}
            </div>
            <label className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-full border border-[#E5E2DC] cursor-pointer hover:border-[#1A2B4C]">
              <Upload size={14} /> <span className="text-sm">Upload image</span>
              <input data-testid="prod-image-upload" type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            </label>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[#E68910] font-semibold mb-2">AI model try-on</div>
            <div className="aspect-[4/5] rounded-2xl overflow-hidden bg-[#1A2B4C] relative">
              {busy && <div className="absolute inset-0 flex flex-col items-center justify-center text-white"><Sparkles size={28} className="text-[#E68910] animate-spin mb-2" /><div className="text-sm">Composing model shot…</div></div>}
              {tryonImg && !busy && <img src={tryonImg} alt="tryon" className="w-full h-full object-cover bf-fadeup" />}
              {!tryonImg && !busy && <div className="absolute inset-0 flex items-center justify-center text-white/40 text-xs px-4 text-center">Upload your product photo, then click "Try on a model"</div>}
            </div>
            <button onClick={tryOn} disabled={busy || !file} data-testid="ai-tryon-btn" className="mt-3 w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#1A2B4C] text-white text-sm font-semibold disabled:opacity-50">
              <Wand2 size={14} /> {busy ? "Working…" : "Try on a model"}
            </button>
            <p className="text-[10px] text-[#595959] mt-2">AI keeps your product's exact design — only adds a model.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-[#E5E2DC]">
          <button onClick={onClose} className="px-5 py-2.5 rounded-full border border-[#E5E2DC]">Close</button>
          <button onClick={save} data-testid="save-images" className="px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold">Save</button>
        </div>
      </div>
    </div>
  );
}
