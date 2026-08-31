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
import Link from "next/link";
import { Package, Plus, Download, Upload, Loader2, Search, LifeBuoy, PartyPopper } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { downloads } from "@/lib/downloads";
import { useMerchantAuthStore } from "@/stores";
import { ProductForm, type ProductFormBody, type ProductFormInitial } from "@/components/products/ProductForm";
import type { OnboardingStatusResponse } from "@/lib/api/merchant";
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

export default function MerchantProductsPage() {
  const token = useMerchantAuthStore((s) => s.token);
  const [items, setItems] = useState<Product[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [openAdd, setOpenAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The fetched product data passed to <ProductForm> as `initialProduct`
  // when editing — ProductForm owns all field/step/image-upload state
  // itself now (extracted into components/products/ProductForm.tsx so
  // Admin manual product creation reuses the exact same form).
  const [editingProduct, setEditingProduct] = useState<ProductFormInitial | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkUploadBusy, setBulkUploadBusy] = useState(false);
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
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
  // Onboarding-status polling purely to detect the exact moment autopublish
  // fires (KYC approved + storefront + this being their first live product)
  // so we can show the "you're live" moment right where it actually happens
  // — no change to _maybe_autopublish_store itself, this only observes it.
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatusResponse | null>(null);
  const [justLaunched, setJustLaunched] = useState(false);
  const [requestingHelp, setRequestingHelp] = useState(false);

  const load = async () => {
    try { setItems(await api.merchant.listProducts()); } catch { /* ignore */ }
  };
  const refreshOnboardingStatus = async () => {
    try {
      const next = await api.merchant.onboardingStatus();
      setOnboardingStatus((prev) => {
        if (prev && prev.step !== "live" && next.step === "live") setJustLaunched(true);
        return next;
      });
    } catch { /* ignore */ }
  };
  useEffect(() => { void load(); void loadCats(); void refreshOnboardingStatus(); }, []);
  const loadCats = async () => {
    try {
      const r = await apiClient.get<Category[]>("/api/categories");
      setCats(r.data);
    } catch { /* ignore */ }
  };

  const filtered = items.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));

  // The actual field/validation/image-upload logic now lives in the
  // shared <ProductForm> (components/products/ProductForm.tsx) — this
  // just performs the API call ProductForm's onSubmit expects, and lets
  // ProductForm's own try/catch show the error toast on failure.
  const handleFormSubmit = async (body: ProductFormBody) => {
    if (editingId) {
      await api.merchant.updateProduct(editingId, body as Partial<Product>);
      toast.success("Product updated");
    } else {
      await api.merchant.createProduct(body as Partial<Product>);
      toast.success("Product created");
    }
    void load();
    void refreshOnboardingStatus();
  };

  const requestHelp = async () => {
    setRequestingHelp(true);
    try {
      await api.merchant.requestAssistance("I need help adding products to my shop.");
      toast.success("We've let our team know — they'll reach out shortly.");
    } catch {
      toast.error("Couldn't send your request. Please try again.");
    } finally {
      setRequestingHelp(false);
    }
  };

  const closeForm = () => { setOpenAdd(false); setEditingId(null); setEditingProduct(null); };

  const openEdit = async (p: Product) => {
    try {
      // GET /api/products/{pid} returns { product, similar }, so we have to
      // unwrap before populating the form. Reading the top-level fields was
      // the iter-44 regression that opened the edit modal blank.
      const r = await apiClient.get<{ product: ProductFormInitial & { id: string } }>(`/api/products/${p.id}`);
      setEditingId(p.id);
      setEditingProduct(r.data.product);
      setOpenAdd(true);
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const bulkAction = async (action: "publish" | "pause" | "delete") => {
    if (selected.length === 0) return;
    setBulkBusy(true);
    try {
      await api.merchant.bulkAction(selected, action);
      toast.success(`${action} done`);
      setSelected([]); void load(); void refreshOnboardingStatus();
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setBulkBusy(false); }
  };

  const togglePublish = async (p: Product, target: "live" | "paused") => {
    try {
      await api.merchant.updateProduct(p.id, { paused: target !== "live" } as Partial<Product>);
      void load();
      void refreshOnboardingStatus();
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
      void refreshOnboardingStatus();
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally {
      setBulkUploadBusy(false);
      setBulkFile(null);
      setBulkDetect(null);
    }
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
            onClick={() => { setEditingId(null); setEditingProduct(null); setOpenAdd(true); }}
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
        items.length === 0 ? (
          <div data-testid="products-empty">
            <p className="text-sm text-[#595959] mb-4">You only need one product to get your shop ready. You can add more anytime.</p>
            <div className="grid sm:grid-cols-3 gap-3">
              <button
                onClick={() => { setEditingId(null); setEditingProduct(null); setOpenAdd(true); }}
                data-testid="entry-add-one"
                className="text-left bg-white border border-[#E5E2DC] rounded-2xl p-5 hover:border-[#1A2B4C] transition"
              >
                <Plus size={20} className="text-[#E68910] mb-2" />
                <div className="font-bold text-[#1A2B4C] text-sm">Add one product</div>
                <div className="text-xs text-[#595959] mt-1">Best for adding products individually.</div>
              </button>
              <button
                onClick={() => bulkInputRef.current?.click()}
                data-testid="entry-add-multiple"
                className="text-left bg-white border border-[#E5E2DC] rounded-2xl p-5 hover:border-[#1A2B4C] transition"
              >
                <Upload size={20} className="text-[#E68910] mb-2" />
                <div className="font-bold text-[#1A2B4C] text-sm">Add multiple products</div>
                <div className="text-xs text-[#595959] mt-1">Upload an Excel/CSV file.</div>
              </button>
              <button
                onClick={() => void requestHelp()}
                disabled={requestingHelp}
                data-testid="entry-request-help"
                className="text-left bg-[#FDFBF7] border border-[#E5E2DC] rounded-2xl p-5 hover:border-[#1A2B4C] transition disabled:opacity-60"
              >
                <LifeBuoy size={20} className="text-[#E68910] mb-2" />
                <div className="font-bold text-[#1A2B4C] text-sm">Need help adding products?</div>
                <div className="text-xs text-[#595959] mt-1">{requestingHelp ? "Sending…" : "Request Lokl assistance"}</div>
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center" data-testid="products-empty">
            <Package size={28} className="mx-auto text-[#94A3B8] mb-2" />
            <h3 className="font-display text-xl font-bold text-[#1A2B4C]">No products match your search</h3>
            <p className="text-sm text-[#595959] mt-1">Try a different search term.</p>
          </div>
        )
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

      {/* Add / edit product — shared form, see components/products/ProductForm.tsx */}
      {openAdd && (
        <ProductForm
          mode={editingId ? "edit" : "create"}
          cats={cats}
          initialProduct={editingProduct}
          onSubmit={handleFormSubmit}
          onClose={closeForm}
        />
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

      {/* The exact moment _maybe_autopublish_store flips the store live —
          almost always right here (adding the first product). The merchant
          should never have to wonder whether their shop is live. */}
      {justLaunched && onboardingStatus?.store_id && (
        <LaunchCelebrationModal storeId={onboardingStatus.store_id} onClose={() => setJustLaunched(false)} />
      )}
    </div>
  );
}

function LaunchCelebrationModal({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div data-testid="launch-celebration-modal" className="relative bg-white rounded-3xl p-8 max-w-sm w-full text-center">
        <div className="text-5xl mb-3">🎉</div>
        <h2 className="font-display text-2xl font-bold text-[#1A2B4C]">Your shop is now live!</h2>
        <div className="mt-5 space-y-2 text-left max-w-[220px] mx-auto text-sm text-[#1A2B4C]">
          <div className="flex items-center gap-2"><PartyPopper size={15} className="text-[#4F7363]" /> Business verified</div>
          <div className="flex items-center gap-2"><PartyPopper size={15} className="text-[#4F7363]" /> Shop set up</div>
          <div className="flex items-center gap-2"><PartyPopper size={15} className="text-[#4F7363]" /> Products added</div>
        </div>
        <p className="text-sm text-[#595959] mt-5">Customers can now discover and shop from your store on Lokl.</p>
        <div className="flex flex-col sm:flex-row gap-2 mt-6">
          <Link href={`/store/${storeId}`} className="flex-1 inline-flex items-center justify-center px-4 py-3 rounded-full border-2 border-[#1A2B4C] text-[#1A2B4C] font-semibold text-sm">
            View my shop
          </Link>
          <button onClick={onClose} className="flex-1 inline-flex items-center justify-center px-4 py-3 rounded-full bg-[#1A2B4C] text-white font-semibold text-sm">
            Keep adding products
          </button>
        </div>
      </div>
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
