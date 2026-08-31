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
 * `callerScope` (default "merchant") forces the admin JWT on those calls
 * when this form is used from an admin context — see lib/uploads.ts's own
 * doc comment for why a plain merchant-scoped call 401s for an admin-only
 * session; this was a known-open gap fixed here since color variants touch
 * this exact upload path extensively.
 *
 * Color variants (optional, additive — see ColorVariant on the backend):
 * a "Does this product have multiple colours?" toggle at the top of the
 * Pricing step switches Sizes/Stock + the Photos step from the plain flat
 * flow to a repeating per-color block (name, optional hex swatch, its own
 * images, its own size/stock toggles) built from the SAME size_type
 * chosen once for the product — each color independently picks which of
 * that size type's sizes it carries and how much stock. Toggling back to
 * "No" (or never touching it) preserves the exact original flat
 * sizes/images/stock flow, byte-for-byte.
 */
import { useEffect, useState } from "react";
import Image from "next/image";
import { Upload, X, Star, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/api-error";
import { uploadImage, deleteUploadedImage } from "@/lib/uploads";
import { BrandCombobox } from "@/components/merchant/BrandCombobox";

export interface ProductFormCategory {
  id: string;
  name: string;
  l2: { id: string; name: string }[];
}

export interface ProductFormColorVariant {
  id: string;
  name: string;
  hex?: string;
  images: { url: string; public_id: string }[];
  sizes: { size: string; stock: number }[];
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
  /** Omitted entirely (not even an empty array) when the merchant/admin
   *  never turned on the color toggle — matches the backend default of
   *  an empty list, so a plain product's request body is unchanged from
   *  before this feature existed. */
  color_variants?: ProductFormColorVariant[];
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
  color_variants?: ProductFormColorVariant[];
}

let _cvCounter = 0;
function newColorVariantId(): string {
  _cvCounter += 1;
  return `cv-${Date.now().toString(36)}-${_cvCounter}`;
}
function blankColorVariant(): ProductFormColorVariant {
  return { id: newColorVariantId(), name: "", hex: "", images: [], sizes: [] };
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
  mode, cats, initialProduct, onSubmit, onClose, submitLabels, callerScope = "merchant",
}: {
  mode: "create" | "edit";
  cats: ProductFormCategory[];
  initialProduct?: ProductFormInitial | null;
  onSubmit: (body: ProductFormBody) => Promise<void>;
  onClose: () => void;
  submitLabels?: { create: string; edit: string };
  /** "admin" forces the admin JWT on image upload/delete — see
   *  lib/uploads.ts. Defaults to "merchant", the original behavior. */
  callerScope?: "merchant" | "admin";
}) {
  const [form, setForm] = useState(() => toFormState(initialProduct));
  const [hasColors, setHasColors] = useState(() => !!(initialProduct?.color_variants && initialProduct.color_variants.length > 0));
  const [colorVariants, setColorVariants] = useState<ProductFormColorVariant[]>(
    () => (initialProduct?.color_variants && initialProduct.color_variants.length > 0)
      ? initialProduct.color_variants
      : [blankColorVariant()],
  );
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
    setHasColors(!!(initialProduct?.color_variants && initialProduct.color_variants.length > 0));
    setColorVariants(
      (initialProduct?.color_variants && initialProduct.color_variants.length > 0)
        ? initialProduct.color_variants
        : [blankColorVariant()],
    );
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
      const { image_url, public_id } = await uploadImage(file, "product", callerScope);
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

  // ── Color variants — same upload/remove/toggle shapes as the plain
  // flow above, scoped to one color's entry in `colorVariants` by index. ──
  const updateColorVariant = (idx: number, patch: Partial<ProductFormColorVariant>) => {
    setColorVariants((list) => list.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  };

  const addColorVariant = () => setColorVariants((list) => [...list, blankColorVariant()]);

  const removeColorVariant = (idx: number) => {
    const removed = colorVariants[idx];
    if (removed) setPendingDeletePublicIds((ids) => [...ids, ...removed.images.map((i) => i.public_id).filter(Boolean)]);
    setColorVariants((list) => (list.length > 1 ? list.filter((_, i) => i !== idx) : list));
  };

  const pickColorImage = async (idx: number, file: File | undefined) => {
    if (!file) return;
    const current = colorVariants[idx];
    if (!current) return;
    if (current.images.length >= MAX_IMAGES) return toast.error(`Max ${MAX_IMAGES} images per color`);
    setImageBusy(true);
    try {
      const { image_url, public_id } = await uploadImage(file, "product", callerScope);
      updateColorVariant(idx, { images: [...current.images, { url: image_url, public_id }] });
      toast.success("Image uploaded");
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setImageBusy(false); }
  };

  const removeColorImage = (idx: number, imgIdx: number) => {
    const variant = colorVariants[idx];
    if (!variant) return;
    const removed = variant.images[imgIdx];
    updateColorVariant(idx, { images: variant.images.filter((_, i) => i !== imgIdx) });
    if (removed?.public_id) setPendingDeletePublicIds((ids) => [...ids, removed.public_id]);
  };

  const toggleColorSize = (idx: number, sz: string) => {
    const variant = colorVariants[idx];
    if (!variant) return;
    const has = variant.sizes.some((s) => s.size === sz);
    updateColorVariant(idx, {
      sizes: has ? variant.sizes.filter((s) => s.size !== sz) : [...variant.sizes, { size: sz, stock: 0 }],
    });
  };

  const setColorStock = (idx: number, sz: string, stock: number) => {
    const variant = colorVariants[idx];
    if (!variant) return;
    updateColorVariant(idx, { sizes: variant.sizes.map((s) => (s.size === sz ? { ...s, stock } : s)) });
  };

  const submit = async () => {
    if (!form.name || !form.price || !form.l1_id) return toast.error("Name, price and category are required");
    const l1 = cats.find((c) => c.id === form.l1_id);
    const formHasL2 = l1 && l1.l2 && l1.l2.length > 0;
    if (formHasL2 && !form.l2_id) return toast.error("Sub-category is required for this category");
    if (!formHasL2 && !form.gender) return toast.error("Gender is required for this category");

    if (hasColors) {
      const named = colorVariants.filter((v) => v.name.trim());
      if (named.length === 0) return toast.error("Add at least one color with a name");
      if (named.some((v) => v.images.length === 0)) return toast.error(`"${named.find((v) => v.images.length === 0)?.name}" needs at least one image`);
      if (named.some((v) => v.sizes.length === 0)) return toast.error(`"${named.find((v) => v.sizes.length === 0)?.name}" needs at least one size`);
    } else if (form.images.length === 0) {
      return toast.error("At least one product image is required");
    }

    setSubmitBusy(true);
    try {
      // When color_variants is set, the backend derives image/images/sizes/
      // stock from it (see _derive_flat_fields_from_variants) — these are
      // still computed here too for a locally-consistent body, but the
      // server's own derivation is what's actually persisted.
      const namedVariants = hasColors ? colorVariants.filter((v) => v.name.trim()) : [];
      const firstVariantImages = namedVariants[0]?.images ?? [];
      const sizesUnion = hasColors
        ? Array.from(new Set(namedVariants.flatMap((v) => v.sizes.map((s) => s.size)))).sort()
        : form.sizes;
      const stockSum: Record<string, number> = {};
      if (hasColors) {
        for (const v of namedVariants) for (const s of v.sizes) stockSum[s.size] = (stockSum[s.size] ?? 0) + (s.stock || 0);
      }

      const body: ProductFormBody = {
        name: form.name,
        price: Number(form.price),
        mrp: form.mrp ? Number(form.mrp) : undefined,
        description: form.description || undefined,
        l1_id: form.l1_id,
        l2_id: form.l2_id || "",
        gender: form.gender || "",
        brand_id: form.brand_id || undefined,
        sizes: hasColors ? sizesUnion : form.sizes,
        stock: hasColors ? stockSum : form.stock,
        size_type: form.size_type || "",
        image: hasColors ? (firstVariantImages[0]?.url || "") : (form.images[0] || ""),
        image_public_id: hasColors ? (firstVariantImages[0]?.public_id || "") : (form.image_public_ids[0] || ""),
        images: hasColors ? firstVariantImages.map((i) => i.url) : form.images,
        image_public_ids: hasColors ? firstVariantImages.map((i) => i.public_id) : form.image_public_ids,
        return_eligible: form.return_eligible,
        return_window_hours: form.return_eligible
          ? Math.min(24, Math.max(1, Number(form.return_window_hours) || 24))
          : undefined,
        try_at_doorstep: form.try_at_doorstep,
        ...(hasColors ? { color_variants: namedVariants } : {}),
      };
      await onSubmit(body);
      // Only NOW — once the caller confirms the create/update succeeded —
      // actually delete any images removed during this session (plain
      // flow + any color-variant images removed, both feed the same
      // deferred queue).
      for (const pid of pendingDeletePublicIds) void deleteUploadedImage(pid, callerScope);
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

              <label className="flex items-start gap-2 text-xs p-3 rounded-xl bg-[#FDFBF7] border border-[#E5E2DC]">
                <input
                  data-testid="prod-has-colors"
                  type="checkbox"
                  checked={hasColors}
                  onChange={(e) => setHasColors(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#E68910]"
                />
                <span>
                  <strong>Does this product have multiple colours?</strong>
                  <span className="block text-[#595959] mt-0.5">Each colour gets its own photos and its own size/stock — e.g. Black, White, Yellow.</span>
                </span>
              </label>

              {!hasColors && (
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
              )}

              {hasColors && (
                <div>
                  <div className="text-xs font-bold text-[#595959] uppercase tracking-wide mb-1.5">Size type (shared by every colour)</div>
                  <select
                    data-testid="prod-size-type"
                    value={form.size_type}
                    onChange={(e) => setForm((f) => ({ ...f, size_type: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none bg-white text-sm"
                  >
                    <option value="">Select size type</option>
                    {Object.entries(SIZE_TYPE_OPTIONS).map(([key, { label }]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-[#595959] mt-1.5">
                    Each colour picks which of these sizes it carries, and its own stock, in the next step (Photos).
                  </p>
                </div>
              )}

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

          {/* STEP 3 — IMAGES (plain) or COLOURS (images + size/stock per colour) */}
          {step === 3 && !hasColors && (
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

          {step === 3 && hasColors && (
            <>
              <p className="text-sm text-[#595959]">Add each colour with its own photos and sizes/stock. First image in a colour is that colour's cover.</p>
              <div className="space-y-4">
                {colorVariants.map((v, idx) => {
                  const sizeOptions = form.size_type && form.size_type !== "custom" && form.size_type !== "free_size"
                    ? (SIZE_TYPE_OPTIONS[form.size_type]?.sizes || [])
                    : v.sizes.map((s) => s.size);
                  return (
                    <div key={v.id} className="p-3.5 rounded-xl border border-[#E5E2DC] bg-[#FDFBF7]" data-testid={`color-variant-${idx}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="flex-1">
                          <label className="text-[10px] font-bold text-[#595959] uppercase tracking-wide block mb-1">Colour name *</label>
                          <input
                            data-testid={`color-name-${idx}`}
                            value={v.name}
                            onChange={(e) => updateColorVariant(idx, { name: e.target.value })}
                            placeholder="e.g. Black, Olive, Dusty Rose"
                            className="w-full px-3 py-2 rounded-lg border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-sm bg-white"
                          />
                        </div>
                        <div className="w-16">
                          <label className="text-[10px] font-bold text-[#595959] uppercase tracking-wide block mb-1">Swatch</label>
                          <input
                            data-testid={`color-hex-${idx}`}
                            type="color"
                            value={v.hex || "#cccccc"}
                            onChange={(e) => updateColorVariant(idx, { hex: e.target.value })}
                            className="w-full h-9 rounded-lg border border-[#E5E2DC] cursor-pointer bg-white"
                          />
                        </div>
                        {colorVariants.length > 1 && (
                          <button type="button" onClick={() => removeColorVariant(idx)} aria-label={`Remove ${v.name || "colour"}`}
                            className="self-end mb-0.5 w-9 h-9 rounded-lg border border-[#E5E2DC] flex items-center justify-center text-red-500 hover:bg-red-50 shrink-0">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>

                      <div className="mb-3">
                        <div className="text-[10px] font-bold text-[#595959] uppercase tracking-wide mb-1.5">Images</div>
                        <div className="flex flex-wrap gap-2">
                          {v.images.map((img, i) => (
                            <div key={i} className="relative w-16 h-20 rounded-lg overflow-hidden bg-white border border-[#E5E2DC]" data-testid={`color-image-thumb-${idx}-${i}`}>
                              <Image src={img.url} alt={`${v.name || "colour"} ${i + 1}`} fill sizes="64px" className="object-cover" unoptimized />
                              <button type="button" onClick={() => removeColorImage(idx, i)} aria-label={`Remove image ${i + 1}`} className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-white/95 shadow flex items-center justify-center hover:bg-red-100">
                                <X size={10} className="text-red-500" />
                              </button>
                            </div>
                          ))}
                          {v.images.length < MAX_IMAGES && (
                            <label className="w-16 h-20 rounded-lg border-2 border-dashed border-[#E5E2DC] hover:border-[#1A2B4C] flex flex-col items-center justify-center gap-0.5 cursor-pointer text-[#595959] text-[9px] bg-white">
                              {imageBusy ? <Loader2 size={14} className="animate-spin" /> : <><Plus size={12} /><span>Add</span></>}
                              <input data-testid={`color-add-image-${idx}`} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                                onChange={(e) => { pickColorImage(idx, e.target.files?.[0]); e.target.value = ""; }} />
                            </label>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] font-bold text-[#595959] uppercase tracking-wide mb-1.5">Sizes and stock</div>
                        {!form.size_type ? (
                          <p className="text-xs text-[#595959]">Pick a size type above first.</p>
                        ) : (
                          <>
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {sizeOptions.map((sz) => {
                                const has = v.sizes.some((s) => s.size === sz);
                                return (
                                  <button key={sz} type="button" onClick={() => toggleColorSize(idx, sz)} data-testid={`color-size-toggle-${idx}-${sz}`}
                                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${has ? "bg-[#1A2B4C] text-white border-[#1A2B4C]" : "bg-white text-[#1A2B4C] border-[#E5E2DC]"}`}>
                                    {sz}
                                  </button>
                                );
                              })}
                            </div>
                            {v.sizes.length > 0 && (
                              <div className="grid grid-cols-3 gap-2">
                                {v.sizes.map((s) => (
                                  <label key={s.size} className="text-xs">
                                    <span className="text-[#595959]">{s.size} stock</span>
                                    <input data-testid={`color-stock-${idx}-${s.size}`} type="number" min={0} value={s.stock}
                                      onChange={(e) => setColorStock(idx, s.size, Math.max(0, Number(e.target.value || 0)))}
                                      className="mt-0.5 w-full px-3 py-1.5 rounded-lg border border-[#E5E2DC] outline-none text-sm bg-white" />
                                  </label>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <button type="button" onClick={addColorVariant} data-testid="add-color-variant"
                className="w-full py-2.5 rounded-xl border-2 border-dashed border-[#E5E2DC] hover:border-[#1A2B4C] text-sm font-semibold text-[#1A2B4C] flex items-center justify-center gap-1.5">
                <Plus size={15} /> Add another colour
              </button>
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
              {/* "Skip photos" only makes sense for the plain flow — a
                  colour needs at least one photo to mean anything, so
                  that escape hatch doesn't apply here (submit() already
                  enforces this either way; this just avoids offering a
                  button whose label promises something colours can't do). */}
              {!hasColors && (
                <button
                  onClick={() => void submit()}
                  disabled={submitBusy}
                  className="flex-1 py-3 bg-white border border-[#E5E2DC] text-[#595959] rounded-xl font-semibold text-sm disabled:opacity-50"
                >
                  Skip photos & save
                </button>
              )}
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
