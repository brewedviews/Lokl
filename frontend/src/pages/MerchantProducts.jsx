import React, { useEffect, useState } from "react";
import { Plus, Package } from "lucide-react";
import api from "../lib/api";
import MerchantLayout from "../components/merchant/MerchantLayout";
import { toast } from "sonner";

export default function MerchantProducts() {
  const [products, setProducts] = useState([]);
  const [cats, setCats] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", price: "", mrp: "", category_id: "", description: "", image: "", sizes: "" });

  const load = () => api.get("/merchant/products").then((r) => setProducts(r.data));
  useEffect(() => { load(); api.get("/categories").then((r) => setCats(r.data)); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/merchant/products", {
        ...form, price: Number(form.price), mrp: Number(form.mrp) || null,
        sizes: form.sizes.split(",").map((s) => s.trim()).filter(Boolean),
      });
      toast.success("Product added");
      setOpen(false);
      setForm({ name: "", price: "", mrp: "", category_id: "", description: "", image: "", sizes: "" });
      load();
    } catch (e) { toast.error("Failed"); }
  };

  return (
    <MerchantLayout>
      <div className="p-8 md:p-12">
        <div className="flex items-center justify-between mb-8">
          <h1 data-testid="products-title" className="display text-4xl font-bold text-[#1A2B4C]">Products</h1>
          <button onClick={() => setOpen(true)} data-testid="add-product-btn" className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#1A2B4C] text-white font-semibold hover:bg-[#101D36]">
            <Plus size={16} /> Add product
          </button>
        </div>

        {products.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-[#E5E2DC]">
            <Package size={48} className="mx-auto text-[#E68910] mb-4" />
            <p className="text-[#595959]">No products yet. Add your first product or try the AI Catalog Studio.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {products.map((p) => (
              <div key={p.id} data-testid={`mproduct-${p.id}`} className="bg-white rounded-2xl border border-[#E5E2DC] overflow-hidden">
                {p.image ? <img src={p.image} alt={p.name} className="w-full aspect-[4/5] object-cover" /> :
                          <div className="w-full aspect-[4/5] bg-[#FDFBF7] flex items-center justify-center"><Package className="text-[#E5E2DC]" size={32} /></div>}
                <div className="p-3">
                  <div className="font-semibold text-sm text-[#1A2B4C] truncate">{p.name}</div>
                  <div className="text-sm font-bold text-[#1A2B4C] mt-1">₹{Number(p.price).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {open && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <form onSubmit={submit} className="bg-white rounded-3xl w-full max-w-lg p-6 space-y-3">
              <h2 className="display text-2xl font-bold text-[#1A2B4C] mb-2">New product</h2>
              <input required placeholder="Product name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" />
              <div className="grid grid-cols-2 gap-3">
                <input required type="number" placeholder="Price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" />
                <input type="number" placeholder="MRP" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" />
              </div>
              <select required value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none">
                <option value="">Choose category</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input placeholder="Image URL" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" />
              <input placeholder="Sizes (e.g. S, M, L)" value={form.sizes} onChange={(e) => setForm({ ...form, sizes: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" />
              <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" />
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="flex-1 px-5 py-3 rounded-full border border-[#E5E2DC]">Cancel</button>
                <button type="submit" className="flex-1 px-5 py-3 rounded-full bg-[#E68910] text-white font-semibold">Save</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </MerchantLayout>
  );
}
