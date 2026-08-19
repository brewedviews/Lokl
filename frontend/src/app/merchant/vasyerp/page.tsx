"use client";

/**
 * VasyERP integration — connect flow + staged-import review dashboard
 * (Phase A). Mirrors /merchant/bank's single-purpose-page pattern (own
 * route, own sidebar link) rather than living in a generic settings hub
 * that doesn't exist yet — see the Phase A discovery report.
 *
 * IMPORTANT — no real VasyERP account was available while building this.
 * The connect/import flow is fully wired and tested against a hand-built
 * mock server matching the integration plan's documented field list, but
 * has never talked to a real VasyERP account. See
 * docs/integrations/vasyerp-integration-plan.md and this feature's build
 * report for exactly what's verified vs. still assumed.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Boxes, Loader2, RefreshCw, AlertTriangle, Upload, Check, ImageIcon } from "lucide-react";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import { uploadImage } from "@/lib/uploads";
import { BrandCombobox } from "@/components/merchant/BrandCombobox";
import type { VasyERPBranch, VasyERPIntegrationStatus, StagedImport, StagedImportStatus } from "@/lib/api/vasyerp";
import type { CategoryNode } from "@/types";

const STATUS_TABS: { id: StagedImportStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending_review", label: "Needs review" },
  { id: "pending_photos", label: "Needs photo" },
  { id: "ready", label: "Ready to publish" },
  { id: "published", label: "Published" },
];

export default function VasyERPPage() {
  const [status, setStatus] = useState<VasyERPIntegrationStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [tokenInput, setTokenInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [branches, setBranches] = useState<VasyERPBranch[] | null>(null);
  const [selectingBranch, setSelectingBranch] = useState(false);
  const [importing, setImporting] = useState(false);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [staged, setStaged] = useState<StagedImport[] | null>(null);
  const [tab, setTab] = useState<StagedImportStatus | "all">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  const loadStatus = async () => {
    try { setStatus(await api.vasyerp.status()); }
    catch { setStatus(null); }
    finally { setLoadingStatus(false); }
  };
  const loadStaged = async () => {
    try { setStaged(await api.vasyerp.listStaged()); }
    catch (e) { toast.error(getErrorMessage(e)); }
  };

  useEffect(() => {
    void loadStatus();
    api.catalog.categories().then(setCategories).catch(() => {});
  }, []);

  const isConnected = !!status?.branch_id;
  useEffect(() => { if (isConnected) void loadStaged(); }, [isConnected]);

  const handleConnect = async () => {
    const token = tokenInput.trim();
    if (!token) { toast.error("Enter your VasyERP API token"); return; }
    setConnecting(true);
    try {
      const r = await api.vasyerp.connect(token);
      setBranches(r.branches);
      toast.success(`Connected — found ${r.branches.length} branch${r.branches.length === 1 ? "" : "es"}`);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleSelectBranch = async (b: VasyERPBranch) => {
    setSelectingBranch(true);
    try {
      await api.vasyerp.selectBranch(b.id, b.name);
      toast.success(`${b.name} connected`);
      setBranches(null);
      setTokenInput("");
      await loadStatus();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSelectingBranch(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const r = await api.vasyerp.runImport();
      toast.success(`Pulled ${r.staged} product${r.staged === 1 ? "" : "s"}${r.pending_review > 0 ? ` — ${r.pending_review} need review` : ""}`);
      await Promise.all([loadStatus(), loadStaged()]);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setImporting(false);
    }
  };

  const patchRow = (id: string, patch: Partial<StagedImport>) => {
    setStaged((rows) => rows?.map((r) => r.id === id ? { ...r, ...patch } : r) ?? null);
  };

  const saveMapping = async (row: StagedImport) => {
    try {
      const updated = await api.vasyerp.updateStaged(row.id, { l1_id: row.l1_id, l2_id: row.l2_id, brand_id: row.brand_id });
      setStaged((rows) => rows?.map((r) => r.id === row.id ? updated : r) ?? null);
      toast.success("Mapping saved");
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const uploadForRow = async (row: StagedImport, file: File | undefined) => {
    if (!file) return;
    try {
      const { image_url, public_id } = await uploadImage(file, "product");
      const updated = await api.vasyerp.updateStaged(row.id, { image: image_url, image_public_id: public_id });
      setStaged((rows) => rows?.map((r) => r.id === row.id ? updated : r) ?? null);
      toast.success("Photo added");
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const publishRow = async (row: StagedImport) => {
    try {
      await api.vasyerp.publish(row.id);
      toast.success(`${row.name} published`);
      await loadStaged();
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const publishBulk = async () => {
    if (selected.length === 0) return;
    setBulkBusy(true);
    try {
      const r = await api.vasyerp.publishBulk(selected);
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length === 0) toast.success(`Published ${r.published} products`);
      else toast.warning(`Published ${r.published} — ${failed.length} skipped: ${failed.map((f) => f.reason).join("; ")}`, { duration: 8000 });
      setSelected([]);
      await loadStaged();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const filtered = (staged ?? []).filter((r) => tab === "all" || r.status === tab);

  if (loadingStatus) {
    return <div className="p-8 text-center text-sm text-[#595959]"><Loader2 className="inline animate-spin" size={18} /> Loading…</div>;
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold text-[#1A2B4C] flex items-center gap-2">
          <Boxes size={26} /> VasyERP
        </h1>
        <p className="text-[#595959] text-sm mt-1">Pull your VasyERP inventory into Lokl as drafts, add photos, then publish.</p>
      </div>

      {!isConnected ? (
        <div className="bg-white rounded-2xl border border-[#E5E2DC] p-6 max-w-lg">
          {!branches ? (
            <>
              <h2 className="font-display text-lg font-bold text-[#1A2B4C] mb-1">Connect your VasyERP account</h2>
              <p className="text-xs text-[#595959] mb-4">Find your API token in your VasyERP dashboard under account settings.</p>
              <label className="text-xs font-bold text-[#595959] uppercase tracking-wide block mb-1">API token</label>
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Paste your VasyERP api-token"
                data-testid="vasyerp-token-input"
                className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-sm mb-3"
              />
              <button
                onClick={() => void handleConnect()}
                disabled={connecting}
                data-testid="vasyerp-connect-btn"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#E68910] text-white text-sm font-semibold disabled:opacity-50"
              >
                {connecting ? <Loader2 size={14} className="animate-spin" /> : null}
                {connecting ? "Connecting…" : "Connect"}
              </button>
            </>
          ) : (
            <>
              <h2 className="font-display text-lg font-bold text-[#1A2B4C] mb-1">Select your branch</h2>
              <p className="text-xs text-[#595959] mb-4">Which VasyERP branch is your Lokl store?</p>
              <div className="space-y-2">
                {branches.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => void handleSelectBranch(b)}
                    disabled={selectingBranch}
                    data-testid={`vasyerp-branch-${b.id}`}
                    className="w-full text-left px-4 py-3 rounded-xl border border-[#E5E2DC] hover:border-[#1A2B4C] text-sm font-semibold text-[#1A2B4C] disabled:opacity-50"
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-[#E5E2DC] p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-semibold text-[#1A2B4C]">Connected · {status?.branch_name || status?.branch_id}</div>
              <div className="text-[11px] text-[#9CA3AF] mt-0.5">
                {status?.last_synced_at ? `Last synced ${new Date(status.last_synced_at).toLocaleString()}` : "Never synced yet"}
              </div>
            </div>
            <button
              onClick={() => void handleImport()}
              disabled={importing}
              data-testid="vasyerp-import-btn"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1A2B4C] text-white text-sm font-semibold disabled:opacity-50"
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {importing ? "Pulling…" : "Pull latest inventory"}
            </button>
          </div>

          <div className="flex flex-wrap gap-1 border-b border-[#E5E2DC] mb-4">
            {STATUS_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                data-testid={`vasyerp-tab-${t.id}`}
                className={`px-3 py-2 text-xs font-semibold border-b-2 ${tab === t.id ? "border-[#E68910] text-[#1A2B4C]" : "border-transparent text-[#9CA3AF]"}`}
              >
                {t.label} {t.id !== "all" ? `(${(staged ?? []).filter((r) => r.status === t.id).length})` : `(${(staged ?? []).length})`}
              </button>
            ))}
          </div>

          {selected.length > 0 && (
            <div className="sticky top-2 z-20 mb-3 bg-[#1A2B4C] text-white rounded-2xl px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-semibold">{selected.length} selected</span>
              <button onClick={() => void publishBulk()} disabled={bulkBusy} data-testid="vasyerp-publish-bulk"
                className="px-3 py-1.5 rounded-full bg-[#4F7363] text-xs font-semibold disabled:opacity-50">
                {bulkBusy ? "Publishing…" : "Publish selected"}
              </button>
            </div>
          )}

          {staged === null ? (
            <div className="p-8 text-center text-sm text-[#595959]"><Loader2 className="inline animate-spin" size={18} /></div>
          ) : filtered.length === 0 ? (
            <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center">
              <Boxes size={24} className="mx-auto text-[#94A3B8] mb-2" />
              <p className="text-sm text-[#595959]">
                {(staged ?? []).length === 0 ? "Nothing pulled yet — click \"Pull latest inventory\" above." : "Nothing in this tab."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((row) => (
                <StagedRow
                  key={row.id}
                  row={row}
                  categories={categories}
                  checked={selected.includes(row.id)}
                  onToggleSelect={() => setSelected((s) => s.includes(row.id) ? s.filter((x) => x !== row.id) : [...s, row.id])}
                  onPatch={(p) => patchRow(row.id, p)}
                  onSaveMapping={() => void saveMapping({ ...row })}
                  onUpload={(f) => void uploadForRow(row, f)}
                  onPublish={() => void publishRow(row)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StagedRow({
  row, categories, checked, onToggleSelect, onPatch, onSaveMapping, onUpload, onPublish,
}: {
  row: StagedImport;
  categories: CategoryNode[];
  checked: boolean;
  onToggleSelect: () => void;
  onPatch: (p: Partial<StagedImport>) => void;
  onSaveMapping: () => void;
  onUpload: (f: File | undefined) => void;
  onPublish: () => void;
}) {
  const currentL1 = categories.find((c) => c.id === row.l1_id);
  const hasL2 = !!(currentL1 && currentL1.l2 && currentL1.l2.length > 0);
  const dirtyMapping = row.category_unmatched || row.status === "pending_review";

  return (
    <div className="bg-white rounded-2xl border border-[#E5E2DC] p-4" data-testid={`vasyerp-staged-${row.id}`}>
      <div className="flex items-start gap-3">
        {row.status !== "published" && (
          <input type="checkbox" checked={checked} onChange={onToggleSelect} className="mt-1.5 w-4 h-4 accent-[#E68910]" data-testid={`vasyerp-select-${row.id}`} />
        )}
        <div className="w-14 h-14 rounded-xl overflow-hidden bg-[#F5F5F5] flex-shrink-0 flex items-center justify-center">
          {row.image ? <img src={row.image} alt={row.name} className="w-full h-full object-cover" /> : <ImageIcon size={18} className="text-[#9CA3AF]" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-[#1A2B4C] text-sm truncate">{row.name}</div>
          <div className="text-xs text-[#595959] mt-0.5">₹{row.price ?? "—"} {row.mrp && row.mrp !== row.price ? <span className="line-through text-[#9CA3AF]">₹{row.mrp}</span> : null} · qty {row.qty}</div>
        </div>
        <StatusPill status={row.status} />
      </div>

      {row.status === "pending_review" && (
        <div className="mt-3 pt-3 border-t border-[#F1F5F9] grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid={`vasyerp-review-${row.id}`}>
          <div className="sm:col-span-3 flex items-center gap-2 text-[11px] text-[#B45309] bg-[#FEF3C7] rounded-lg px-3 py-2">
            <AlertTriangle size={13} className="shrink-0" />
            VasyERP category &ldquo;{row.raw_category || "(blank)"}&rdquo; didn&apos;t match — pick one manually.
            {row.brand_unmatched && row.raw_brand && <> Brand &ldquo;{row.raw_brand}&rdquo; also didn&apos;t match — search below or leave blank.</>}
          </div>
          <div>
            <label className="text-[10px] font-bold text-[#595959] uppercase tracking-wide block mb-1">Category</label>
            <select
              value={row.l1_id || ""}
              onChange={(e) => onPatch({ l1_id: e.target.value || null, l2_id: null })}
              data-testid={`vasyerp-l1-${row.id}`}
              className="w-full px-3 py-2 rounded-lg border border-[#E5E2DC] outline-none bg-white text-sm"
            >
              <option value="">Select category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {hasL2 && (
            <div>
              <label className="text-[10px] font-bold text-[#595959] uppercase tracking-wide block mb-1">Sub-category</label>
              <select
                value={row.l2_id || ""}
                onChange={(e) => onPatch({ l2_id: e.target.value || null })}
                data-testid={`vasyerp-l2-${row.id}`}
                className="w-full px-3 py-2 rounded-lg border border-[#E5E2DC] outline-none bg-white text-sm"
              >
                <option value="">Select sub-category</option>
                {(currentL1?.l2 || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div className={hasL2 ? "" : "sm:col-span-2"}>
            <BrandCombobox value={row.brand_id || ""} onChange={(brand_id) => onPatch({ brand_id: brand_id || null })} testid={`vasyerp-brand-${row.id}`} />
          </div>
          <div className="sm:col-span-3">
            <button
              onClick={onSaveMapping}
              disabled={!row.l1_id || (hasL2 && !row.l2_id)}
              data-testid={`vasyerp-save-mapping-${row.id}`}
              className="px-4 py-2 rounded-full bg-[#1A2B4C] text-white text-xs font-bold disabled:opacity-40"
            >
              Save mapping
            </button>
          </div>
        </div>
      )}

      {(row.status === "pending_photos" || (row.status !== "pending_review" && !row.image)) && (
        <div className="mt-3 pt-3 border-t border-[#F1F5F9] flex items-center gap-3">
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-dashed border-[#E5E2DC] text-xs font-semibold text-[#595959] cursor-pointer hover:border-[#1A2B4C]">
            <Upload size={13} /> Add photo
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" data-testid={`vasyerp-upload-${row.id}`}
              onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
      )}

      {row.status === "ready" && (
        <div className="mt-3 pt-3 border-t border-[#F1F5F9] flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#4F7363]"><Check size={13} /> Ready to publish</span>
          <button onClick={onPublish} data-testid={`vasyerp-publish-${row.id}`} className="px-4 py-2 rounded-full bg-[#E68910] text-white text-xs font-bold">
            Publish
          </button>
        </div>
      )}

      {row.status === "published" && (
        <div className="mt-3 pt-3 border-t border-[#F1F5F9] text-xs font-semibold text-[#4F7363] flex items-center gap-1.5">
          <Check size={13} /> Published to your catalog
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: StagedImportStatus }) {
  const STYLES: Record<StagedImportStatus, string> = {
    pending_review: "bg-[#FEF3C7] text-[#B45309]",
    pending_photos: "bg-[#DBEAFE] text-[#1D4ED8]",
    ready: "bg-[#D1FAE5] text-[#047857]",
    published: "bg-[#E5E2DC] text-[#595959]",
    skipped: "bg-[#F5F5F5] text-[#9CA3AF]",
  };
  const LABELS: Record<StagedImportStatus, string> = {
    pending_review: "Needs review",
    pending_photos: "Needs photo",
    ready: "Ready",
    published: "Published",
    skipped: "Skipped",
  };
  return <span className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold ${STYLES[status]}`}>{LABELS[status]}</span>;
}
