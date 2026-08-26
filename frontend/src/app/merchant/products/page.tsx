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
import { Package, Plus, Download, Upload, X, Star, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { downloads } from "@/lib/downloads";
import { useMerchantAuthStore } from "@/stores";
import { uploadImage, deleteUploadedImage } from "@/lib/uploads";
import { BrandCombobox } from "@/components/merchant/BrandCombobox";
import type { Product } from "@/types";

interface L2 { id: string; name: string }
interface Category { id: string; name: string; l2: L2[] }

// G14 — bulk-upload mapping/preview + results types. Mirror the backend's
// /bulk/detect and /bulk response shapes (server.py bulk_products /
// bulk_products_detect) exactly — see xlsx_template.py's CANONICAL_ALIASES
// for what each field name means.
interface BulkDetectResult {
  sheet_names: string[]; selected_sheet: string | null;
  columns: Array<{ header: string; mapped_field: string | null }>;
  row_count: number; looks_like_lokl_template: boolean;
  unmapped_required: string[];
}
interface BulkImportResult {
  created: number; created_ids: string[]; names: string[]; skipped: string[];
  brands_matched: string[]; brands_unmatched: string[]; brands_unmatched_note?: string;
  warning?: string;
}
const CANONICAL_FIELD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "name", label: "Product Name" },
  { value: "description", label: "Description" },
  { value: "gender", label: "Gender" },
  { value: "l1", label: "L1 Category" },
  { value: "l2", label: "L2 Category" },
  { value: "mrp", label: "MRP" },
  { value: "price", label: "Selling Price" },
  { value: "sizes", label: "Sizes" },
  { value: "stock_per_size", label: "Stock per Size" },
  { value: "stock_total", label: "Stock (single quantity)" },
  { value: "returnable", label: "Returnable" },
  { value: "return_window_hours", label: "Return Window (Hours)" },
  { value: "try_at_doorstep", label: "Try & Buy" },
  { value: "brand", label: "Brand" },
  { value: "image", label: "Image URL" },
];
const REQUIRED_FIELD_LABELS: Record<string, string> = {
  name: "Product Name", l1: "L1 Category", price: "Selling Price", mrp: "MRP",
};

const GENDERS = ["women", "men", "unisex", "kids"];
const MAX_IMAGES = 5;
const SIZE_TYPE_OPTIONS: Record<string, { label: string; sizes: string[] }> = {
  alpha:          { label: "Alpha (XS–XXL)",   sizes: ["XS", "S", "M", "L", "XL", "XXL"] },
  numeric_shirt:  { label: "Numeric – Shirt",  sizes: ["38", "40", "42", "44", "46"] },
  numeric_bottom: { label: "Numeric – Bottom", sizes: ["28", "30", "32", "34", "36"] },
  numeric_shoe:   { label: "Numeric – Shoe",   sizes: ["5", "6", "7", "8", "9", "10", "11"] },
  free_size:      { label: "Free size",        sizes: ["Free Size"] },
  custom:         { label: "Custom",           sizes: [] },
};

const blankForm = {
  name: "", price: "", mrp: "", description: "",
  l1_id: "", l2_id: "", gender: "", brand_id: "",
  sizes: [] as string[], stock: {} as Record<string, number>,
  images: [] as string[], image_public_ids: [] as string[],
  return_eligible: false,
  return_window_hours: "24",
  try_at_doorstep: false,
  size_type: "",
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
  const [customSizesInput, setCustomSizesInput] = useState("");
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [step, setStep] = useState(1);
  // Public_ids the merchant has removed from the form in THIS edit session
  // but not yet confirmed via Save — see removeImage's own comment for why
  // the actual Cloudinary delete is deferred to submit() instead of firing
  // the moment the "X" is clicked (that eager-delete was a real bug: it
  // deleted the asset regardless of whether the edit was ever saved or
  // discarded, silently orphaning still-referenced product images whenever
  // a merchant removed-then-abandoned an edit).
  const [pendingDeletePublicIds, setPendingDeletePublicIds] = useState<string[]>([]);
  const bulkInputRef = useRef<HTMLInputElement | null>(null);
  // G14 — bulk-upload mapping/preview + results state. `bulkDetect` holds
  // the /bulk/detect response for a file that wasn't confidently auto-
  // mappable end-to-end (see handleBulkUpload); `bulkFile` is the pending
  // File waiting on the merchant's mapping confirmation. `bulkResult` is
  // ALWAYS set after a real import (success or partial/failure) and drives
  // the results modal — replaces the old unconditional
  // toast.success("Imported N products") that fired even when N was 0 and
  // never surfaced the (already-correct) per-row skip reasons at all.
  const [bulkDetect, setBulkDetect] = useState<BulkDetectResult | null>(null);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkMappingOverrides, setBulkMappingOverrides] = useState<Record<string, string | null>>({});
  const [bulkResult, setBulkResult] = useState<BulkImportResult | null>(null);

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

  // Removes an image from local form state only — the Cloudinary asset
  // itself is NOT deleted here. It's queued in pendingDeletePublicIds and
  // only actually deleted once submit() confirms the edit was saved (see
  // that function). Removing then discarding (backdrop/X close, or the
  // "Discard changes?" confirm) clears the queue without ever calling
  // Cloudinary — the whole point of deferring this.
  const removeImage = (idx: number) => {
    const pid = form.image_public_ids[idx];
    setForm((f) => ({
      ...f,
      images: f.images.filter((_, i) => i !== idx),
      image_public_ids: f.image_public_ids.filter((_, i) => i !== idx),
    }));
    if (pid) setPendingDeletePublicIds((ids) => [...ids, pid]);
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
        brand_id: form.brand_id || undefined,
        sizes: form.sizes,
        stock: form.stock,
        size_type: form.size_type || "",
        image: form.images[0] || "",
        image_public_id: form.image_public_ids[0] || "",
        images: form.images,
        image_public_ids: form.image_public_ids,
        return_eligible: form.return_eligible,
        return_window_hours: form.return_eligible
          ? Math.min(24, Math.max(1, Number(form.return_window_hours) || 24))
          : undefined,
        try_at_doorstep: form.try_at_doorstep,
      };
      if (editingId) {
        await api.merchant.updateProduct(editingId, body as Partial<Product>);
        toast.success("Product updated");
      } else {
        await api.merchant.createProduct(body as Partial<Product>);
        toast.success("Product created");
      }
      // Only NOW — once the edit is confirmed persisted — actually delete
      // any images the merchant removed during this session. Fire-and-
      // forget is fine here (same as the old eager call): the product
      // itself no longer references these, so a failed delete just leaves
      // an unused Cloudinary asset, not a broken customer-facing image.
      for (const pid of pendingDeletePublicIds) void deleteUploadedImage(pid);
      setPendingDeletePublicIds([]);
      setOpenAdd(false); setEditingId(null); setForm(blankForm); setCustomSizesInput(""); setStep(1);
      void load();
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSubmitBusy(false); }
  };

  const openEdit = async (p: Product) => {
    try {
      // GET /api/products/{pid} returns { product, similar }, so we have to
      // unwrap before populating the form. Reading the top-level fields was
      // the iter-44 regression that opened the edit modal blank.
      const r = await apiClient.get<{ product: Product & { image_public_id?: string; image_public_ids?: string[]; stock?: Record<string, number>; sizes?: string[]; l1_id?: string; l2_id?: string; gender?: string; mrp?: number; return_eligible?: boolean; return_window_hours?: number | null; try_at_doorstep?: boolean; images?: string[]; size_type?: string; brand_id?: string | null } }>(`/api/products/${p.id}`);
      const d = r.data.product;
      let sizeType = d.size_type || "";
      if (!sizeType && d.sizes && d.sizes.length > 0) {
        const szs = d.sizes;
        if (szs.some((s) => s === "Free Size" || s === "Free")) sizeType = "free_size";
        else if (["XS", "S", "M", "L", "XL", "XXL"].some((s) => szs.includes(s))) sizeType = "alpha";
        else if (["38", "40", "42", "44", "46"].some((s) => szs.includes(s))) sizeType = "numeric_shirt";
        else if (["28", "30", "32", "34", "36"].some((s) => szs.includes(s))) sizeType = "numeric_bottom";
        else if (["5", "6", "7", "8", "9", "10", "11"].some((s) => szs.includes(s))) sizeType = "numeric_shoe";
        else sizeType = "custom";
      }
      if (sizeType === "custom") setCustomSizesInput((d.sizes || []).join(", "));
      else setCustomSizesInput("");
      setEditingId(p.id);
      setForm({
        name: d.name || "",
        price: String(d.price || ""),
        mrp: d.mrp != null ? String(d.mrp) : "",
        description: d.description || "",
        l1_id: d.l1_id || "",
        l2_id: d.l2_id || "",
        gender: d.gender || "",
        brand_id: d.brand_id || "",
        sizes: d.sizes || [],
        stock: d.stock || {},
        images: d.images && d.images.length ? d.images : (d.image ? [d.image] : []),
        image_public_ids: d.image_public_ids && d.image_public_ids.length ? d.image_public_ids : (d.image_public_id ? [d.image_public_id] : []),
        return_eligible: !!d.return_eligible,
        return_window_hours: d.return_window_hours != null ? String(d.return_window_hours) : "24",
        try_at_doorstep: !!d.try_at_doorstep,
        size_type: sizeType,
      });
      setStep(1);
      setPendingDeletePublicIds([]);
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

  // G14 — detect columns first; only show the mapping/preview screen when
  // the file ISN'T already confidently mappable end-to-end (brief's own
  // explicit "do not force a mapping screen when the file already matches
  // canonical structure" — this covers both the Lokl template itself and
  // any merchant file that happens to already use the same header text).
  const handleBulkUpload = async (file: File | undefined) => {
    if (!file) return;
    setBulkUploadBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const detect = await api.merchant.bulkDetectColumns(fd);
      if (detect.looks_like_lokl_template && detect.unmapped_required.length === 0) {
        await runBulkImport(file, detect.selected_sheet, null);
      } else {
        // Detect finished — the busy state from here belongs to the
        // mapping modal's own "Continue import" button (runBulkImport sets
        // it again when that fires), not this initial file-select spinner.
        // Leaving this `true` permanently disabled "Continue import".
        setBulkUploadBusy(false);
        setBulkFile(file);
        setBulkDetect(detect);
        setBulkMappingOverrides({});
      }
    } catch (e) { toast.error(getErrorMessage(e)); setBulkUploadBusy(false); }
  };

  const runBulkImport = async (file: File, sheet: string | null, overrides: Record<string, string | null> | null) => {
    setBulkUploadBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (sheet) fd.append("sheet", sheet);
      if (overrides) fd.append("mapping_overrides", JSON.stringify(overrides));
      const r = await api.merchant.bulkCreateProducts(fd);
      // Always shown via the results modal below — never a silent/blanket
      // success toast, since "Imported 0 products" needs the per-row
      // reasons right next to it, not hidden behind a toast that never
      // read `r.skipped` at all (the confirmed G14 root-cause #2 bug).
      setBulkResult(r);
      if (r.brands_unmatched.length > 0) {
        toast.warning(
          `Brand not recognized for: ${r.brands_unmatched.join(", ")} — product(s) created without a brand tag. Check spelling or ask an admin to add it.`,
          { duration: 8000 },
        );
      }
      void load();
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally {
      setBulkUploadBusy(false);
      setBulkFile(null);
      setBulkDetect(null);
    }
  };

  const publishStore = async () => {
    try { await api.merchant.publish(); toast.success("Going live within 1 hour"); void load(); }
    catch (e) { toast.error(getErrorMessage(e)); }
  };

  const savePrice = async (pid: string) => {
    const newPrice = parseFloat(priceInput);
    if (!isNaN(newPrice) && newPrice > 0) {
      try {
        await apiClient.patch(`/api/merchant/products/${pid}`, { price: newPrice });
        setItems(ps => ps.map(p => p.id === pid ? { ...p, price: newPrice } : p));
        toast.success("Price updated");
      } catch {
        toast.error("Failed to update price");
      }
    }
    setEditingPrice(null);
  };

  const currentL1 = cats.find((c) => c.id === form.l1_id);
  const hasL2 = !!(currentL1 && currentL1.l2 && currentL1.l2.length > 0);

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 data-testid="products-title" className="font-display text-3xl md:text-4xl font-bold text-[#1A2B4C] flex items-center gap-2">
            <Package size={26} /> Products
          </h1>
          <p className="text-[#595959] text-sm mt-1">{items.length} product{items.length === 1 ? "" : "s"} in your catalog</p>
          <p className="text-[#94A3B8] text-xs mt-1 max-w-md">
            You can upload your own Excel or CSV file — we&apos;ll map common columns and validate your products before importing. The Lokl template is just the easiest way to get started.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void downloads.merchantProductsTemplate(token).catch((e) => toast.error(getErrorMessage(e)))} data-testid="download-template" className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-[#E5E2DC] text-sm font-semibold hover:border-[#1A2B4C]">
            <Download size={14} /> Bulk template
          </button>
          <label data-testid="bulk-upload-trigger" className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-[#E5E2DC] text-sm font-semibold hover:border-[#1A2B4C] cursor-pointer">
            {bulkUploadBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Bulk upload
            <input ref={bulkInputRef} data-testid="bulk-csv" type="file" accept=".xlsx,.csv" className="hidden"
              onChange={(e) => { handleBulkUpload(e.target.files?.[0]); if (bulkInputRef.current) bulkInputRef.current.value = ""; }} />
          </label>
          <button
            onClick={() => { setEditingId(null); setForm(blankForm); setStep(1); setPendingDeletePublicIds([]); setOpenAdd(true); }}
            data-testid="add-product-btn"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#E68910] text-white text-sm font-semibold hover:bg-[#C9770E]"
          >
            <Plus size={14} /> Add product
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <input
          type="text"
          data-testid="products-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your products..."
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-sm bg-white"
        />
        <Search size={15} className="absolute left-3 top-3 text-[#9CA3AF]" />
      </div>

      {/* Bulk action bar */}
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

      {/* Select all — the bulk-action bar above already supports go live/
          pause/delete on a selection, but had no way to select every row at
          once (G12 P1-7). Scoped to the currently-filtered/searched list,
          not the full catalog, so selecting doesn't silently grab hidden rows. */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <input
            type="checkbox"
            data-testid="select-all"
            checked={filtered.length > 0 && filtered.every((p) => selected.includes(p.id))}
            ref={(el) => {
              if (el) {
                const allSelected = filtered.every((p) => selected.includes(p.id));
                const someSelected = filtered.some((p) => selected.includes(p.id));
                el.indeterminate = someSelected && !allSelected;
              }
            }}
            onChange={() => {
              const ids = filtered.map((p) => p.id);
              const allSelected = ids.every((id) => selected.includes(id));
              setSelected(allSelected ? [] : ids);
            }}
            className="w-4 h-4 accent-[#E68910]"
          />
          <label className="text-xs font-semibold text-[#595959]">Select all</label>
        </div>
      )}

      {/* Product cards */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center" data-testid="products-empty">
          <Package size={28} className="mx-auto text-[#94A3B8] mb-2" />
          <h3 className="font-display text-xl font-bold text-[#1A2B4C]">No products yet</h3>
          <p className="text-sm text-[#595959] mt-1">Click <strong>Add product</strong> to upload your first item.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const prod = p as Product & { paused?: boolean; total_stock?: number };
            const isSel = selected.includes(p.id);
            return (
              <div key={p.id} className="bg-white rounded-2xl border border-[#E5E2DC] p-3 flex items-center gap-3" data-testid={`mp-${p.id}`}>
                {/* Checkbox */}
                <input type="checkbox" data-testid={`sel-${p.id}`} checked={isSel}
                  onChange={() => setSelected((s) => isSel ? s.filter((x) => x !== p.id) : [...s, p.id])}
                  className="w-4 h-4 accent-[#E68910] flex-shrink-0" />

                {/* Image */}
                <div className="w-16 h-16 rounded-xl overflow-hidden bg-[#F5F5F5] flex-shrink-0">
                  {p.image
                    ? <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center bg-[#E5E2DC]"><Package size={20} className="text-[#9CA3AF]" /></div>
                  }
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[#1A2B4C] text-sm truncate">{p.name}</div>
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                    {editingPrice === p.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); void savePrice(p.id); }} className="flex items-center gap-1">
                        <span className="text-xs text-[#9CA3AF]">₹</span>
                        <input
                          type="number"
                          value={priceInput}
                          onChange={e => setPriceInput(e.target.value)}
                          className="w-20 px-1.5 py-0.5 text-sm font-bold text-[#1A2B4C] border border-[#E68910] rounded-lg outline-none"
                          autoFocus
                          onBlur={() => void savePrice(p.id)}
                        />
                      </form>
                    ) : (
                      <button
                        onClick={() => { setEditingPrice(p.id); setPriceInput(String(p.price)); }}
                        className="flex items-center gap-1 text-sm font-bold text-[#1A2B4C] hover:text-[#E68910]"
                      >
                        ₹{Number(p.price).toLocaleString("en-IN")}
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                    )}
                    <span className="text-xs text-[#9CA3AF] ml-1">
                      {(() => {
                        if (prod.total_stock && prod.total_stock > 0) return `· ${prod.total_stock} in stock`;
                        const stockDict = (prod as any).stock as Record<string, number> | undefined;
                        if (stockDict && typeof stockDict === "object") {
                          const t = Object.values(stockDict).reduce((s: number, v) => s + (parseInt(String(v)) || 0), 0);
                          if (t > 0) return `· ${t} in stock`;
                        }
                        return "· Update stock";
                      })()}
                    </span>
                  </div>
                </div>

                {/* Right side — pause toggle + edit */}
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => togglePublish(p, prod.paused ? "live" : "paused")}
                    data-testid={prod.paused ? `go-live-${p.id}` : `pause-${p.id}`}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                      prod.paused
                        ? "bg-[#F5F5F5] text-[#9CA3AF] border border-[#E5E2DC]"
                        : "bg-green-50 text-green-700 border border-green-200"
                    }`}
                  >
                    {prod.paused ? "Paused" : "Live"}
                  </button>
                  <button
                    onClick={() => openEdit(p)}
                    data-testid={`edit-product-${p.id}`}
                    className="text-xs text-[#E68910] font-semibold px-2"
                  >
                    Edit →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom sheet — add / edit product */}
      {openAdd && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 z-[55]"
            onClick={() => {
              // Discarding drops the pending-delete queue untouched — any
              // images removed during this session stay exactly as they
              // were in Cloudinary, since nothing was actually saved.
              if (confirm("Discard changes?")) { setOpenAdd(false); setStep(1); setPendingDeletePublicIds([]); }
            }}
          />

          {/* Sheet */}
          <div className="fixed bottom-0 left-0 right-0 z-[60] bg-white rounded-t-3xl max-h-[92vh] flex flex-col" data-testid="new-product-modal">
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-[#E5E2DC] rounded-full" />
            </div>

            {/* Header */}
            <div className="px-5 pb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-[#1A2B4C]">
                {editingId ? "Edit product" : "Add product"}
              </h2>
              <button
                onClick={() => { setOpenAdd(false); setStep(1); setPendingDeletePublicIds([]); }}
                className="w-8 h-8 rounded-full bg-[#F5F5F5] flex items-center justify-center text-[#595959]"
              >
                ✕
              </button>
            </div>

            {/* Progress steps */}
            <div className="px-5 pb-4">
              <div className="flex items-center gap-2">
                {["Basics", "Pricing", "Photos"].map((label, i) => (
                  <div key={label} className="flex items-center gap-2 flex-1">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      step > i + 1 ? "bg-green-500 text-white"
                      : step === i + 1 ? "bg-[#1A2B4C] text-white"
                      : "bg-[#F5F5F5] text-[#9CA3AF]"
                    }`}>
                      {step > i + 1 ? "✓" : i + 1}
                    </div>
                    <span className={`text-xs font-semibold ${step === i + 1 ? "text-[#1A2B4C]" : "text-[#9CA3AF]"}`}>
                      {label}
                    </span>
                    {i < 2 && <div className={`flex-1 h-px ${step > i + 1 ? "bg-green-400" : "bg-[#E5E2DC]"}`} />}
                  </div>
                ))}
              </div>
            </div>

            {/* Step content — scrollable */}
            <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-4">

              {/* STEP 1 — BASICS */}
              {step === 1 && (
                <>
                  <div>
                    <label className="text-xs font-bold text-[#595959] uppercase tracking-wide block mb-1">Product name *</label>
                    <input
                      autoFocus
                      data-testid="prod-name"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Floral A-Line Dress"
                      className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[#595959] uppercase tracking-wide block mb-1">Description</label>
                    <textarea
                      data-testid="prod-desc"
                      value={form.description}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Fabric, fit, occasion..."
                      rows={2}
                      className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-sm resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[#595959] uppercase tracking-wide block mb-1">Category *</label>
                    <select
                      data-testid="prod-l1"
                      required
                      value={form.l1_id}
                      onChange={(e) => setForm({ ...form, l1_id: e.target.value, l2_id: "", gender: "" })}
                      className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none bg-white text-sm"
                    >
                      <option value="">Select category</option>
                      {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  {hasL2 ? (
                    <div>
                      <label className="text-xs font-bold text-[#595959] uppercase tracking-wide block mb-1">Sub-category *</label>
                      <select
                        data-testid="prod-l2"
                        required
                        value={form.l2_id}
                        onChange={(e) => setForm({ ...form, l2_id: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none bg-white text-sm"
                      >
                        <option value="">Select sub-category</option>
                        {(currentL1?.l2 || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  ) : form.l1_id ? (
                    <div>
                      <label className="text-xs font-bold text-[#595959] uppercase tracking-wide block mb-1">Gender *</label>
                      <select
                        data-testid="prod-gender"
                        required
                        value={form.gender}
                        onChange={(e) => setForm({ ...form, gender: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none bg-white text-sm"
                      >
                        <option value="">Select gender</option>
                        {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                  ) : null}
                  <BrandCombobox
                    value={form.brand_id}
                    onChange={(brand_id) => setForm((f) => ({ ...f, brand_id }))}
                  />
                </>
              )}

              {/* STEP 2 — PRICING */}
              {step === 2 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-[#595959] uppercase tracking-wide block mb-1">Selling price ₹ *</label>
                      <input
                        data-testid="prod-price"
                        type="number"
                        value={form.price}
                        onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                        placeholder="999"
                        className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-sm"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[#595959] uppercase tracking-wide block mb-1">MRP ₹</label>
                      <input
                        data-testid="prod-mrp"
                        type="number"
                        value={form.mrp}
                        onChange={e => setForm(f => ({ ...f, mrp: e.target.value }))}
                        placeholder="1499"
                        className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-bold text-[#595959] uppercase tracking-wide mb-1.5">Sizes & inventory</div>
                    <select
                      data-testid="prod-size-type"
                      value={form.size_type}
                      onChange={(e) => {
                        const st = e.target.value;
                        if (st === "free_size") {
                          setForm((f) => ({ ...f, size_type: st, sizes: ["Free Size"], stock: { "Free Size": 0 } }));
                        } else if (st === "custom") {
                          setForm((f) => ({ ...f, size_type: st, sizes: [], stock: {} }));
                          setCustomSizesInput("");
                        } else if (st) {
                          setForm((f) => ({ ...f, size_type: st, sizes: [], stock: {} }));
                        } else {
                          setForm((f) => ({ ...f, size_type: "", sizes: [], stock: {} }));
                        }
                      }}
                      className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none bg-white mb-2 text-sm"
                    >
                      <option value="">Select size type</option>
                      {Object.entries(SIZE_TYPE_OPTIONS).map(([key, { label }]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>

                    {form.size_type && form.size_type !== "free_size" && form.size_type !== "custom" && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {(SIZE_TYPE_OPTIONS[form.size_type]?.sizes || []).map((sz) => {
                          const has = form.sizes.includes(sz);
                          return (
                            <button key={sz} type="button" onClick={() => toggleSize(sz)} data-testid={`size-toggle-${sz}`}
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${has ? "bg-[#1A2B4C] text-white border-[#1A2B4C]" : "bg-white text-[#1A2B4C] border-[#E5E2DC]"}`}>
                              {sz}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {form.size_type === "custom" && (
                      <input
                        data-testid="prod-custom-sizes"
                        value={customSizesInput}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setCustomSizesInput(raw);
                          const parsed = raw.split(",").map((s) => s.trim()).filter(Boolean);
                          setForm((f) => ({
                            ...f,
                            sizes: parsed,
                            stock: Object.fromEntries(parsed.map((sz) => [sz, f.stock[sz] ?? 0])),
                          }));
                        }}
                        placeholder="e.g. 30×32, 32×34, 34×36"
                        className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] mb-2 text-sm"
                      />
                    )}

                    {form.sizes.length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        {form.sizes.map((sz) => (
                          <label key={sz} className="text-xs">
                            <span className="text-[#595959]">{sz} stock</span>
                            <input data-testid={`prod-stock-${sz}`} type="number" min={0} value={form.stock[sz] ?? 0}
                              onChange={(e) => setForm((f) => ({ ...f, stock: { ...f.stock, [sz]: Math.max(0, Number(e.target.value || 0)) } }))}
                              className="mt-0.5 w-full px-3 py-1.5 rounded-lg border border-[#E5E2DC] outline-none text-sm" />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <label className="flex items-start gap-2 text-xs">
                    <input data-testid="prod-return-eligible" type="checkbox" checked={form.return_eligible} onChange={(e) => setForm({ ...form, return_eligible: e.target.checked })} className="mt-0.5 w-4 h-4 accent-[#E68910]" />
                    <span><strong>Return eligible</strong> — customers can return this within a set window after delivery</span>
                  </label>

                  {form.return_eligible && (
                    <label className="flex items-center gap-2 text-xs pl-6">
                      <span className="text-[#595959]">Return window (hours, max 24)</span>
                      <input
                        data-testid="prod-return-window-hours"
                        type="number"
                        min={1}
                        max={24}
                        value={form.return_window_hours}
                        onChange={(e) => setForm({ ...form, return_window_hours: e.target.value })}
                        onBlur={() => setForm((f) => ({ ...f, return_window_hours: String(Math.min(24, Math.max(1, Number(f.return_window_hours) || 24))) }))}
                        className="w-20 px-2 py-1 rounded-lg border border-[#E5E2DC] outline-none text-sm"
                      />
                    </label>
                  )}

                  <label className="flex items-start gap-2 text-xs">
                    <input data-testid="prod-try-at-doorstep" type="checkbox" checked={form.try_at_doorstep} onChange={(e) => setForm({ ...form, try_at_doorstep: e.target.checked })} className="mt-0.5 w-4 h-4 accent-[#E68910]" />
                    <span><strong>Try &amp; Buy</strong> — customer can try this on at the door and only pay for what they keep</span>
                  </label>
                </>
              )}

              {/* STEP 3 — IMAGES */}
              {step === 3 && (
                <>
                  <p className="text-sm text-[#595959]">Add photos of your product. First image is the cover. You can skip and add later.</p>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">Product images (up to {MAX_IMAGES})</div>
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
                </>
              )}
            </div>

            {/* Footer buttons */}
            <div className="flex-shrink-0 px-5 pt-4 pb-8 border-t border-[#E5E2DC] bg-white flex gap-3">
              {step > 1 && (
                <button
                  onClick={() => setStep(s => s - 1)}
                  className="px-5 py-3 rounded-xl border border-[#E5E2DC] text-sm font-semibold text-[#595959]"
                >
                  ← Back
                </button>
              )}
              {step < 3 ? (
                <button
                  onClick={() => {
                    if (step === 1 && !form.name) { toast.error("Enter product name"); return; }
                    if (step === 1 && !form.l1_id) { toast.error("Select a category"); return; }
                    if (step === 2 && !form.price) { toast.error("Enter price"); return; }
                    setStep(s => s + 1);
                  }}
                  className="flex-1 py-3 bg-[#1A2B4C] text-white rounded-xl font-bold text-sm"
                >
                  Next →
                </button>
              ) : (
                <div className="flex-1 flex gap-2">
                  <button
                    onClick={() => void submit()}
                    disabled={submitBusy}
                    className="flex-1 py-3 bg-white border border-[#E5E2DC] text-[#595959] rounded-xl font-semibold text-sm disabled:opacity-50"
                  >
                    Skip photos & save
                  </button>
                  <button
                    onClick={() => void submit()}
                    disabled={submitBusy}
                    className="flex-1 py-3 bg-[#E68910] text-white rounded-xl font-bold text-sm disabled:opacity-50"
                  >
                    {submitBusy ? "Saving..." : editingId ? "Save changes" : "Add product"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* G14 — mapping/preview step. Only rendered when handleBulkUpload
          decided the file needs it (not confidently auto-mappable
          end-to-end) — a canonical file skips straight to the real
          import and this never shows. */}
      {bulkFile && bulkDetect && (
        <BulkMappingModal
          detect={bulkDetect}
          overrides={bulkMappingOverrides}
          onChangeOverride={(header, field) => setBulkMappingOverrides((o) => ({ ...o, [header.toLowerCase()]: field }))}
          busy={bulkUploadBusy}
          onCancel={() => { setBulkFile(null); setBulkDetect(null); }}
          onConfirm={() => void runBulkImport(bulkFile, bulkDetect.selected_sheet, bulkMappingOverrides)}
        />
      )}

      {/* G14 — results modal. ALWAYS shown after a real import (success,
          partial, or fully failed) — replaces the old unconditional
          success toast that hid `skipped` entirely, including the
          confusing "Imported 0 products" case with zero explanation. */}
      {bulkResult && (
        <BulkResultModal result={bulkResult} onClose={() => setBulkResult(null)} />
      )}
    </div>
  );
}

// G14 — lightweight mapping/preview step (brief §4). Shown only for a file
// that isn't confidently auto-mappable end-to-end; a canonical file (the
// Lokl template, or a merchant file that happens to already use the same
// header text) skips this entirely per the brief's own explicit
// instruction not to force a mapping screen in that case.
function BulkMappingModal({
  detect, overrides, onChangeOverride, busy, onCancel, onConfirm,
}: {
  detect: BulkDetectResult;
  overrides: Record<string, string | null>;
  onChangeOverride: (header: string, field: string | null) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const effectiveField = (header: string, autoDetected: string | null): string | null => {
    const key = header.toLowerCase();
    return key in overrides ? (overrides[key] ?? null) : autoDetected;
  };
  const mappedNow = new Set(detect.columns.map((c) => effectiveField(c.header, c.mapped_field)).filter(Boolean));
  const stillUnmappedRequired = Object.keys(REQUIRED_FIELD_LABELS).filter((f) => !mappedNow.has(f));

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white w-full md:max-w-2xl md:rounded-3xl rounded-t-3xl max-h-[92vh] flex flex-col" data-testid="bulk-mapping-modal">
        <div className="px-5 pt-5 pb-3 border-b border-[#E5E2DC]">
          <h2 className="font-display text-lg font-bold text-[#1A2B4C]">Check your columns</h2>
          <p className="text-xs text-[#595959] mt-1">
            {detect.row_count} row{detect.row_count === 1 ? "" : "s"} detected
            {detect.sheet_names.length > 1 && detect.selected_sheet ? ` — using sheet "${detect.selected_sheet}"` : ""}.
            We matched what we could to Lokl's product fields — fix anything below that looks wrong, then continue.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-[#595959]">
                <th className="pb-2 pr-3">Uploaded column</th>
                <th className="pb-2">Lokl field</th>
              </tr>
            </thead>
            <tbody>
              {detect.columns.map((c, i) => {
                const current = effectiveField(c.header, c.mapped_field);
                return (
                  <tr key={`${c.header}-${i}`} className="border-t border-[#E5E2DC]" data-testid={`bulk-map-row-${i}`}>
                    <td className="py-2 pr-3 font-medium text-[#1A2B4C] align-middle">{c.header || <span className="text-[#94A3B8] italic">(blank header)</span>}</td>
                    <td className="py-2 align-middle">
                      <select
                        value={current ?? ""}
                        onChange={(e) => onChangeOverride(c.header, e.target.value || null)}
                        data-testid={`bulk-map-select-${i}`}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-[#E5E2DC] bg-white text-sm text-[#1A2B4C]"
                      >
                        <option value="">Not mapped</option>
                        {CANONICAL_FIELD_OPTIONS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {stillUnmappedRequired.length > 0 && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" data-testid="bulk-map-missing-required">
              Still missing: {stillUnmappedRequired.map((f) => REQUIRED_FIELD_LABELS[f]).join(", ")}. Map a column to each before continuing.
            </div>
          )}
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-[#E5E2DC]">
          <button onClick={onCancel} className="flex-1 py-3 bg-white border border-[#E5E2DC] text-[#595959] rounded-xl font-semibold text-sm">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || stillUnmappedRequired.length > 0}
            data-testid="bulk-map-continue"
            className="flex-1 py-3 bg-[#E68910] text-white rounded-xl font-bold text-sm disabled:opacity-50"
          >
            {busy ? "Importing…" : "Continue import"}
          </button>
        </div>
      </div>
    </div>
  );
}

// G14 — always shown after a real import (never a silent/blanket success
// toast) so "N of M imported" and every skip reason are visible together,
// including the previously-confusing "Imported 0 products" case.
function BulkResultModal({ result, onClose }: { result: BulkImportResult; onClose: () => void }) {
  const total = result.created + result.skipped.length;
  const allGood = result.created > 0 && result.skipped.length === 0;
  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full md:max-w-lg md:rounded-3xl rounded-t-3xl max-h-[85vh] flex flex-col" data-testid="bulk-result-modal">
        <div className="px-5 pt-5 pb-3 border-b border-[#E5E2DC]">
          <h2 className={`font-display text-lg font-bold ${allGood ? "text-[#1A2B4C]" : result.created > 0 ? "text-[#1A2B4C]" : "text-red-600"}`}>
            {result.created} of {total} product{total === 1 ? "" : "s"} imported
          </h2>
          {result.skipped.length > 0 && (
            <p className="text-xs text-[#595959] mt-1">
              {result.skipped.length} row{result.skipped.length === 1 ? "" : "s"} need attention — see below.
            </p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {result.created > 0 && (
            <div className="rounded-xl bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800" data-testid="bulk-result-created">
              Imported: {result.names.join(", ")}
            </div>
          )}
          {result.skipped.map((reason, i) => (
            <div key={i} className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700" data-testid={`bulk-result-skip-${i}`}>
              {reason}
            </div>
          ))}
          {result.warning && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">{result.warning}</div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-[#E5E2DC]">
          <button onClick={onClose} data-testid="bulk-result-close" className="w-full py-3 bg-[#1A2B4C] text-white rounded-xl font-bold text-sm">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
