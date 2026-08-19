"use client";

/**
 * Brand admin surface — full CRUD (search, paginate, create, edit, delete).
 *
 * Deliberately NOT a copy of L1CategoriesEditor's small-fixed-list, edit-
 * only pattern: Brand can grow unbounded, so this list is server-paginated
 * and searchable, and supports create + delete (categories support
 * neither). Deleting a brand is a SOFT-UNLINK — the backend clears
 * `brand_id` on any tagged products, never deletes them.
 */
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Save, Loader2, Trash2, Plus, Search, ChevronLeft, ChevronRight, Tag } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import { ImageUploadField } from "./ImageUploadField";
import type { Brand } from "@/types";

const PAGE_SIZE = 20;

export function BrandsEditor() {
  const [rows, setRows] = useState<Brand[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await adminApi.listBrands({ search, skip: page * PAGE_SIZE, limit: PAGE_SIZE });
      setRows(r.brands);
      setTotal(r.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load brands");
    }
  }, [search, page]);

  useEffect(() => { void load(); }, [load]);

  // Debounce search — reset to page 0 on every new query.
  useEffect(() => {
    const t = setTimeout(() => { setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const patch = (id: string, p: Partial<Brand>) => {
    setRows((r) => r?.map((b) => b.id === id ? { ...b, ...p } : b) || null);
    setDirty((d) => ({ ...d, [id]: true }));
  };

  const save = async (row: Brand) => {
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      const updated = await adminApi.updateBrand(row.id, {
        name: row.name,
        description: row.description || "",
        logo: row.logo || "",
        logo_public_id: row.logo_public_id || "",
      });
      setRows((r) => r?.map((b) => b.id === row.id ? updated : b) || null);
      setDirty((d) => { const n = { ...d }; delete n[row.id]; return n; });
      toast.success(`${row.name} updated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  };

  const createNew = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await adminApi.createBrand(name);
      setNewName("");
      setPage(0);
      if (search) setSearch("");
      else await load();
      toast.success(`Brand "${name}" created`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (row: Brand) => {
    const productNote = row.product_count > 0
      ? ` ${row.product_count} product${row.product_count === 1 ? "" : "s"} tagged with it will keep selling — they'll just show no brand.`
      : "";
    if (!confirm(`Delete brand "${row.name}"?${productNote} This cannot be undone.`)) return;
    try {
      await adminApi.deleteBrand(row.id);
      await load();
      toast.success("Brand deleted — tagged products were kept, not removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4" data-testid="cms-brands-editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-[#0A1F5C]">Brands</h3>
          <p className="text-[11px] text-[#64748B]">{total} brand{total === 1 ? "" : "s"} — search, edit, or create new. Deleting keeps tagged products (soft-unlink only).</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void createNew(); }}
            placeholder="New brand name…"
            data-testid="cms-brand-new-name"
            className="px-3 py-2 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none"
          />
          <button
            onClick={() => void createNew()}
            disabled={!newName.trim() || creating}
            data-testid="cms-brand-create"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-bold disabled:opacity-40"
          >
            {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} New brand
          </button>
        </div>
      </div>

      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search brands by name…"
          data-testid="cms-brand-search"
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#0A1F5C] text-sm bg-white"
        />
        <Search size={15} className="absolute left-3 top-3 text-[#9CA3AF]" />
      </div>

      {!rows ? (
        <div className="p-6 text-center text-sm text-[#64748B]"><Loader2 size={18} className="inline animate-spin" /> Loading brands…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-8 text-center">
          <Tag size={24} className="mx-auto text-[#94A3B8] mb-2" />
          <p className="text-sm text-[#595959]">{search ? "No brands match that search." : "No brands yet — create the first one above."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((b) => (
            <div key={b.id} data-testid={`cms-brand-row-${b.id}`} className="bg-white border border-[#E5E2DC] rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-[180px_1fr_auto] gap-4 items-start">
              <ImageUploadField
                label="Logo" recommended="400×400"
                value={b.logo || ""} onChange={(v) => patch(b.id, { logo: v })}
                testid={`cms-brand-logo-${b.id}`}
                assetType="brand_logo"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Name</span>
                  <input
                    type="text" value={b.name} onChange={(e) => patch(b.id, { name: e.target.value })}
                    data-testid={`cms-brand-name-${b.id}`}
                    className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Description</span>
                  <input
                    type="text" value={b.description || ""} onChange={(e) => patch(b.id, { description: e.target.value })}
                    data-testid={`cms-brand-desc-${b.id}`}
                    className="mt-1 w-full px-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[12px] focus:border-[#0A1F5C] outline-none"
                  />
                </label>
                <div className="sm:col-span-2 flex items-center gap-3 text-[10px] text-[#94A3B8]">
                  <span className="font-mono">slug: {b.slug}</span>
                  <span>{b.product_count} product{b.product_count === 1 ? "" : "s"}</span>
                  <a href={`/brand/${b.slug}`} target="_blank" rel="noreferrer"
                     data-testid={`cms-brand-preview-${b.id}`}
                     className="text-[#0A1F5C] font-semibold ml-auto">
                    Preview →
                  </a>
                </div>
              </div>
              <div className="flex lg:flex-col items-center gap-2">
                <button onClick={() => void save(b)} disabled={!dirty[b.id] || busy[b.id]}
                  data-testid={`cms-brand-save-${b.id}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-bold disabled:opacity-40">
                  {busy[b.id] ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {busy[b.id] ? "Saving…" : dirty[b.id] ? "Save" : "Saved"}
                </button>
                <button onClick={() => void remove(b)}
                  data-testid={`cms-brand-delete-${b.id}`}
                  className="w-8 h-8 rounded-full bg-white border border-[#FCA5A5] text-[#DC2626] flex items-center justify-center"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {rows && total > PAGE_SIZE && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-[11px] text-[#64748B]">Page {page + 1} of {totalPages}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
              data-testid="cms-brand-prev"
              className="w-8 h-8 rounded-full border border-[#E5E2DC] bg-white disabled:opacity-30 flex items-center justify-center"><ChevronLeft size={14} /></button>
            <button onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))} disabled={page + 1 >= totalPages}
              data-testid="cms-brand-next"
              className="w-8 h-8 rounded-full border border-[#E5E2DC] bg-white disabled:opacity-30 flex items-center justify-center"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
