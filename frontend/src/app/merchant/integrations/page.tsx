"use client";

/**
 * Merchant integrations — connect flow (per provider) + a SHARED staged-
 * import review dashboard (Phase A: VasyERP + Shopify).
 *
 * Renamed from /merchant/vasyerp now that a second provider exists — the
 * review/publish pipeline below is genuinely provider-generic (matching
 * the backend's own _resolve_category/_resolve_brand/_stage_source_item),
 * but the ORIGINAL single-provider page was not: it hardcoded "VasyERP"
 * into copy, the unmatched-category message, and every API call. This
 * version fixes that — StagedRow reads `row.provider` to label itself
 * rather than assuming, and connect flows are the only genuinely
 * provider-specific pieces (VasyERP: static token + branch selection;
 * Shopify: shop domain + token, no branch step).
 *
 * IMPORTANT — no real VasyERP or Shopify account was available while
 * building either integration. Both connect/import flows are fully wired
 * and tested against hand-built mock servers matching each provider's
 * confirmed API contract, but neither has talked to a real account. See
 * docs/integrations/vasyerp-integration-plan.md for exactly what's
 * verified vs. still assumed.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Boxes, Loader2, RefreshCw, AlertTriangle, Upload, Check, ImageIcon, ShoppingBag, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import { uploadImage } from "@/lib/uploads";
import { BrandCombobox } from "@/components/merchant/BrandCombobox";
import type { VasyERPBranch, IntegrationStatus, StagedImport, StagedImportStatus, Provider } from "@/lib/api/integrations";
import type { CategoryNode } from "@/types";

const PROVIDER_LABEL: Record<Provider, string> = { vasyerp: "VasyERP", shopify: "Shopify" };

const STATUS_TABS: { id: StagedImportStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending_review", label: "Needs review" },
  { id: "pending_photos", label: "Needs photo" },
  { id: "ready", label: "Ready to publish" },
  { id: "published", label: "Published" },
];

export default function IntegrationsPage() {
  const [statuses, setStatuses] = useState<IntegrationStatus[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [staged, setStaged] = useState<StagedImport[] | null>(null);
  const [tab, setTab] = useState<StagedImportStatus | "all">("all");
  const [providerFilter, setProviderFilter] = useState<Provider | "all">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  const loadStatus = async () => {
    try { setStatuses(await api.integrations.status()); }
    catch { setStatuses([]); }
    finally { setLoadingStatus(false); }
  };
  const loadStaged = async () => {
    try { setStaged(await api.integrations.listStaged()); }
    catch (e) { toast.error(getErrorMessage(e)); }
  };

  useEffect(() => {
    void loadStatus();
    void loadStaged();
    api.catalog.categories().then(setCategories).catch(() => {});
  }, []);

  const byProvider = (p: Provider) => statuses.find((s) => s.provider === p);
  const anyConnected = statuses.length > 0;

  const handleImport = async (provider: Provider) => {
    try {
      const r = await api.integrations.runImport(provider);
      toast.success(`Pulled ${r.staged} product${r.staged === 1 ? "" : "s"}${r.pending_review > 0 ? ` — ${r.pending_review} need review` : ""}`);
      await Promise.all([loadStatus(), loadStaged()]);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const patchRow = (id: string, patch: Partial<StagedImport>) => {
    setStaged((rows) => rows?.map((r) => r.id === id ? { ...r, ...patch } : r) ?? null);
  };

  const saveMapping = async (row: StagedImport) => {
    try {
      const updated = await api.integrations.updateStaged(row.id, { l1_id: row.l1_id, l2_id: row.l2_id, brand_id: row.brand_id });
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
      const updated = await api.integrations.updateStaged(row.id, { image: image_url, image_public_id: public_id });
      setStaged((rows) => rows?.map((r) => r.id === row.id ? updated : r) ?? null);
      toast.success("Photo added");
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const publishRow = async (row: StagedImport) => {
    try {
      await api.integrations.publish(row.id);
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
      const r = await api.integrations.publishBulk(selected);
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

  // Removing a staged row never touches the actual product — only warn (and
  // require an extra confirm) when a row is still published AND its
  // product genuinely still exists. An already-orphaned published row (the
  // product was deleted separately) has nothing live left to protect.
  const removeRow = async (row: StagedImport) => {
    if (row.status === "published" && row.product_exists) {
      const ok = window.confirm(
        "This will remove it from your import list but NOT delete the actual product from your catalog — do that separately from Products if you want it fully removed.",
      );
      if (!ok) return;
    }
    try {
      await api.integrations.removeStaged(row.id);
      setStaged((rows) => rows?.filter((r) => r.id !== row.id) ?? null);
      setSelected((s) => s.filter((id) => id !== row.id));
      toast.success(`${row.name} removed`);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const removeBulk = async () => {
    if (selected.length === 0) return;
    const selectedRows = (staged ?? []).filter((r) => selected.includes(r.id));
    const stillLive = selectedRows.some((r) => r.status === "published" && r.product_exists);
    if (stillLive) {
      const ok = window.confirm(
        "One or more selected items are still published — this will remove them from your import list but NOT delete the actual products from your catalog — do that separately from Products if you want them fully removed.",
      );
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      const r = await api.integrations.removeStagedBulk(selected);
      toast.success(`Removed ${r.removed} item${r.removed === 1 ? "" : "s"}`);
      setSelected([]);
      await loadStaged();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const filtered = (staged ?? []).filter((r) => (tab === "all" || r.status === tab) && (providerFilter === "all" || r.provider === providerFilter));

  if (loadingStatus) {
    return <div className="p-8 text-center text-sm text-[#595959]"><Loader2 className="inline animate-spin" size={18} /> Loading…</div>;
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold text-[#1A2B4C] flex items-center gap-2">
          <Boxes size={26} /> Integrations
        </h1>
        <p className="text-[#595959] text-sm mt-1">Pull your inventory from VasyERP or Shopify into Lokl as drafts, add photos, then publish.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <VasyErpConnectCard status={byProvider("vasyerp")} onConnected={loadStatus} onImport={() => void handleImport("vasyerp")} />
        <ShopifyConnectCard status={byProvider("shopify")} onConnected={loadStatus} onImport={() => void handleImport("shopify")} />
      </div>

      {anyConnected && (
        <>
          <div className="flex flex-wrap gap-1 border-b border-[#E5E2DC] mb-4">
            {STATUS_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                data-testid={`integrations-tab-${t.id}`}
                className={`px-3 py-2 text-xs font-semibold border-b-2 ${tab === t.id ? "border-[#E68910] text-[#1A2B4C]" : "border-transparent text-[#9CA3AF]"}`}
              >
                {t.label} {t.id !== "all" ? `(${(staged ?? []).filter((r) => r.status === t.id).length})` : `(${(staged ?? []).length})`}
              </button>
            ))}
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value as Provider | "all")}
              data-testid="integrations-provider-filter"
              className="ml-auto text-xs border border-[#E5E2DC] rounded-full px-3 py-1.5 bg-white text-[#595959]"
            >
              <option value="all">All sources</option>
              <option value="vasyerp">VasyERP</option>
              <option value="shopify">Shopify</option>
            </select>
          </div>

          {filtered.length > 0 && (
            <label className="flex items-center gap-2 mb-3 text-xs font-semibold text-[#595959] cursor-pointer w-fit">
              <input
                type="checkbox"
                data-testid="integrations-select-all"
                checked={filtered.length > 0 && filtered.every((r) => selected.includes(r.id))}
                ref={(el) => {
                  if (el) el.indeterminate = filtered.some((r) => selected.includes(r.id)) && !filtered.every((r) => selected.includes(r.id));
                }}
                onChange={(e) => {
                  const filteredIds = filtered.map((r) => r.id);
                  setSelected((s) => e.target.checked
                    ? Array.from(new Set([...s, ...filteredIds]))
                    : s.filter((id) => !filteredIds.includes(id)));
                }}
                className="w-4 h-4 accent-[#E68910]"
              />
              Select all in this view ({filtered.length})
            </label>
          )}

          {selected.length > 0 && (
            <div className="sticky top-2 z-20 mb-3 bg-[#1A2B4C] text-white rounded-2xl px-4 py-3 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{selected.length} selected</span>
              <div className="flex items-center gap-2">
                <button onClick={() => void publishBulk()} disabled={bulkBusy} data-testid="integrations-publish-bulk"
                  className="px-3 py-1.5 rounded-full bg-[#4F7363] text-xs font-semibold disabled:opacity-50">
                  {bulkBusy ? "Publishing…" : "Publish selected"}
                </button>
                <button onClick={() => void removeBulk()} disabled={bulkBusy} data-testid="integrations-remove-bulk"
                  className="px-3 py-1.5 rounded-full bg-red-500 text-xs font-semibold disabled:opacity-50">
                  {bulkBusy ? "Working…" : "Remove selected"}
                </button>
              </div>
            </div>
          )}

          {staged === null ? (
            <div className="p-8 text-center text-sm text-[#595959]"><Loader2 className="inline animate-spin" size={18} /></div>
          ) : filtered.length === 0 ? (
            <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center">
              <Boxes size={24} className="mx-auto text-[#94A3B8] mb-2" />
              <p className="text-sm text-[#595959]">
                {(staged ?? []).length === 0 ? "Nothing pulled yet — connect a source above and pull your inventory." : "Nothing in this tab."}
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
                  onRemove={() => void removeRow(row)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VasyErpConnectCard({ status, onConnected, onImport }: { status?: IntegrationStatus; onConnected: () => void; onImport: () => void }) {
  const [tokenInput, setTokenInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [branches, setBranches] = useState<VasyERPBranch[] | null>(null);
  const [selectingBranch, setSelectingBranch] = useState(false);
  const [importing, setImporting] = useState(false);

  const isConnected = !!status?.branch_id;

  const handleConnect = async () => {
    const token = tokenInput.trim();
    if (!token) { toast.error("Enter your VasyERP API token"); return; }
    setConnecting(true);
    try {
      const r = await api.integrations.connectVasyErp(token);
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
      await api.integrations.selectVasyErpBranch(b.id, b.name);
      toast.success(`${b.name} connected`);
      setBranches(null);
      setTokenInput("");
      onConnected();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSelectingBranch(false);
    }
  };

  const handleImportClick = async () => {
    setImporting(true);
    try { onImport(); } finally { setImporting(false); }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E5E2DC] p-5" data-testid="vasyerp-card">
      <h2 className="font-display text-base font-bold text-[#1A2B4C] flex items-center gap-1.5 mb-1"><Boxes size={16} /> VasyERP</h2>
      {isConnected ? (
        <>
          <p className="text-xs text-[#595959] mb-3">Connected · {status?.branch_name || status?.branch_id}</p>
          <p className="text-[11px] text-[#9CA3AF] mb-3">{status?.last_synced_at ? `Last synced ${new Date(status.last_synced_at).toLocaleString()}` : "Never synced yet"}</p>
          <button onClick={() => void handleImportClick()} disabled={importing} data-testid="vasyerp-import-btn"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1A2B4C] text-white text-xs font-semibold disabled:opacity-50">
            {importing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {importing ? "Pulling…" : "Pull latest inventory"}
          </button>
        </>
      ) : !branches ? (
        <>
          <p className="text-xs text-[#595959] mb-3">Find your API token in your VasyERP dashboard under account settings.</p>
          <input
            type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Paste your VasyERP api-token" data-testid="vasyerp-token-input"
            className="w-full px-3 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-sm mb-3"
          />
          <button onClick={() => void handleConnect()} disabled={connecting} data-testid="vasyerp-connect-btn"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#E68910] text-white text-xs font-semibold disabled:opacity-50">
            {connecting ? <Loader2 size={13} className="animate-spin" /> : null} {connecting ? "Connecting…" : "Connect"}
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-[#595959] mb-3">Which VasyERP branch is your Lokl store?</p>
          <div className="space-y-2">
            {branches.map((b) => (
              <button key={b.id} onClick={() => void handleSelectBranch(b)} disabled={selectingBranch} data-testid={`vasyerp-branch-${b.id}`}
                className="w-full text-left px-3 py-2.5 rounded-xl border border-[#E5E2DC] hover:border-[#1A2B4C] text-xs font-semibold text-[#1A2B4C] disabled:opacity-50">
                {b.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ShopifyConnectCard({ status, onConnected, onImport }: { status?: IntegrationStatus; onConnected: () => void; onImport: () => void }) {
  const [shopDomain, setShopDomain] = useState("");
  const [clientIdInput, setClientIdInput] = useState("");
  const [clientSecretInput, setClientSecretInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [importing, setImporting] = useState(false);

  const isConnected = status?.sync_status === "connected" || status?.sync_status === "synced";

  const handleConnect = async () => {
    const domain = shopDomain.trim();
    const clientId = clientIdInput.trim();
    const clientSecret = clientSecretInput.trim();
    if (!domain || !clientId || !clientSecret) { toast.error("Enter your shop domain, Client ID, and Client Secret"); return; }
    setConnecting(true);
    try {
      const r = await api.integrations.connectShopify(domain, clientId, clientSecret);
      toast.success(`Connected to ${r.shop_name}`);
      setShopDomain(""); setClientIdInput(""); setClientSecretInput("");
      onConnected();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleImportClick = async () => {
    setImporting(true);
    try { onImport(); } finally { setImporting(false); }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E5E2DC] p-5" data-testid="shopify-card">
      <h2 className="font-display text-base font-bold text-[#1A2B4C] flex items-center gap-1.5 mb-1"><ShoppingBag size={16} /> Shopify</h2>
      {isConnected ? (
        <>
          <p className="text-xs text-[#595959] mb-3">Connected · {status?.shop_name || status?.shop_domain}</p>
          <p className="text-[11px] text-[#9CA3AF] mb-3">{status?.last_synced_at ? `Last synced ${new Date(status.last_synced_at).toLocaleString()}` : "Never synced yet"}</p>
          <p className={`text-[11px] mb-3 font-semibold ${status?.inventory_sync_enabled ? "text-[#4F7363]" : "text-[#B45309]"}`}>
            {status?.inventory_sync_enabled
              ? "Two-way inventory sync active — orders here update Shopify, and vice versa"
              : "Two-way inventory sync is off — add write_inventory to your app's scopes in the Dev Dashboard and reconnect"}
          </p>
          <button onClick={() => void handleImportClick()} disabled={importing} data-testid="shopify-import-btn"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1A2B4C] text-white text-xs font-semibold disabled:opacity-50">
            {importing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {importing ? "Pulling…" : "Pull latest inventory"}
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-[#595959] mb-3">
            In your Shopify Dev Dashboard, create an app, set its scopes to read_products, read_inventory and
            write_inventory (the last one keeps stock in sync both ways after an order), and install it on your
            store — the app must belong to the same Shopify organization as this store. Then copy the Client ID
            and Client Secret from the app&apos;s API credentials page and paste them below (Shopify no longer
            issues a static access token here). Already connected without write_inventory? Add the scope in the
            Dev Dashboard and reconnect here — two-way sync won&apos;t start until you do.
          </p>
          <input
            type="text" value={shopDomain} onChange={(e) => setShopDomain(e.target.value)}
            placeholder="your-store.myshopify.com" data-testid="shopify-domain-input"
            className="w-full px-3 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-sm mb-2"
          />
          <input
            type="text" value={clientIdInput} onChange={(e) => setClientIdInput(e.target.value)}
            placeholder="Client ID" data-testid="shopify-client-id-input"
            className="w-full px-3 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-sm mb-2"
          />
          <input
            type="password" value={clientSecretInput} onChange={(e) => setClientSecretInput(e.target.value)}
            placeholder="Client Secret" data-testid="shopify-client-secret-input"
            className="w-full px-3 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-sm mb-3"
          />
          <button onClick={() => void handleConnect()} disabled={connecting} data-testid="shopify-connect-btn"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#E68910] text-white text-xs font-semibold disabled:opacity-50">
            {connecting ? <Loader2 size={13} className="animate-spin" /> : null} {connecting ? "Connecting…" : "Connect"}
          </button>
        </>
      )}
    </div>
  );
}

function StagedRow({
  row, categories, checked, onToggleSelect, onPatch, onSaveMapping, onUpload, onPublish, onRemove,
}: {
  row: StagedImport;
  categories: CategoryNode[];
  checked: boolean;
  onToggleSelect: () => void;
  onPatch: (p: Partial<StagedImport>) => void;
  onSaveMapping: () => void;
  onUpload: (f: File | undefined) => void;
  onPublish: () => void;
  onRemove: () => void;
}) {
  const currentL1 = categories.find((c) => c.id === row.l1_id);
  const hasL2 = !!(currentL1 && currentL1.l2 && currentL1.l2.length > 0);
  const providerLabel = PROVIDER_LABEL[row.provider] || row.provider;

  return (
    <div className="bg-white rounded-2xl border border-[#E5E2DC] p-4" data-testid={`integrations-staged-${row.id}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={checked} onChange={onToggleSelect} className="mt-1.5 w-4 h-4 accent-[#E68910]" data-testid={`integrations-select-${row.id}`} />
        <div className="w-14 h-14 rounded-xl overflow-hidden bg-[#F5F5F5] flex-shrink-0 flex items-center justify-center">
          {row.image ? <img src={row.image} alt={row.name} className="w-full h-full object-cover" /> : <ImageIcon size={18} className="text-[#9CA3AF]" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-[#F1F5F9] text-[#64748B]">{providerLabel}</span>
            <div className="font-bold text-[#1A2B4C] text-sm truncate">{row.name}</div>
          </div>
          <div className="text-xs text-[#595959] mt-0.5">
            ₹{row.price ?? "—"} {row.mrp && row.mrp !== row.price ? <span className="line-through text-[#9CA3AF]">₹{row.mrp}</span> : null} · qty {row.qty}
            {row.sizes && row.sizes.length > 0 && <> · sizes {row.sizes.join(", ")}</>}
          </div>
        </div>
        <StatusPill status={row.status} />
        <button onClick={onRemove} title="Remove from import list" data-testid={`integrations-remove-${row.id}`}
          className="p-1.5 rounded-full text-[#9CA3AF] hover:text-red-500 hover:bg-red-50 shrink-0">
          <Trash2 size={14} />
        </button>
      </div>

      {row.status === "pending_review" && (
        <div className="mt-3 pt-3 border-t border-[#F1F5F9] grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid={`integrations-review-${row.id}`}>
          <div className="sm:col-span-3 flex items-center gap-2 text-[11px] text-[#B45309] bg-[#FEF3C7] rounded-lg px-3 py-2">
            <AlertTriangle size={13} className="shrink-0" />
            {providerLabel} category &ldquo;{row.raw_category || "(blank)"}&rdquo; didn&apos;t match — pick one manually.
            {row.brand_unmatched && row.raw_brand && <> Brand &ldquo;{row.raw_brand}&rdquo; also didn&apos;t match — search below or leave blank.</>}
          </div>
          <div>
            <label className="text-[10px] font-bold text-[#595959] uppercase tracking-wide block mb-1">Category</label>
            <select
              value={row.l1_id || ""}
              onChange={(e) => onPatch({ l1_id: e.target.value || null, l2_id: null })}
              data-testid={`integrations-l1-${row.id}`}
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
                data-testid={`integrations-l2-${row.id}`}
                className="w-full px-3 py-2 rounded-lg border border-[#E5E2DC] outline-none bg-white text-sm"
              >
                <option value="">Select sub-category</option>
                {(currentL1?.l2 || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div className={hasL2 ? "" : "sm:col-span-2"}>
            <BrandCombobox value={row.brand_id || ""} onChange={(brand_id) => onPatch({ brand_id: brand_id || null })} testid={`integrations-brand-${row.id}`} />
          </div>
          <div className="sm:col-span-3">
            <button
              onClick={onSaveMapping}
              disabled={!row.l1_id || (hasL2 && !row.l2_id)}
              data-testid={`integrations-save-mapping-${row.id}`}
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
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" data-testid={`integrations-upload-${row.id}`}
              onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
      )}

      {row.status === "ready" && (
        <div className="mt-3 pt-3 border-t border-[#F1F5F9] flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#4F7363]"><Check size={13} /> Ready to publish</span>
          <button onClick={onPublish} data-testid={`integrations-publish-${row.id}`} className="px-4 py-2 rounded-full bg-[#E68910] text-white text-xs font-bold">
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
