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
  Store as StoreIcon, Package, ClipboardList, Landmark, AlertTriangle,
  ImagePlus, X, Star,
} from "lucide-react";
import { adminFetch } from "@/lib/legacy-admin";
// Merchant/Admin parity audit — reuses the EXACT SAME upload/delete helpers
// and Bhilai area data the merchant's own storefront page (app/merchant/
// storefront/page.tsx) uses. No second Cloudinary upload implementation,
// no duplicated area list.
import { uploadImage, deleteUploadedImage } from "@/lib/uploads";
import { BHILAI_AREAS } from "@/data/bhilai-areas";
// Admin Product Creation feature — genuinely new endpoints, so per
// lib/legacy-admin.ts's own explicit "DO NOT extend this file with new
// endpoints — new code must use api-client.ts" rule, these go through the
// typed apiClient/adminApi rather than adminFetch (unlike this page's
// existing pre-feature calls, which are left untouched).
import { apiClient } from "@/lib/api-client";
import { adminApi } from "@/lib/api/admin";
import { ProductForm, type ProductFormCategory, type ProductFormBody } from "@/components/products/ProductForm";
import { StorefrontForm, type StorefrontFormBody } from "@/components/storefront/StorefrontForm";
import { AdminBulkUploadModal } from "@/components/admin/AdminBulkUploadModal";

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
  gender?: string;
  brand_id?: string | null;
  image?: string;
  images?: string[];
  image_public_id?: string;
  image_public_ids?: string[];
  paused?: boolean;
  sizes?: string[];
  stock?: Record<string, number>;
  total_stock?: number;
  size_type?: string;
  return_eligible?: boolean;
  return_window_hours?: number | null;
  try_at_doorstep?: boolean;
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
  banners?: string[];
  banner_public_ids?: string[];
  logo?: string;
  logo_public_id?: string;
  area?: string;
  area_slug?: string;
  area_label?: string;
  locality?: string;
  pincode?: string;
  address?: string;
  timing?: string;
  opens_at?: string;
  closes_at?: string;
  weekly_off?: string[];
  specialties?: string[];
  upi_qr_url?: string;
  lat?: number;
  lng?: number;
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

type Section = "overview" | "storefront" | "products" | "kyc" | "bank";

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
  const [settingUpStorefront, setSettingUpStorefront] = useState(false);

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

  // Admin merchant UI reorganization — pending-count badges give a
  // glanceable "does this need my attention" signal on the tab bar itself
  // (Products already had one; KYC/Bank previously had none, so a
  // submitted KYC or a pending bank change could sit unnoticed until an
  // admin happened to click in).
  const pendingBankChanges = changeRequests.filter((cr) => cr.status === "submitted").length;
  const SECTIONS: Array<{ id: Section; label: string; icon: React.ComponentType<{ size?: number }>; badge?: number }> = [
    { id: "overview", label: "Overview", icon: ClipboardList },
    { id: "storefront", label: "Storefront", icon: StoreIcon },
    { id: "products", label: "Products", icon: Package, badge: store?.products?.length || undefined },
    { id: "kyc", label: "KYC & Verification", icon: ShieldCheck, badge: merchant.kyc_status === "submitted" ? 1 : undefined },
    { id: "bank", label: "Bank & Payout", icon: Landmark, badge: pendingBankChanges || undefined },
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
          // "products" keeps its plain grey count (informational, not
          // action-needed); kyc/bank badges are amber — they mean
          // "something is waiting on you".
          const isActionBadge = s.id === "kyc" || s.id === "bank";
          return (
            <button key={s.id} onClick={() => setSection(s.id)} data-testid={`merchant-section-${s.id}`}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 ${active ? "border-[#E68910] text-[#0A1F5C]" : "border-transparent text-[#595959] hover:text-[#0A1F5C]"}`}>
              <Icon size={13} /> {s.label}
              {!!s.badge && (
                <span
                  data-testid={`merchant-section-badge-${s.id}`}
                  className={isActionBadge
                    ? "text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#E68910] text-white"
                    : "text-[10px] text-[#94A3B8]"}
                >
                  {isActionBadge ? s.badge : `(${s.badge})`}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {section === "overview" && <OverviewSection merchant={merchant} store={store} onReload={load} />}
      {section === "storefront" && <StorefrontSection store={store} onEdit={() => setEditingStore(true)} onSetup={() => setSettingUpStorefront(true)} onReload={load} />}
      {section === "products" && <ProductsSection store={store} merchantId={merchant.id} onReload={load} />}
      {section === "kyc" && <KycSection merchant={merchant} onReload={load} />}
      {section === "bank" && <BankPayoutSection merchant={merchant} changeRequests={changeRequests} onReload={load} />}

      {editingMerchant && (
        <EditMerchantModal merchant={merchant} onClose={() => setEditingMerchant(false)} onSaved={() => { setEditingMerchant(false); void load(); }} />
      )}
      {editingStore && store && (
        <EditStoreModal store={store} onClose={() => setEditingStore(false)} onSaved={() => { setEditingStore(false); void load(); }} />
      )}
      {settingUpStorefront && !store && (
        <SetupStorefrontModal merchant={merchant} onClose={() => setSettingUpStorefront(false)} onCreated={() => { setSettingUpStorefront(false); void load(); }} />
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
// Storefront section
// ---------------------------------------------------------------------
function StorefrontSection({ store, onEdit, onSetup, onReload }: { store: AdminStore | null; onEdit: () => void; onSetup: () => void; onReload: () => void }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!store) {
    return (
      <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center" data-testid="storefront-section-empty">
        <div className="text-sm font-semibold text-[#0A1F5C] mb-1">Storefront not set up</div>
        <p className="text-sm text-[#595959] mb-5">This merchant hasn&apos;t completed their storefront setup yet.</p>
        <button onClick={onSetup} data-testid="setup-storefront-button"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#E68910] text-white text-sm font-semibold hover:opacity-90">
          Setup Storefront
        </button>
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
    <div className="space-y-4" data-testid="storefront-section">
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
          <Row label="Cover images" value={String((store.banners || (store.banner ? [store.banner] : [])).length)} />
          <Row label="UPI QR" value={store.upi_qr_url ? "Set ✓" : "Not set"} />
          <Row label="Location pinned" value={store.lat != null && store.lng != null ? `${store.lat.toFixed(5)}, ${store.lng.toFixed(5)}` : "—"} />
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
function ProductsSection({ store, merchantId, onReload }: { store: AdminStore | null; merchantId: string; onReload: () => void }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "out_of_stock">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  // Admin Product Creation feature — "+ Add Product" reuses the exact same
  // shared <ProductForm> the merchant's own product page uses (see
  // components/products/ProductForm.tsx); "Bulk Upload" reuses the same
  // xlsx/csv parsing pipeline via the new admin bulk endpoints.
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [cats, setCats] = useState<ProductFormCategory[]>([]);
  useEffect(() => {
    apiClient.get<ProductFormCategory[]>("/api/categories").then((r) => setCats(r.data)).catch(() => {});
  }, []);

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
          <button onClick={() => setShowBulkUpload(true)} data-testid="admin-bulk-upload-btn"
            className="px-3 py-1.5 rounded-full border border-[#E5E2DC] text-xs font-semibold text-[#1A2B4C] hover:border-[#1A2B4C]">
            Bulk upload
          </button>
          <button onClick={() => setShowAddProduct(true)} data-testid="admin-add-product-btn"
            className="px-3 py-1.5 rounded-full bg-[#E68910] text-white text-xs font-semibold hover:bg-[#C9770E]">
            + Add Product
          </button>
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
        <ProductForm
          mode="edit"
          cats={cats}
          initialProduct={editing}
          callerScope="admin"
          onSubmit={async (body: ProductFormBody) => {
            await adminFetch(`/api/admin/products/${editing.id}`, { method: "PUT", body: JSON.stringify(body) });
            toast.success("Product updated");
            onReload();
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {showAddProduct && (
        <ProductForm
          mode="create"
          cats={cats}
          callerScope="admin"
          onSubmit={async (body: ProductFormBody) => {
            await adminApi.createProduct(merchantId, { product: body });
            toast.success("Product created");
            onReload();
          }}
          onClose={() => setShowAddProduct(false)}
        />
      )}

      {showBulkUpload && (
        <AdminBulkUploadModal
          merchantId={merchantId}
          onClose={() => setShowBulkUpload(false)}
          onImported={onReload}
        />
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
          <Row label="Submitted" value={fmtDate(merchant.kyc_submitted_at)} />
        </div>

        {/* Bank fields/documents live in the dedicated "Bank & Payout" tab
            now — see BankPayoutSection. Only identity/verification
            documents (PAN, GST) stay here. */}
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => openDoc("pan_doc")} data-testid="kyc-doc-pan" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E5E2DC] hover:border-[#0A1F5C]"><FileText size={11} /> PAN <ExternalLink size={10} /></button>
          <button onClick={() => openDoc("gst_doc")} data-testid="kyc-doc-gst" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E5E2DC] hover:border-[#0A1F5C]"><FileText size={11} /> GST</button>
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
// Bank & Payout section — merchant/admin capability-parity audit. Two
// things that used to live in different, poorly-labeled tabs, now
// together under the name an admin would actually look for:
//   1. The merchant's currently COMMITTED bank details (previously shown,
//      confusingly, as plain Rows inside the KYC tab) + the cancelled
//      cheque document link (same signed-URL mechanism KYC's own PAN/GST
//      doc buttons already use — no new endpoint).
//   2. Pending bank (and, generically, any other) change requests and
//      their approve/reject actions — previously the "Activity" tab,
//      whose name gave no hint this is where bank-detail approvals
//      happen. Reuses the exact same POST /admin/change-requests/{id}/
//      approve|reject endpoints unchanged; nothing about the review
//      workflow itself changed, only where it's surfaced.
// Committed bank fields are intentionally NOT editable here — same
// "reviewed via approve/reject, not free-text-edited" rule
// admin_update_merchant's own docstring documents for KYC fields.
// ---------------------------------------------------------------------
function BankPayoutSection({ merchant, changeRequests, onReload }: { merchant: Merchant; changeRequests: ChangeRequest[]; onReload: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const openChequeDoc = async () => {
    try {
      const r = await adminFetch<{ url: string }>(`/api/admin/kyc/${merchant.id}/signed-url?doc=cancelled_cheque`);
      window.open(r.url, "_blank", "noopener,noreferrer");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  const approve = async (cr: ChangeRequest) => {
    setBusyId(cr.id);
    try {
      await adminFetch(`/api/admin/change-requests/${cr.id}/approve`, { method: "POST" });
      toast.success(`${cr.change_type} change approved`);
      onReload();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusyId(null); }
  };
  const confirmReject = async (cr: ChangeRequest) => {
    setBusyId(cr.id);
    try {
      await adminFetch(`/api/admin/change-requests/${cr.id}/reject`, {
        method: "POST", body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      toast.success(`${cr.change_type} change rejected`);
      setRejectingId(null); setReason("");
      onReload();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusyId(null); }
  };

  return (
    <div className="space-y-4" data-testid="bank-payout-section">
      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#595959] mb-3">Committed bank details</h3>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mb-3">
          <Row label="Account holder" value={merchant.account_holder_name || "—"} />
          <Row label="Account number" value={merchant.bank_account_number || "—"} mono />
          <Row label="IFSC" value={merchant.bank_ifsc || "—"} mono />
        </div>
        <button onClick={openChequeDoc} data-testid="bank-doc-cheque" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E5E2DC] hover:border-[#0A1F5C]">
          <FileText size={11} /> Cancelled cheque <ExternalLink size={10} />
        </button>
        <p className="text-[11px] text-[#94A3B8] mt-3">
          These are only changed via the approve/reject flow below — never free-text-edited here.
        </p>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#595959] mb-3">Change requests</h3>
        {changeRequests.length === 0 ? (
          <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center text-sm text-[#595959]" data-testid="bank-requests-empty">No bank change requests from this merchant.</div>
        ) : (
          <div className="space-y-2" data-testid="bank-requests-list">
            {changeRequests.map((cr) => (
        <div key={cr.id} className="bg-white border border-[#E5E2DC] rounded-2xl p-3.5" data-testid={`bank-request-row-${cr.id}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#0A1F5C] capitalize">{cr.change_type} change request</div>
              <div className="text-xs text-[#595959] mt-0.5">{fmtDate(cr.created_at)}</div>
            </div>
            <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full shrink-0 ${
              cr.status === "approved" ? "bg-green-100 text-green-700" : cr.status === "rejected" ? "bg-red-100 text-red-600" : "bg-[#E68910]/15 text-[#E68910]"
            }`}>{cr.status}</span>
          </div>
          {cr.new_values && (
            <div className="mt-2 pt-2 border-t border-[#F0EFED] grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {Object.entries(cr.new_values).map(([k, v]) => (
                <div key={k}><span className="text-[#94A3B8]">{k}:</span> <span className="font-mono text-[#1A2B4C]">{String(v)}</span></div>
              ))}
            </div>
          )}
          {cr.status === "submitted" && (
            <div className="mt-3 flex items-center gap-2">
              <button onClick={() => approve(cr)} disabled={busyId === cr.id} data-testid={`bank-request-approve-${cr.id}`}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#4F7363] text-white disabled:opacity-50">Approve</button>
              <button onClick={() => setRejectingId(cr.id)} disabled={busyId === cr.id} data-testid={`bank-request-reject-${cr.id}`}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-red-500 text-white disabled:opacity-50">Reject</button>
            </div>
          )}
          {rejectingId === cr.id && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl space-y-2">
              <label className="block text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">Reason (optional)</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} data-testid={`bank-request-reject-reason-${cr.id}`}
                className="w-full px-3 py-2 rounded-lg border border-[#E5E2DC] text-sm bg-white focus:border-[#0A1F5C] outline-none" />
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => { setRejectingId(null); setReason(""); }} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white border border-[#E5E2DC] text-[#595959]">Cancel</button>
                <button onClick={() => confirmReject(cr)} disabled={busyId === cr.id} data-testid={`bank-request-reject-confirm-${cr.id}`}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold bg-red-500 text-white disabled:opacity-40">{busyId === cr.id ? "Saving…" : "Confirm reject"}</button>
              </div>
            </div>
          )}
        </div>
            ))}
          </div>
        )}
      </div>
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
const WEEKLY_OFF_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Merchant/Admin parity audit — every field here is one the merchant's own
// storefront form (app/merchant/storefront/page.tsx) already lets them
// set. Image upload/delete reuses uploadImage()/deleteUploadedImage()
// (same /merchant/upload-image endpoint, already admin-accessible) with
// the SAME deferred-delete pattern the merchant page uses: removing a
// banner only queues its public_id, the actual Cloudinary delete fires
// only after the save actually succeeds — never eagerly, never silently
// via a stale-array diff (see the image-deletion-safety hardening this
// endpoint's PUT handler already relies on for products).
function EditStoreModal({ store, onClose, onSaved }: { store: AdminStore; onClose: () => void; onSaved: () => void }) {
  const [tagline, setTagline] = useState(store.tagline || "");
  const [story, setStory] = useState(store.story || "");
  const [address, setAddress] = useState(store.address || "");
  const [areaSlug, setAreaSlug] = useState(store.area_slug || "");
  const [areaLabel, setAreaLabel] = useState(store.area_label || store.locality || "");
  const [pincode, setPincode] = useState(store.pincode || "");
  const [opensAt, setOpensAt] = useState(store.opens_at || "10:00");
  const [closesAt, setClosesAt] = useState(store.closes_at || "18:00");
  const [weeklyOff, setWeeklyOff] = useState<string[]>(store.weekly_off || []);
  const [lat, setLat] = useState(store.lat != null ? String(store.lat) : "");
  const [lng, setLng] = useState(store.lng != null ? String(store.lng) : "");
  const [banners, setBanners] = useState<string[]>(store.banners || (store.banner ? [store.banner] : []));
  const [bannerPublicIds, setBannerPublicIds] = useState<string[]>(store.banner_public_ids || []);
  const [upiQrUrl, setUpiQrUrl] = useState(store.upi_qr_url || "");
  const [pendingDeletePublicIds, setPendingDeletePublicIds] = useState<string[]>([]);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [busy, setBusy] = useState(false);

  const onPickArea = (slug: string) => {
    setAreaSlug(slug);
    const a = BHILAI_AREAS.find((x) => x.slug === slug);
    if (a) {
      setAreaLabel(a.label);
      setPincode(a.pincode);
      if (!lat) setLat(a.lat.toFixed(6));
      if (!lng) setLng(a.lng.toFixed(6));
    }
  };

  const pickBanner = async (file: File | null) => {
    if (!file) return;
    if (banners.length >= 5) return toast.error("Up to 5 banners");
    setUploadingBanner(true);
    try {
      const { image_url, public_id } = await uploadImage(file, "store_banner", "admin");
      setBanners((b) => [...b, image_url]);
      setBannerPublicIds((p) => [...p, public_id]);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setUploadingBanner(false); }
  };
  const removeBanner = (idx: number) => {
    const pid = bannerPublicIds[idx];
    setBanners((b) => b.filter((_, i) => i !== idx));
    setBannerPublicIds((p) => p.filter((_, i) => i !== idx));
    if (pid) setPendingDeletePublicIds((ids) => [...ids, pid]);
  };
  const pickQr = async (file: File | null) => {
    if (!file) return;
    setUploadingQr(true);
    try {
      const { image_url } = await uploadImage(file, "store_banner", "admin");
      setUpiQrUrl(image_url);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setUploadingQr(false); }
  };

  const save = async () => {
    if ((lat && !lng) || (!lat && lng)) return toast.error("Set both latitude and longitude, or neither");
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        tagline: tagline.trim(), story: story.trim(), address: address.trim(),
        area_slug: areaSlug, area_label: areaLabel.trim(), pincode: pincode.trim(),
        opens_at: opensAt, closes_at: closesAt, weekly_off: weeklyOff,
        banners, banner_public_ids: bannerPublicIds,
        banner: banners[0] || "", logo: banners[0] || "",
        upi_qr_url: upiQrUrl,
      };
      if (lat && lng) { body.lat = Number(lat); body.lng = Number(lng); }
      await adminFetch(`/api/admin/stores/${store.id}`, { method: "PUT", body: JSON.stringify(body) });
      // Only now — once the save is confirmed persisted — delete any
      // banners removed during this session. Same deferred pattern as the
      // merchant's own storefront page: removing-then-discarding (closing
      // this modal without saving) never touches Cloudinary.
      for (const pid of pendingDeletePublicIds) void deleteUploadedImage(pid, "admin");
      toast.success("Store updated");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell title="Edit store" onClose={onClose} wide>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Tagline"><input value={tagline} onChange={(e) => setTagline(e.target.value)} data-testid="edit-store-tagline" className={inputCls} /></Field>
        <Field label="Area">
          <select value={areaSlug} onChange={(e) => onPickArea(e.target.value)} data-testid="edit-store-area-slug" className={inputCls}>
            <option value="">Select area</option>
            {BHILAI_AREAS.map((a) => <option key={a.slug} value={a.slug}>{a.label} — {a.pincode}</option>)}
          </select>
        </Field>
        <Field label="Area label (display)"><input value={areaLabel} onChange={(e) => setAreaLabel(e.target.value)} data-testid="edit-store-area" className={inputCls} /></Field>
        <Field label="Pincode"><input value={pincode} onChange={(e) => setPincode(e.target.value)} data-testid="edit-store-pincode" className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Opens"><input type="time" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} data-testid="edit-store-opens" className={inputCls} /></Field>
          <Field label="Closes"><input type="time" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} data-testid="edit-store-closes" className={inputCls} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Latitude"><input type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} data-testid="edit-store-lat" className={inputCls} /></Field>
          <Field label="Longitude"><input type="number" step="any" value={lng} onChange={(e) => setLng(e.target.value)} data-testid="edit-store-lng" className={inputCls} /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Address"><input value={address} onChange={(e) => setAddress(e.target.value)} data-testid="edit-store-address" className={inputCls} /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description"><textarea value={story} onChange={(e) => setStory(e.target.value)} rows={3} data-testid="edit-store-story" className={inputCls} /></Field>
        </div>
        <div className="sm:col-span-2">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">Weekly off days</div>
          <div className="flex flex-wrap gap-2">
            {WEEKLY_OFF_DAYS.map((day) => {
              const selected = weeklyOff.includes(day);
              return (
                <button key={day} type="button" data-testid={`edit-store-weekly-off-${day}`}
                  onClick={() => setWeeklyOff((w) => selected ? w.filter((d) => d !== day) : [...w, day])}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${selected ? "bg-[#0A1F5C] text-white border-[#0A1F5C]" : "bg-white text-[#595959] border-[#E5E2DC]"}`}>
                  {day}
                </button>
              );
            })}
          </div>
        </div>
        <div className="sm:col-span-2">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">Cover images (up to 5)</div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {banners.map((b, i) => (
              <div key={i} className="relative aspect-[4/3] rounded-xl overflow-hidden bg-[#FDFBF7] border border-[#E5E2DC]" data-testid={`edit-store-banner-${i}`}>
                <img src={b} alt={`banner ${i + 1}`} className="w-full h-full object-cover" />
                <button type="button" onClick={() => removeBanner(i)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/95 shadow flex items-center justify-center hover:bg-red-100">
                  <X size={11} className="text-red-500" />
                </button>
                {i === 0 && <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-full bg-[#0A1F5C] text-white text-[8px] font-bold flex items-center gap-0.5"><Star size={7} /> COVER</div>}
              </div>
            ))}
            {banners.length < 5 && (
              <label className="aspect-[4/3] rounded-xl border-2 border-dashed border-[#E5E2DC] hover:border-[#0A1F5C] flex flex-col items-center justify-center gap-1 cursor-pointer text-[#595959] text-[10px]">
                {uploadingBanner ? <Loader2 size={16} className="animate-spin" /> : <><ImagePlus size={16} /><span>Upload</span></>}
                <input data-testid="edit-store-banner-upload" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploadingBanner}
                  onChange={(e) => { void pickBanner(e.target.files?.[0] ?? null); e.target.value = ""; }} />
              </label>
            )}
          </div>
        </div>
        <div className="sm:col-span-2">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">UPI QR code</div>
          <div className="flex items-center gap-3">
            {upiQrUrl && (
              <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-[#E5E2DC]">
                <img src={upiQrUrl} alt="UPI QR" className="w-full h-full object-cover" />
                <button type="button" onClick={() => setUpiQrUrl("")} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center"><X size={10} /></button>
              </div>
            )}
            {!upiQrUrl && (
              <label className="w-16 h-16 rounded-lg border-2 border-dashed border-[#E5E2DC] hover:border-[#0A1F5C] flex items-center justify-center cursor-pointer text-[#595959]">
                {uploadingQr ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                <input data-testid="edit-store-qr-upload" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploadingQr}
                  onChange={(e) => { void pickQr(e.target.files?.[0] ?? null); e.target.value = ""; }} />
              </label>
            )}
          </div>
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
// Setup Storefront modal — POST /admin/merchants/{id}/storefront.
// Admin capability gap fix: previously a merchant with no storefront had
// no admin-side way to get one set up (only EditStoreModal above, which
// requires a store to already exist). Reuses the exact SAME
// <StorefrontForm> component the merchant's own onboarding page uses —
// same fields, same validation — in "create" mode; the backend endpoint
// reuses the same canonical `_create_or_setup_storefront_for_merchant`
// server.py helper POST /merchant/storefront calls, so an admin-created
// storefront behaves identically to a merchant-created one afterward
// (including working immediately with admin product creation/bulk
// import). Never rendered when a store already exists — that stays on
// EditStoreModal.
// ---------------------------------------------------------------------
function SetupStorefrontModal({ merchant, onClose, onCreated }: { merchant: Merchant; onClose: () => void; onCreated: () => void }) {
  const handleSubmit = async (body: StorefrontFormBody) => {
    await adminApi.createStorefront(merchant.id, body);
    toast.success("Storefront created");
    onCreated();
  };

  return (
    <ModalShell title={`Set up storefront — ${merchant.store_name}`} onClose={onClose} wide>
      <StorefrontForm
        mode="create"
        storeName={merchant.store_name}
        businessAddress={merchant.business_address || ""}
        initialData={null}
        onSubmit={handleSubmit}
        onClose={onClose}
        callerScope="admin"
        submitLabel="Create storefront"
      />
    </ModalShell>
  );
}

