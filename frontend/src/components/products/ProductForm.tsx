"use client";

/**
 * Shared product create/edit form — extracted from the merchant products
 * page's original inline modal (frontend/src/app/merchant/products/page.tsx)
 * so the Admin Product Creation feature (admin creating a product for a
 * selected merchant) reuses the exact same fields, validation, taxonomy
 * selection, brand combobox, sizes/stock handling, pricing, return-policy,
 * Try & Buy, and image-upload UI instead of a second, duplicated form.
 *
 * This component owns its own state end-to-end (name/price/images/etc, the
 * 3-step wizard, the pending-image-delete queue) and is deliberately
 * ignorant of WHICH API endpoint ultimately gets called — `onSubmit`
 * receives the built request body and the caller (merchant page or the new
 * admin modal) decides whether that goes to `POST /merchant/products` or
 * `POST /admin/merchants/{id}/products`. Image upload/delete go straight
 * through the existing `/merchant/upload-image` endpoint via
 * `uploadImage()`/`deleteUploadedImage()` (frontend/src/lib/uploads.ts) —
 * already role-agnostic (accepts merchant AND admin) — no new upload path.
 */
import { useEffect, useState } from "react";
import Image from "next/image";
import { Upload, X, Star, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/api-error";
import { uploadImage, deleteUploadedImage } from "@/lib/uploads";
import { BrandCombobox } from "@/components/merchant/BrandCombobox";

export interface ProductFormCategory {
  id: string;
  name: string;
  l2: { id: string; name: string }[];
}

/** The exact request-body shape both `POST /merchant/products` and the
 * admin manual-create endpoint's `product` field expect (ProductCreate on
 * the backend) — kept as a plain object rather than importing the (wider,
 * response-shaped) `Product` type so this component never accidentally
 * depends on server-only/response-only fields. */
export interface ProductFormBody {
  name: string;
  price: number;
  mrp?: number;
  description?: string;
  l1_id: string;
  l2_id: string;
  gender: string;
  brand_id?: string;
  sizes: string[];
  stock: Record<string, number>;
  size_type: string;
  image: string;
  image_public_id: string;
  images: string[];
  image_public_ids: string[];
  return_eligible: boolean;
  return_window_hours?: number;
  try_at_doorstep: boolean;
}

export interface ProductFormInitial {
  id?: string;
  name?: string; price?: number | string; mrp?: number | string | null;
  description?: string; l1_id?: string; l2_id?: string; gender?: string;
  brand_id?: string | null; sizes?: string[]; stock?: Record<string, number> | null;
  images?: string[]; image?: string;
  image_public_ids?: string[]; image_public_id?: string;
  return_eligible?: boolean; return_window_hours?: number | null;
  try_at_doorstep?: boolean; size_type?: string;
}

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

function toFormState(d: ProductFormInitial | null | undefined): typeof blankForm {
  if (!d) return blankForm;
  return {
    name: d.name || "",
    price: d.price != null ? String(d.price) : "",
    mrp: d.mrp != null ? String(d.mrp) : "",
    description: d.description || "",
    l1_id: d.l1_id || "",
    l2_id: d.l2_id || "",
    gender: d.gender || "",
    brand_id: d.brand_id || "",
    sizes: d.sizes || [],
    stock: d.stock || {},
    images: d.images && d.images.length ? d.images : (d.image ? [d.image] : []),
    image_public_ids: d.image_public_ids && d.image_public_ids.length
      ? d.image_public_ids : (d.image_public_id ? [d.image_public_id] : []),
    return_eligible: !!d.return_eligible,
    return_window_hours: d.return_window_hours != null ? String(d.return_window_hours) : "24",
    try_at_doorstep: !!d.try_at_doorstep,
    size_type: d.size_type || "",
  };
}

function inferSizeType(sizes: string[]): string {
  if (sizes.some((s) => s === "Free Size" || s === "Free")) return "free_size";
  if (["XS", "S", "M", "L", "XL", "XXL"].some((s) => sizes.includes(s))) return "alpha";
  if (["38", "40", "42", "44", "46"].some((s) => sizes.includes(s))) return "numeric_shirt";
  if (["28", "30", "32", "34", "36"].some((s) => sizes.includes(s))) return "numeric_bottom";
  if (["5", "6", "7", "8", "9", "10", "11"].some((s) => sizes.includes(s))) return "numeric_shoe";
  return "custom";
}

export function ProductForm({
  mode, cats, initialProduct, onSubmit, onClose, submitLabels,
}: {
  mode: "create" | "edit";
  cats: ProductFormCategory[];
  initialProduct?: ProductFormInitial | null;
  onSubmit: (body: ProductFormBody) => Promise<void>;
  onClose: () => void;
  submitLabels?: { create: string; edit: string };
}) {
  const [form, setForm] = useState(() => toFormState(initialProduct));
  const [customSizesInput, setCustomSizesInput] = useState(() => {
    const st = initialProduct?.size_type || (initialProduct?.sizes?.length ? inferSizeType(initialProduct.sizes) : "");
    return st === "custom" ? (initialProduct?.sizes || []).join(", ") : "";
  });
  const [step, setStep] = useState(1);
  const [imageBusy, setImageBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  // Public_ids removed from the form in THIS session but not yet confirmed
  // via Save — the actual Cloudinary delete only fires once onSubmit
  // resolves successfully (see submit() below), never eagerly on the "X"
  // click. Removing-then-discarding never touches Cloudinary.
  const [pendingDeletePublicIds, setPendingDeletePublicIds] = useState<string[]>([]);

  useEffect(() => {
    setForm(toFormState(initialProduct));
    setPendingDeletePublicIds([]);
    setStep(1);
    const st = initialProduct?.size_type || (initialProduct?.sizes?.length ? inferSizeType(initialProduct.sizes) : "");
    setCustomSizesInput(st === "custom" ? (initialProduct?.sizes || []).join(", ") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProduct?.id]);

  const currentL1 = cats.find((c) => c.id === form.l1_id);
  const hasL2 = !!(currentL1 && currentL1.l2 && currentL1.l2.length > 0);

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
    const formHasL2 = l1 && l1.l2 && l1.l2.length > 0;
    if (formHasL2 && !form.l2_id) return toast.error("Sub-category is required for this category");
    if (!formHasL2 && !form.gender) return toast.error("Gender is required for this category");
    if (form.images.length === 0) return toast.error("At least one product image is required");
    setSubmitBusy(true);
    try {
      const body: ProductFormBody = {
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
      await onSubmit(body);
      // Only NOW — once the caller confirms the create/update succeeded —
      // actually delete any images removed during this session.
      for (const pid of pendingDeletePublicIds) void deleteUploadedImage(pid);
      setPendingDeletePublicIds([]);
      onClose();
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSubmitBusy(false); }
  };

  const labels = submitLabels || { create: "Add product", edit: "Save changes" };
  const editingId = mode === "edit";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-[55]"
        onClick={() => {
          // Discarding drops the pending-delete queue untouched — any
          // images removed during this session stay exactly as they were
          // in Cloudinary, since nothing was actually saved.
          if (confirm("Discard changes?")) { setPendingDeletePublicIds([]); onClose(); }
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
            onClick={() => { setPendingDeletePublicIds([]); onClose(); }}
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
                {submitBusy ? "Saving..." : editingId ? labels.edit : labels.create}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
