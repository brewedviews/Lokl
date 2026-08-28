"use client";

/**
 * Admin Merchant Detail — G25. The single, comprehensive per-merchant
 * operations page: ADMIN → MERCHANT → STORE → PRODUCTS, replacing the
 * old model where Merchants and Products were two disconnected tabs with
 * no drill-down between them.
 *
 * Reuses existing backend contracts wherever they already existed
 * (merchant/store approve/reject/hold, product pause/unpause/delete,
 * KYC signed-doc URLs, change-request listing) and adds only the
 * genuinely-missing pieces (see server.py's own G25 comments): PUT
 * /admin/merchants/{id} and PUT /admin/stores/{id} for customer-facing
 * content cleanup, PUT /admin/products/{id} (which itself reuses the
 * merchant PUT's exact update logic via `_apply_product_update`, not a
 * second implementation), and an optional `merchant_id` filter on the
 * existing GET /admin/stores.
 *
 * Same `adminFetch()` legacy-shim pattern the Merchants/Products tabs in
 * app/admin/page.tsx already use (not the newer typed `adminApi` client)
 * — this page is a direct extension of those two tabs' own data model,
 * so it stays consistent with them rather than introducing a third
 * fetch convention into the same operational surface.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft, ExternalLink, FileText, Loader2, Pencil, ShieldCheck,
  Store as StoreIcon, Package, ClipboardList, History, AlertTriangle,
} from "lucide-react";
import { adminFetch } from "@/lib/legacy-admin";

// ---------------------------------------------------------------------
// Types — mirror the real Mongo shapes (merchants/stores/products), same
// discipline the rest of the app's type files already use. Only the
// fields this page actually reads are declared.
// ---------------------------------------------------------------------
interface KycHistoryEntry {
  status: string;
  submitted_at?: string | null;
  rejected_reason?: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
  hold_comment?: string | null;
  hold_at?: string | null;
  archived_at: string;
}

interface Merchant {
  id: string;
  email?: string;
  phone?: string;
  store_name: string;
  owner_name?: string;
  city?: string;
  kyc_status: string;
  kyc_submitted_at?: string;
  approved_at?: string;
  kyc_rejected_reason?: string | null;
  kyc_rejected_at?: string | null;
  kyc_rejected_by?: string | null;
  hold_comment?: string;
  hold_at?: string;
  kyc_history?: KycHistoryEntry[];
  pan_number?: string;
  gst_number?: string;
  business_name?: string;
  business_category?: string;
  business_type?: string;
  business_address?: string;
  bank_account_number?: string;
  bank_ifsc?: string;
  account_holder_name?: string;
  plan?: string;
  subscription_status?: string;
  plan_expires_at?: string;
  created_at?: string;
}

interface AdminProduct {
  id: string;
  name: string;
  description?: string;
  price: number;
  mrp?: number | null;
  l1_id?: string;
  l2_id?: string;
  image?: string;
  images?: string[];
  paused?: boolean;
  stock?: Record<string, number>;
  total_stock?: number;
  store_id: string;
  updated_at?: string;
  created_at?: string;
}

interface AdminStore {
  id: string;
  slug?: string;
  name: string;
  tagline?: string;
  story?: string;
  banner?: string;
  logo?: string;
  area?: string;
  area_label?: string;
  locality?: string;
  pincode?: string;
  address?: string;
  timing?: string;
  opens_at?: string;
  closes_at?: string;
  weekly_off?: string[];
  specialties?: string[];
  online?: boolean;
  paused?: boolean;
  published?: boolean;
  product_count?: number;
  // G25 — stamped by the SAME _store_availability() every customer
  // surface uses (see server.py's GET /admin/stores), never recomputed
  // separately here.
  badge?: string;
  can_order?: boolean;
  eta_message?: string;
  opens_at_label?: string | null;
  products?: AdminProduct[];
}

interface ChangeRequest {
  id: string;
  merchant_id: string;
  change_type: "bank" | "address" | string;
  status: string;
  created_at: string;
  reason?: string;
  new_values?: Record<string, unknown>;
}

type Section = "overview" | "store" | "products" | "kyc" | "activity";

// ---------------------------------------------------------------------
// Status presentation — one place that turns raw fields into a label +
// color, reused across the header/Store section/list, so this page can
// never show two different words for the same underlying state.
// ---------------------------------------------------------------------
const KYC_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Not submitted", cls: "bg-zinc-100 text-zinc-500" },
  submitted: { label: "Pending review", cls: "bg-[#E68910]/15 text-[#E68910]" },
  approved: { label: "Approved", cls: "bg-green-100 text-green-700" },
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-600" },
  on_hold: { label: "Needs changes", cls: "bg-[#E68910]/15 text-[#E68910]" },
};
function kycMeta(status: string | undefined) {
  return KYC_META[status || "draft"] || { label: status || "Unknown", cls: "bg-zinc-100 text-zinc-500" };
}

/** Store operational status — deliberately does NOT conflate "outside
 *  operating hours" with "taken offline" with "suspended by admin" (G24/
 *  G25's own rule). Priority: no storefront > pending (never published)
 *  > suspended (admin paused) > the real availability badge. */
function storeStatusMeta(store: AdminStore | null): { label: string; cls: string } {
  if (!store) return { label: "No storefront yet", cls: "bg-zinc-100 text-zinc-500" };
  if (!store.published) return { label: "Pending", cls: "bg-zinc-100 text-zinc-500" };
  if (store.paused) return { label: "Suspended", cls: "bg-red-100 text-red-600" };
  switch (store.badge) {
    case "LIVE": return { label: "Open now", cls: "bg-green-100 text-green-700" };
    case "Away": return { label: "Back soon", cls: "bg-[#E68910]/15 text-[#E68910]" };
    case "Closed": return { label: store.opens_at_label ? `Closed · ${store.opens_at_label}` : "Closed", cls: "bg-zinc-100 text-zinc-600" };
    case "Store Offline": return { label: "Temporarily unavailable", cls: "bg-red-100 text-red-600" };
    default: return { label: "Unknown", cls: "bg-zinc-100 text-zinc-500" };
  }
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

// ---------------------------------------------------------------------
// Content-quality warnings — deterministic, non-destructive (§7): flags
// suspicious merchant-entered content for a human to review, never
// auto-rewrites anything. No external AI service — plain heuristics.
// ---------------------------------------------------------------------
function qualityWarnings(m: Merchant, store: AdminStore | null): string[] {
  const warnings: string[] = [];
  const isAllCaps = (s: string) => s.length >= 4 && s === s.toUpperCase() && /[A-Z]/.test(s);
  if (m.store_name && isAllCaps(m.store_name)) warnings.push("Store name is ALL CAPS");
  if (m.owner_name && isAllCaps(m.owner_name)) warnings.push("Person name is ALL CAPS");
  if (m.owner_name && m.store_name && m.owner_name.trim().toLowerCase() === m.store_name.trim().toLowerCase()) {
    warnings.push("Person name and store name are identical — check they weren't swapped or duplicated");
  }
  const bizTerms = /\b(store|shop|mart|fashion|boutique|traders|enterprises|collection|emporium)\b/i;
  if (m.owner_name && bizTerms.test(m.owner_name)) warnings.push("Person name contains a business-sounding term — may have store name in the wrong field");
  if (store) {
    if (!store.story || store.story.trim().length < 15) warnings.push("Store description is empty or very short");
    if (store.story && /(.)\1{4,}/.test(store.story)) warnings.push("Store description has repeated characters");
    const words = (store.story || "").trim().split(/\s+/).filter(Boolean);
    const dupWords = words.some((w, i) => i > 0 && w.toLowerCase() === words[i - 1]?.toLowerCase() && w.length > 2);
    if (dupWords) warnings.push("Store description has a repeated word");
    if (store.tagline && isAllCaps(store.tagline)) warnings.push("Store tagline is ALL CAPS");
  }
  if (m.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)) warnings.push("Email looks malformed");
  return warnings;
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------
export default function MerchantDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const mid = params.id;

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [store, setStore] = useState<AdminStore | null>(null);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>("overview");
  const [editingMerchant, setEditingMerchant] = useState(false);
  const [editingStore, setEditingStore] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, stores, crs] = await Promise.all([
        adminFetch<Merchant>(`/api/admin/merchants/${mid}`),
        adminFetch<AdminStore[]>(`/api/admin/stores?merchant_id=${mid}`),
        adminFetch<ChangeRequest[]>("/api/admin/change-requests"),
      ]);
      setMerchant(m);
      setStore(stores[0] || null);
      setChangeRequests(crs.filter((c) => c.merchant_id === mid));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mid]);
  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-[#595959]" data-testid="merchant-detail-loading">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading merchant…
      </div>
    );
  }
  if (!merchant) {
    return (
      <div className="text-center py-24" data-testid="merchant-detail-not-found">
        <p className="text-sm text-[#595959]">Merchant not found.</p>
        <button onClick={() => router.push("/admin")} className="mt-3 text-xs font-semibold text-[#0A1F5C] hover:underline">← Back to Admin</button>
      </div>
    );
  }

  const kyc = kycMeta(merchant.kyc_status);
  const status = storeStatusMeta(store);
  const warnings = qualityWarnings(merchant, store);
  const initial = (merchant.store_name || merchant.owner_name || "M").trim().charAt(0).toUpperCase();

  const SECTIONS: Array<{ id: Section; label: string; icon: React.ComponentType<{ size?: number }> }> = [
    { id: "overview", label: "Overview", icon: ClipboardList },
    { id: "store", label: "Store", icon: StoreIcon },
    { id: "products", label: "Products", icon: Package },
    { id: "kyc", label: "KYC", icon: ShieldCheck },
    { id: "activity", label: "Activity", icon: History },
  ];

  return (
    <div data-testid="merchant-detail-page">
      <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#595959] hover:text-[#0A1F5C] mb-4">
        <ArrowLeft size={13} /> Back to Merchants
      </Link>

      {/* ---- Header ---- */}
      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5 mb-4" data-testid="merchant-header">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-[#0A1F5C] text-white flex items-center justify-center shrink-0 font-display font-bold text-lg">
              {store?.logo ? <img src={store.logo} alt="" className="w-full h-full object-cover" /> : initial}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-lg font-bold text-[#0A1F5C] truncate">{merchant.store_name}</h1>
                <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
                <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${kyc.cls}`}>KYC: {kyc.label}</span>
              </div>
              <div className="text-xs text-[#595959] mt-0.5">{merchant.owner_name || "—"} · {merchant.email || "no email"} · {merchant.phone || "no phone"}</div>
              <div className="text-xs text-[#595959] mt-0.5">{store?.area_label || store?.locality || merchant.city || "—"}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setEditingMerchant(true)} data-testid="edit-merchant-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E5E2DC] hover:border-[#0A1F5C]">
              <Pencil size={11} /> Edit merchant
            </button>
            {store && (
              <a href={`/store/${store.slug || store.id}`} target="_blank" rel="noopener noreferrer" data-testid="view-store-btn"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E5E2DC] hover:border-[#0A1F5C]">
                <ExternalLink size={11} /> View store
              </a>
            )}
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[#F0EFED] flex items-start gap-2" data-testid="quality-warnings">
            <AlertTriangle size={14} className="text-[#E68910] shrink-0 mt-0.5" />
            <div className="text-xs text-[#E68910]">
              <span className="font-semibold">Review: </span>
              {warnings.join(" · ")}
            </div>
          </div>
        )}
      </div>

      {/* ---- Section tabs ---- */}
      <div className="flex gap-1 border-b border-[#E5E2DC] mb-4 overflow-x-auto" data-testid="merchant-section-tabs">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button key={s.id} onClick={() => setSection(s.id)} data-testid={`merchant-section-${s.id}`}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 ${active ? "border-[#E68910] text-[#0A1F5C]" : "border-transparent text-[#595959] hover:text-[#0A1F5C]"}`}>
              <Icon size={13} /> {s.label}
              {s.id === "products" && store?.products?.length ? <span className="text-[10px] text-[#94A3B8]">({store.products.length})</span> : null}
            </button>
          );
        })}
      </div>

      {section === "overview" && <OverviewSection merchant={merchant} store={store} onReload={load} />}
      {section === "store" && <StoreSection store={store} onEdit={() => setEditingStore(true)} onReload={load} />}
      {section === "products" && <ProductsSection store={store} onReload={load} />}
      {section === "kyc" && <KycSection merchant={merchant} onReload={load} />}
      {section === "activity" && <ActivitySection changeRequests={changeRequests} />}

      {editingMerchant && (
        <EditMerchantModal merchant={merchant} onClose={() => setEditingMerchant(false)} onSaved={() => { setEditingMerchant(false); void load(); }} />
      )}
      {editingStore && store && (
        <EditStoreModal store={store} onClose={() => setEditingStore(false)} onSaved={() => { setEditingStore(false); void load(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Overview — identity + store status + account summary + quick actions.
// ---------------------------------------------------------------------
function OverviewSection({ merchant, store, onReload }: { merchant: Merchant; store: AdminStore | null; onReload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [planSelection, setPlanSelection] = useState(merchant.plan || "growth");
  const [showPlanForm, setShowPlanForm] = useState(false);

  const toggleStore = async () => {
    if (!store) return;
    setBusy(true);
    try {
      const action = store.paused ? "unpause" : "pause";
      await adminFetch(`/api/admin/stores/${store.id}/${action}`, { method: "POST" });
      toast.success(action === "pause" ? "Store suspended" : "Store reactivated");
      onReload();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const activatePlan = async () => {
    setBusy(true);
    try {
      await adminFetch(`/api/admin/merchant/${merchant.id}/activate-plan`, { method: "POST", body: JSON.stringify({ plan: planSelection }) });
      toast.success(`Plan ${planSelection} activated`);
      setShowPlanForm(false);
      onReload();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid md:grid-cols-2 gap-4" data-testid="overview-section">
      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#595959] mb-3">Account</h3>
        <dl className="space-y-2 text-sm">
          <Row label="Merchant ID" value={merchant.id} mono />
          <Row label="Owner name" value={merchant.owner_name || "—"} />
          <Row label="Email" value={merchant.email || "—"} />
          <Row label="Phone" value={merchant.phone || "—"} />
          <Row label="City" value={merchant.city || "—"} />
          <Row label="Created" value={fmtDate(merchant.created_at)} />
        </dl>
      </div>

      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#595959] mb-3">Plan &amp; subscription</h3>
        <dl className="space-y-2 text-sm mb-3">
          <Row label="Plan" value={merchant.plan || "free"} />
          <Row label="Subscription status" value={merchant.subscription_status || "—"} />
          <Row label="Expires" value={fmtDate(merchant.plan_expires_at)} />
        </dl>
        {showPlanForm ? (
          <div className="flex items-center gap-2">
            <select value={planSelection} onChange={(e) => setPlanSelection(e.target.value)} className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#E5E2DC] text-xs">
              <option value="free">Free</option>
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="pro">Pro</option>
            </select>
            <button onClick={activatePlan} disabled={busy} data-testid="overview-plan-activate" className="px-3 py-1.5 rounded-full text-xs font-semibold bg-purple-600 text-white disabled:opacity-40">Activate</button>
            <button onClick={() => setShowPlanForm(false)} className="text-xs text-[#595959]">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setShowPlanForm(true)} className="text-xs font-semibold text-[#0A1F5C] hover:underline">Change plan</button>
        )}
      </div>

      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4 md:col-span-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#595959] mb-3">Store availability control</h3>
        <p className="text-xs text-[#595959] mb-3 max-w-2xl">
          Suspending is an ADMIN action, independent of the merchant&apos;s own operating hours or online toggle — it
          takes priority over both (a suspended store stays hidden even during its normal open hours).
        </p>
        {!store ? (
          <p className="text-xs text-[#94A3B8]">No storefront set up yet.</p>
        ) : (
          <button onClick={toggleStore} disabled={busy} data-testid="overview-toggle-suspend"
            className={`px-4 py-2 rounded-full text-xs font-bold disabled:opacity-50 ${store.paused ? "bg-[#4F7363] text-white" : "bg-red-500 text-white"}`}>
            {store.paused ? "Reactivate store" : "Suspend store"}
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[#94A3B8]">{label}</dt>
      <dd className={`text-[#0A1F5C] font-medium text-right ${mono ? "font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------
// Store section
// ---------------------------------------------------------------------
function StoreSection({ store, onEdit, onReload }: { store: AdminStore | null; onEdit: () => void; onReload: () => void }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!store) {
    return (
      <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center text-sm text-[#595959]" data-testid="store-section-empty">
        This merchant hasn&apos;t set up a storefront yet.
      </div>
    );
  }

  const requestDelete = async () => {
    setOtp(""); setOtpSent(false); setDeleteOpen(true);
    try {
      const r = await adminFetch<{ ok: boolean; otp_demo?: string }>(`/api/admin/stores/${store.id}/request-delete-otp`, { method: "POST" });
      setOtpSent(true);
      if (r.otp_demo) setOtp(r.otp_demo);
      toast.success("OTP sent");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); setDeleteOpen(false); }
  };
  const confirmDelete = async () => {
    if (otp.length !== 6) { toast.error("Enter the 6-digit OTP"); return; }
    setBusy(true);
    try {
      await adminFetch(`/api/admin/stores/${store.id}`, { method: "DELETE", body: JSON.stringify({ otp }) });
      toast.success("Store deleted");
      setDeleteOpen(false);
      onReload();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="store-section">
      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-[#595959]">Store content</h3>
          <button onClick={onEdit} data-testid="edit-store-btn" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0A1F5C] hover:underline"><Pencil size={11} /> Edit store</button>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row label="Name" value={store.name} />
          <Row label="Tagline" value={store.tagline || "—"} />
          <Row label="Area" value={store.area_label || store.locality || "—"} />
          <Row label="Pincode" value={store.pincode || "—"} />
          <Row label="Address" value={store.address || "—"} />
          <Row label="Timing" value={store.timing || `${store.opens_at || "—"} – ${store.closes_at || "—"}`} />
          <Row label="Weekly off" value={(store.weekly_off || []).join(", ") || "None"} />
          <Row label="Products" value={String(store.product_count ?? store.products?.length ?? 0)} />
        </div>
        {store.story && (
          <div className="mt-3 pt-3 border-t border-[#F0EFED]">
            <div className="text-[10px] uppercase tracking-widest text-[#94A3B8] mb-1">Description</div>
            <p className="text-sm text-[#0A1F5C]">{store.story}</p>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#595959] mb-3">Danger zone</h3>
        <button onClick={requestDelete} data-testid="delete-store-btn" className="text-xs font-semibold text-red-500 hover:underline">Delete store &amp; merchant…</button>
      </div>

      {deleteOpen && (
        <ConfirmModal
          title={`Delete ${store.name}?`}
          body="This wipes the store, its products, the merchant account, and all related orders. An OTP has been sent to the admin inbox."
          onClose={() => setDeleteOpen(false)}
        >
          <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6-digit OTP" data-testid="store-delete-otp"
            className="mt-4 w-full px-4 py-3 rounded-xl border border-[#E5E2DC] text-center font-mono text-lg tracking-[0.4em]" />
          <div className="flex items-center justify-end gap-2 mt-5">
            <button onClick={() => setDeleteOpen(false)} className="px-4 py-2 rounded-full text-xs font-semibold bg-white border border-[#E5E2DC]">Cancel</button>
            <button onClick={confirmDelete} disabled={!otpSent || otp.length !== 6 || busy} data-testid="store-delete-confirm"
              className="px-4 py-2 rounded-full text-xs font-semibold bg-red-500 text-white disabled:opacity-50">
              {busy ? "Deleting…" : "Confirm delete"}
            </button>
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Products section — reuses the SAME admin product actions the old
// global Products tab had (pause/unpause/delete), plus the new PUT
// /admin/products/{id} content edit. No second product-management
// implementation.
// ---------------------------------------------------------------------
function ProductsSection({ store, onReload }: { store: AdminStore | null; onReload: () => void }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "out_of_stock">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminProduct | null>(null);

  const products = store?.products || [];
  const filtered = products.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false;
    const stock = p.total_stock ?? Object.values(p.stock || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    if (statusFilter === "active" && p.paused) return false;
    if (statusFilter === "inactive" && !p.paused) return false;
    if (statusFilter === "out_of_stock" && stock > 0) return false;
    return true;
  });

  const toggle = async (p: AdminProduct) => {
    setBusy(p.id);
    try {
      const action = p.paused ? "unpause" : "pause";
      await adminFetch(`/api/admin/products/${p.id}/${action}`, { method: "POST" });
      toast.success(`Product ${action}d`);
      onReload();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const remove = async (p: AdminProduct) => {
    if (!window.confirm(`Delete product "${p.name}"? This cannot be undone.`)) return;
    setBusy(p.id);
    try {
      await adminFetch(`/api/admin/products/${p.id}`, { method: "DELETE" });
      toast.success("Product deleted");
      onReload();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  if (!store) {
    return <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center text-sm text-[#595959]">No storefront yet — nothing to list.</div>;
  }

  return (
    <div data-testid="products-section">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#595959]">{filtered.length} of {products.length} products</h3>
        <div className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" data-testid="products-search"
            className="px-3 py-1.5 rounded-full border border-[#E5E2DC] text-xs w-48" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} data-testid="products-filter"
            className="px-3 py-1.5 rounded-full border border-[#E5E2DC] text-xs">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="out_of_stock">Out of stock</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center text-sm text-[#595959]">No products match.</div>
      ) : (
        <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF7] text-left text-[10px] uppercase text-[#595959]">
              <tr>
                <th className="px-3 py-2.5">Product</th>
                <th className="px-3 py-2.5 text-right">Price</th>
                <th className="px-3 py-2.5 text-right">MRP</th>
                <th className="px-3 py-2.5 text-right">Stock</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const stock = p.total_stock ?? Object.values(p.stock || {}).reduce((a, b) => a + (Number(b) || 0), 0);
                return (
                  <tr key={p.id} className="border-t border-[#E5E2DC]" data-testid={`merchant-prod-row-${p.id}`}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        {p.image && <img src={p.image} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />}
                        <span className="font-semibold text-[#0A1F5C] truncate">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">₹{Number(p.price).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-[#94A3B8]">{p.mrp ? `₹${Number(p.mrp).toLocaleString()}` : "—"}</td>
                    <td className="px-3 py-2.5 text-right">{stock <= 0 ? <span className="text-red-500 font-semibold">0</span> : stock}</td>
                    <td className="px-3 py-2.5"><span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${p.paused ? "bg-red-100 text-red-500" : "bg-[#4F7363]/15 text-[#4F7363]"}`}>{p.paused ? "paused" : "active"}</span></td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap space-x-2">
                      <button onClick={() => setEditing(p)} data-testid={`merchant-prod-edit-${p.id}`} className="text-xs font-semibold text-[#0A1F5C] hover:underline">Edit</button>
                      <button onClick={() => toggle(p)} disabled={busy === p.id} className="text-xs font-semibold text-[#E68910] hover:underline disabled:opacity-50">{p.paused ? "Unpause" : "Pause"}</button>
                      <button onClick={() => remove(p)} disabled={busy === p.id} className="text-xs font-semibold text-red-500 hover:underline disabled:opacity-50">Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditProductModal product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onReload(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// KYC section
// ---------------------------------------------------------------------
function KycSection({ merchant, onReload }: { merchant: Merchant; onReload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [holding, setHolding] = useState(false);
  const [comment, setComment] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const kyc = kycMeta(merchant.kyc_status);
  const history = merchant.kyc_history || [];

  const approve = async () => {
    setBusy(true);
    try {
      await adminFetch(`/api/admin/merchants/${merchant.id}/approve`, { method: "POST" });
      toast.success("Merchant approved");
      onReload();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const confirmReject = async () => {
    if (!reason.trim()) { toast.error("Rejection reason is required"); return; }
    setBusy(true);
    try {
      await adminFetch(`/api/admin/merchants/${merchant.id}/reject`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      toast.success("Merchant rejected");
      setRejecting(false); setReason("");
      onReload();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const confirmHold = async () => {
    if (!comment.trim()) { toast.error("A comment is required so the merchant knows what to fix"); return; }
    setBusy(true);
    try {
      await adminFetch(`/api/admin/merchants/${merchant.id}/hold`, { method: "POST", body: JSON.stringify({ reason: comment.trim() }) });
      toast.success("Requested resubmission");
      setHolding(false); setComment("");
      onReload();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const openDoc = async (doc: "pan_doc" | "gst_doc" | "cancelled_cheque") => {
    try {
      const r = await adminFetch<{ url: string }>(`/api/admin/kyc/${merchant.id}/signed-url?doc=${doc}`);
      window.open(r.url, "_blank", "noopener,noreferrer");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="space-y-4" data-testid="kyc-section">
      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-[#595959]">Current KYC state</h3>
          <span className={`text-[10px] uppercase font-bold px-2.5 py-1 rounded-full ${kyc.cls}`}>{kyc.label}</span>
        </div>

        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mb-3">
          <Row label="Business name" value={merchant.business_name || "—"} />
          <Row label="Business type" value={merchant.business_type || "—"} />
          <Row label="Business category" value={merchant.business_category || "—"} />
          <Row label="Business address" value={merchant.business_address || "—"} />
          <Row label="PAN" value={merchant.pan_number || "—"} mono />
          <Row label="GST" value={merchant.gst_number || "—"} mono />
          <Row label="Bank account" value={merchant.bank_account_number || "—"} mono />
          <Row label="IFSC" value={merchant.bank_ifsc || "—"} mono />
          <Row label="Account holder" value={merchant.account_holder_name || "—"} />
          <Row label="Submitted" value={fmtDate(merchant.kyc_submitted_at)} />
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => openDoc("pan_doc")} data-testid="kyc-doc-pan" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E5E2DC] hover:border-[#0A1F5C]"><FileText size={11} /> PAN <ExternalLink size={10} /></button>
          <button onClick={() => openDoc("gst_doc")} data-testid="kyc-doc-gst" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E5E2DC] hover:border-[#0A1F5C]"><FileText size={11} /> GST</button>
          <button onClick={() => openDoc("cancelled_cheque")} data-testid="kyc-doc-cheque" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E5E2DC] hover:border-[#0A1F5C]"><FileText size={11} /> Cheque</button>
        </div>

        {merchant.kyc_status === "rejected" && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl mb-3 text-xs text-red-700">
            <div className="font-semibold mb-1">Rejected</div>
            <div>{merchant.kyc_rejected_reason || "No reason recorded."}</div>
            <div className="mt-1 text-red-500">{fmtDate(merchant.kyc_rejected_at)}{merchant.kyc_rejected_by ? ` · by ${merchant.kyc_rejected_by}` : ""}</div>
          </div>
        )}
        {merchant.kyc_status === "on_hold" && (
          <div className="p-3 bg-[#FFF8E7] border border-[#F5D599] rounded-xl mb-3 text-xs text-[#92400E]">
            <div className="font-semibold mb-1">On hold — merchant asked to fix and resubmit</div>
            <div>{merchant.hold_comment}</div>
            <div className="mt-1 text-[#B45309]">{fmtDate(merchant.hold_at)}</div>
          </div>
        )}

        {merchant.kyc_status === "submitted" && (
          <div className="flex items-center gap-2">
            <button onClick={approve} disabled={busy} data-testid="kyc-approve" className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#4F7363] text-white disabled:opacity-50">Approve</button>
            <button onClick={() => setHolding(true)} disabled={busy} data-testid="kyc-hold" className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#E68910] text-white disabled:opacity-50">Request resubmission</button>
            <button onClick={() => setRejecting(true)} disabled={busy} data-testid="kyc-reject" className="px-3 py-1.5 rounded-full text-xs font-semibold bg-red-500 text-white disabled:opacity-50">Reject</button>
          </div>
        )}

        {holding && (
          <div className="mt-3 p-3 bg-[#FFF8E7] border border-[#F5D599] rounded-xl space-y-2">
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">What should the merchant fix? (required)</label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} data-testid="kyc-hold-comment"
              className="w-full px-3 py-2 rounded-lg border border-[#E5E2DC] text-sm bg-white focus:border-[#0A1F5C] outline-none" />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => { setHolding(false); setComment(""); }} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white border border-[#E5E2DC] text-[#595959]">Cancel</button>
              <button onClick={confirmHold} disabled={busy || !comment.trim()} data-testid="kyc-hold-confirm" className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#E68910] text-white disabled:opacity-40">{busy ? "Saving…" : "Confirm"}</button>
            </div>
          </div>
        )}
        {rejecting && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl space-y-2">
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Reason for rejection (required)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} data-testid="kyc-reject-comment"
              className="w-full px-3 py-2 rounded-lg border border-[#E5E2DC] text-sm bg-white focus:border-[#0A1F5C] outline-none" />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => { setRejecting(false); setReason(""); }} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white border border-[#E5E2DC] text-[#595959]">Cancel</button>
              <button onClick={confirmReject} disabled={busy || !reason.trim()} data-testid="kyc-reject-confirm" className="px-3 py-1.5 rounded-full text-xs font-semibold bg-red-500 text-white disabled:opacity-40">{busy ? "Saving…" : "Confirm reject"}</button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
        <button onClick={() => setShowHistory((v) => !v)} data-testid="kyc-history-toggle" className="text-xs font-bold uppercase tracking-widest text-[#595959] hover:text-[#0A1F5C]">
          Previous submissions ({history.length}) {showHistory ? "▲" : "▼"}
        </button>
        {showHistory && (
          history.length === 0 ? (
            <p className="text-xs text-[#94A3B8] mt-2">No previous submissions on file.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {[...history].reverse().map((h, i) => {
                const m = kycMeta(h.status);
                return (
                  <div key={i} className="p-3 bg-[#FDFBF7] border border-[#E5E2DC] rounded-xl text-xs" data-testid={`kyc-history-${i}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>
                      <span className="text-[#94A3B8]">archived {fmtDate(h.archived_at)}</span>
                    </div>
                    {h.rejected_reason && <div className="text-[#595959]">Rejected: {h.rejected_reason} ({fmtDate(h.rejected_at)})</div>}
                    {h.hold_comment && <div className="text-[#595959]">Hold note: {h.hold_comment} ({fmtDate(h.hold_at)})</div>}
                    {h.submitted_at && <div className="text-[#94A3B8] mt-0.5">Originally submitted {fmtDate(h.submitted_at)}</div>}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Activity section — bank/address change requests scoped to this
// merchant, reusing the existing GET /admin/change-requests data (no new
// endpoint) filtered client-side.
// ---------------------------------------------------------------------
function ActivitySection({ changeRequests }: { changeRequests: ChangeRequest[] }) {
  if (changeRequests.length === 0) {
    return <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center text-sm text-[#595959]" data-testid="activity-empty">No bank/address change requests from this merchant.</div>;
  }
  return (
    <div className="space-y-2" data-testid="activity-section">
      {changeRequests.map((cr) => (
        <div key={cr.id} className="bg-white border border-[#E5E2DC] rounded-2xl p-3.5 flex items-center justify-between gap-3" data-testid={`activity-row-${cr.id}`}>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[#0A1F5C] capitalize">{cr.change_type} change request</div>
            <div className="text-xs text-[#595959] mt-0.5">{fmtDate(cr.created_at)}</div>
          </div>
          <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full shrink-0 ${
            cr.status === "approved" ? "bg-green-100 text-green-700" : cr.status === "rejected" ? "bg-red-100 text-red-600" : "bg-[#E68910]/15 text-[#E68910]"
          }`}>{cr.status}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Shared modal chrome
// ---------------------------------------------------------------------
function ConfirmModal({ title, body, onClose, children }: { title: string; body: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl max-w-md w-full p-6">
        <div className="font-display text-lg font-bold text-[#0A1F5C]">{title}</div>
        <p className="text-xs text-[#595959] mt-2">{body}</p>
        {children}
      </div>
    </div>
  );
}

function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={`bg-white rounded-2xl w-full p-6 my-8 ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <div className="font-display text-lg font-bold text-[#0A1F5C] mb-4">{title}</div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
const inputCls = "w-full px-3 py-2 rounded-lg border border-[#E5E2DC] text-sm bg-white focus:border-[#0A1F5C] outline-none";

// ---------------------------------------------------------------------
// Edit Merchant modal — PUT /admin/merchants/{id}
// ---------------------------------------------------------------------
function EditMerchantModal({ merchant, onClose, onSaved }: { merchant: Merchant; onClose: () => void; onSaved: () => void }) {
  const [ownerName, setOwnerName] = useState(merchant.owner_name || "");
  const [storeName, setStoreName] = useState(merchant.store_name || "");
  const [email, setEmail] = useState(merchant.email || "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!storeName.trim()) { toast.error("Store name cannot be empty"); return; }
    setBusy(true);
    try {
      await adminFetch(`/api/admin/merchants/${merchant.id}`, {
        method: "PUT",
        body: JSON.stringify({ owner_name: ownerName.trim(), store_name: storeName.trim(), email: email.trim() }),
      });
      toast.success("Merchant updated");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell title="Edit merchant" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Merchant-submitted store name"><input value={merchant.store_name} disabled className={`${inputCls} bg-[#FDFBF7] text-[#94A3B8]`} /></Field>
        <Field label="Customer-facing store name">
          <input value={storeName} onChange={(e) => setStoreName(e.target.value)} data-testid="edit-merchant-store-name" className={inputCls} />
        </Field>
        <Field label="Owner / person name">
          <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} data-testid="edit-merchant-owner-name" className={inputCls} />
        </Field>
        <Field label="Email">
          <input value={email} onChange={(e) => setEmail(e.target.value)} data-testid="edit-merchant-email" className={inputCls} />
        </Field>
        <p className="text-[11px] text-[#94A3B8]">Phone number is the login identifier and isn&apos;t edited here.</p>
      </div>
      <div className="flex items-center justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-4 py-2 rounded-full text-xs font-semibold bg-white border border-[#E5E2DC]">Cancel</button>
        <button onClick={save} disabled={busy} data-testid="edit-merchant-save" className="px-4 py-2 rounded-full text-xs font-semibold bg-[#0A1F5C] text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------
// Edit Store modal — PUT /admin/stores/{id}
// ---------------------------------------------------------------------
function EditStoreModal({ store, onClose, onSaved }: { store: AdminStore; onClose: () => void; onSaved: () => void }) {
  const [tagline, setTagline] = useState(store.tagline || "");
  const [story, setStory] = useState(store.story || "");
  const [address, setAddress] = useState(store.address || "");
  const [areaLabel, setAreaLabel] = useState(store.area_label || store.locality || "");
  const [pincode, setPincode] = useState(store.pincode || "");
  const [opensAt, setOpensAt] = useState(store.opens_at || "10:00");
  const [closesAt, setClosesAt] = useState(store.closes_at || "18:00");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await adminFetch(`/api/admin/stores/${store.id}`, {
        method: "PUT",
        body: JSON.stringify({
          tagline: tagline.trim(), story: story.trim(), address: address.trim(),
          area_label: areaLabel.trim(), pincode: pincode.trim(),
          opens_at: opensAt, closes_at: closesAt,
        }),
      });
      toast.success("Store updated");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell title="Edit store" onClose={onClose} wide>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Tagline"><input value={tagline} onChange={(e) => setTagline(e.target.value)} data-testid="edit-store-tagline" className={inputCls} /></Field>
        <Field label="Area label"><input value={areaLabel} onChange={(e) => setAreaLabel(e.target.value)} data-testid="edit-store-area" className={inputCls} /></Field>
        <Field label="Pincode"><input value={pincode} onChange={(e) => setPincode(e.target.value)} data-testid="edit-store-pincode" className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Opens"><input type="time" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} data-testid="edit-store-opens" className={inputCls} /></Field>
          <Field label="Closes"><input type="time" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} data-testid="edit-store-closes" className={inputCls} /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Address"><input value={address} onChange={(e) => setAddress(e.target.value)} data-testid="edit-store-address" className={inputCls} /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description"><textarea value={story} onChange={(e) => setStory(e.target.value)} rows={3} data-testid="edit-store-story" className={inputCls} /></Field>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-4 py-2 rounded-full text-xs font-semibold bg-white border border-[#E5E2DC]">Cancel</button>
        <button onClick={save} disabled={busy} data-testid="edit-store-save" className="px-4 py-2 rounded-full text-xs font-semibold bg-[#0A1F5C] text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------
// Edit Product modal — PUT /admin/products/{id}, reusing the exact
// field-handling the merchant product editor's own backend uses.
// ---------------------------------------------------------------------
function EditProductModal({ product, onClose, onSaved }: { product: AdminProduct; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description || "");
  const [price, setPrice] = useState(String(product.price));
  const [mrp, setMrp] = useState(product.mrp ? String(product.mrp) : "");
  const [paused, setPaused] = useState(!!product.paused);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { toast.error("Name cannot be empty"); return; }
    const priceNum = Number(price);
    if (!priceNum || priceNum <= 0) { toast.error("Enter a valid price"); return; }
    setBusy(true);
    try {
      await adminFetch(`/api/admin/products/${product.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: name.trim(), description: description.trim(),
          price: priceNum, mrp: mrp ? Number(mrp) : null,
          paused,
        }),
      });
      toast.success("Product updated");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell title="Edit product" onClose={onClose} wide>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><Field label="Title"><input value={name} onChange={(e) => setName(e.target.value)} data-testid="edit-product-name" className={inputCls} /></Field></div>
        <Field label="Price (₹)"><input type="number" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="edit-product-price" className={inputCls} /></Field>
        <Field label="MRP (₹)"><input type="number" value={mrp} onChange={(e) => setMrp(e.target.value)} data-testid="edit-product-mrp" className={inputCls} /></Field>
        <div className="sm:col-span-2"><Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} data-testid="edit-product-description" className={inputCls} /></Field></div>
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#0A1F5C]">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} data-testid="edit-product-paused" className="h-3.5 w-3.5 accent-[#0A1F5C]" />
          Paused (hidden from customers)
        </label>
      </div>
      <p className="text-[11px] text-[#94A3B8] mt-3">Images, category and stock-by-size are best edited from the merchant&apos;s own product form (richer image/variant tooling); this covers the quick content fixes admin needs most.</p>
      <div className="flex items-center justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-4 py-2 rounded-full text-xs font-semibold bg-white border border-[#E5E2DC]">Cancel</button>
        <button onClick={save} disabled={busy} data-testid="edit-product-save" className="px-4 py-2 rounded-full text-xs font-semibold bg-[#0A1F5C] text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
      </div>
    </ModalShell>
  );
}
