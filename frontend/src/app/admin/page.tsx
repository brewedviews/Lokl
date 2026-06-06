"use client";

/**
 * Admin dashboard — MVP capabilities for production launch.
 *
 * Migrated from frontend-legacy/src/pages/AdminPanel.jsx using the
 * legacy-admin.ts compat shim (raw fetch w/ admin JWT auth). Per Session A
 * constraint this is a functional port, not a TypeScript rewrite — large
 * tabs like Returns/Complaints/Site CMS/Analytics export are deferred to
 * post-launch.
 *
 * Capabilities:
 *  1. Platform stats (merchants, products, orders, revenue today)
 *  2. Merchant approvals — list submitted/on_hold, approve/reject/hold,
 *     view KYC docs via signed Cloudinary URLs.
 *  3. Store management — list, pause/unpause.
 *  4. Product moderation — list, pause/unpause/delete.
 *  5. Order monitoring — list with status filter.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Shield, Users, Store as StoreIcon, Package, ShoppingBag, BarChart3, LogOut, FileText, ExternalLink, RefreshCw } from "lucide-react";
import { adminFetch } from "@/lib/legacy-admin";
import { useAdminAuthStore } from "@/stores";

type Tab = "stats" | "merchants" | "stores" | "products" | "orders";

interface Stats {
  submitted_kyc: number;
  approved: number;
  rejected: number;
  stores_live: number;
  stores_paused: number;
  pending_changes: number;
}
interface Merchant {
  id: string; email: string; phone?: string; store_name: string; owner_name?: string;
  kyc_status: string; kyc_submitted_at?: string; approved_at?: string;
  hold_comment?: string; pan_number?: string; business_name?: string;
  business_category?: string;
}
interface AdminStoreItem {
  id: string; name: string; merchant_id: string; published?: boolean; paused?: boolean;
  product_count?: number; locality?: string; merchant?: { phone?: string; email?: string };
}
interface AdminProduct {
  id: string; name: string; price: number; store_id: string; store_name?: string;
  paused?: boolean; image?: string;
}
interface AdminOrder {
  id: string; total: number; status: string; created_at: string;
  store_names?: string[]; customer?: { name?: string; phone?: string };
}

const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "stats", label: "Overview", icon: BarChart3 },
  { id: "merchants", label: "Merchants", icon: Users },
  { id: "stores", label: "Stores", icon: StoreIcon },
  { id: "products", label: "Products", icon: Package },
  { id: "orders", label: "Orders", icon: ShoppingBag },
];

export default function AdminDashboardPage() {
  const clearAuth = useAdminAuthStore((s) => s.clearAuth);
  const [tab, setTab] = useState<Tab>("stats");

  const logout = () => { clearAuth(); toast.success("Signed out"); };

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <header className="bg-[#0A1F5C] text-white px-6 py-4 flex items-center justify-between" data-testid="admin-header">
        <div className="flex items-center gap-3">
          <Shield size={22} className="text-[#E68910]" />
          <h1 className="font-display text-xl font-bold">Lokl Admin</h1>
        </div>
        <button onClick={logout} data-testid="admin-logout" className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/80 hover:text-white">
          <LogOut size={14} /> Sign out
        </button>
      </header>

      <nav className="bg-white border-b border-[#E5E2DC] px-4 sm:px-6 overflow-x-auto" data-testid="admin-tabs">
        <div className="flex gap-1 max-w-7xl mx-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} data-testid={`admin-tab-${t.id}`}
                className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 ${active ? "border-[#E68910] text-[#0A1F5C]" : "border-transparent text-[#595959] hover:text-[#0A1F5C]"}`}>
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {tab === "stats" && <StatsTab />}
        {tab === "merchants" && <MerchantsTab />}
        {tab === "stores" && <StoresTab />}
        {tab === "products" && <ProductsTab />}
        {tab === "orders" && <OrdersTab />}
      </main>
    </div>
  );
}

// ---------------- Stats ----------------
function StatsTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);

  const load = async () => {
    try {
      const [s, o, p] = await Promise.all([
        adminFetch<Stats>("/api/admin/stats"),
        adminFetch<AdminOrder[]>("/api/admin/orders?limit=1000"),
        adminFetch<AdminProduct[]>("/api/products?limit=10000"),
      ]);
      setStats(s); setOrders(o); setProducts(p);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void load(); }, []);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ordersToday = orders.filter((o) => new Date(o.created_at) >= today);
  const revenueToday = ordersToday.filter((o) => o.status === "delivered").reduce((s, o) => s + Number(o.total || 0), 0);

  return (
    <div data-testid="stats-panel">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Platform overview</h2>
        <button onClick={() => void load()} data-testid="stats-refresh" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0A1F5C] hover:underline"><RefreshCw size={12} /> Refresh</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Approved merchants" value={stats?.approved ?? "—"} />
        <Stat label="KYC pending" value={stats?.submitted_kyc ?? "—"} />
        <Stat label="Stores live" value={stats?.stores_live ?? "—"} />
        <Stat label="Stores paused" value={stats?.stores_paused ?? "—"} />
        <Stat label="Total products" value={products.length} />
        <Stat label="Total orders" value={orders.length} />
        <Stat label="Orders today" value={ordersToday.length} />
        <Stat label="Revenue today" value={`₹${Math.round(revenueToday).toLocaleString()}`} />
      </div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
      <div className="text-[10px] uppercase tracking-widest text-[#595959]">{label}</div>
      <div className="font-display text-2xl font-bold text-[#0A1F5C] mt-1">{value}</div>
    </div>
  );
}

// ---------------- Merchants ----------------
function MerchantsTab() {
  const [items, setItems] = useState<Merchant[]>([]);
  const [filter, setFilter] = useState<string>("submitted");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const url = filter === "all" ? "/api/admin/merchants" : `/api/admin/merchants?status=${filter}`;
      setItems(await adminFetch<Merchant[]>(url));
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void load(); }, [filter]);

  const approve = async (mid: string) => {
    setBusy(mid);
    try {
      await adminFetch<{ ok: boolean }>(`/api/admin/merchants/${mid}/approve`, { method: "POST" });
      toast.success("Merchant approved");
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const reject = async (mid: string) => {
    const reason = window.prompt("Rejection reason:");
    if (!reason) return;
    setBusy(mid);
    try {
      await adminFetch<{ ok: boolean }>(`/api/admin/merchants/${mid}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      toast.success("Merchant rejected");
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const hold = async (mid: string) => {
    const reason = window.prompt("Hold comment (what to fix):");
    if (!reason) return;
    setBusy(mid);
    try {
      await adminFetch<{ ok: boolean }>(`/api/admin/merchants/${mid}/hold`, { method: "POST", body: JSON.stringify({ reason }) });
      toast.success("Merchant put on hold");
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const openKycDoc = async (mid: string, doc: "pan_doc" | "gst_doc" | "cancelled_cheque") => {
    try {
      const r = await adminFetch<{ url: string }>(`/api/admin/kyc/${mid}/signed-url?doc=${doc}`);
      window.open(r.url, "_blank", "noopener,noreferrer");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div data-testid="merchants-panel">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Merchants</h2>
        <select data-testid="merchant-filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="px-3 py-2 rounded-full border border-[#E5E2DC] text-sm">
          <option value="submitted">KYC submitted</option>
          <option value="on_hold">On hold</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </div>
      {items.length === 0 ? (
        <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center text-sm text-[#595959]">
          No merchants in this state.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((m) => (
            <div key={m.id} data-testid={`merchant-row-${m.id}`} className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-[#0A1F5C]">{m.store_name} <span className="text-xs text-[#595959]">· {m.owner_name || "—"}</span></div>
                  <div className="text-xs text-[#595959] mt-0.5">{m.email} · {m.phone || "no phone"}</div>
                  <div className="text-xs text-[#595959] mt-0.5">PAN: {m.pan_number || "—"} · Category: {m.business_category || "—"}</div>
                  <div className="text-[10px] uppercase tracking-widest text-[#E68910] mt-2">{m.kyc_status}</div>
                  {m.hold_comment && <div className="text-xs text-[#E68910] mt-1">Hold: {m.hold_comment}</div>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => openKycDoc(m.id, "pan_doc")} data-testid={`kyc-pan-${m.id}`} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E5E2DC] hover:border-[#0A1F5C]"><FileText size={11} /> PAN <ExternalLink size={10} /></button>
                  <button onClick={() => openKycDoc(m.id, "gst_doc")} data-testid={`kyc-gst-${m.id}`} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E5E2DC] hover:border-[#0A1F5C]"><FileText size={11} /> GST</button>
                  <button onClick={() => openKycDoc(m.id, "cancelled_cheque")} data-testid={`kyc-cheque-${m.id}`} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E5E2DC] hover:border-[#0A1F5C]"><FileText size={11} /> Cheque</button>
                  {m.kyc_status === "submitted" && <>
                    <button onClick={() => approve(m.id)} disabled={busy === m.id} data-testid={`approve-${m.id}`} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#4F7363] text-white disabled:opacity-50">Approve</button>
                    <button onClick={() => hold(m.id)} disabled={busy === m.id} data-testid={`hold-${m.id}`} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#E68910] text-white disabled:opacity-50">Hold</button>
                    <button onClick={() => reject(m.id)} disabled={busy === m.id} data-testid={`reject-${m.id}`} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-red-500 text-white disabled:opacity-50">Reject</button>
                  </>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Stores ----------------
function StoresTab() {
  const [items, setItems] = useState<AdminStoreItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = async () => {
    try { setItems(await adminFetch<AdminStoreItem[]>("/api/admin/stores")); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void load(); }, []);

  const toggle = async (s: AdminStoreItem) => {
    setBusy(s.id);
    try {
      const action = s.paused ? "unpause" : "pause";
      await adminFetch<{ ok: boolean }>(`/api/admin/stores/${s.id}/${action}`, { method: "POST" });
      toast.success(`Store ${action}d`);
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const filtered = items.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div data-testid="stores-panel">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Stores ({filtered.length})</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" data-testid="stores-search" className="px-3 py-2 rounded-full border border-[#E5E2DC] text-sm" />
      </div>
      <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
            <tr><th className="px-4 py-3">Store</th><th className="px-4 py-3">Locality</th><th className="px-4 py-3 text-right">Products</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="border-t border-[#E5E2DC]" data-testid={`store-row-${s.id}`}>
                <td className="px-4 py-3 font-semibold text-[#0A1F5C]">{s.name}<div className="text-[11px] text-[#595959] font-normal">{s.merchant?.email}</div></td>
                <td className="px-4 py-3 text-[#595959]">{s.locality || "—"}</td>
                <td className="px-4 py-3 text-right">{s.product_count ?? 0}</td>
                <td className="px-4 py-3"><span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${s.paused ? "bg-red-100 text-red-500" : s.published ? "bg-[#4F7363]/15 text-[#4F7363]" : "bg-zinc-100 text-zinc-700"}`}>{s.paused ? "paused" : s.published ? "live" : "draft"}</span></td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => toggle(s)} disabled={busy === s.id} data-testid={`store-toggle-${s.id}`} className="text-xs font-semibold text-[#E68910] hover:underline disabled:opacity-50">{s.paused ? "Unpause" : "Pause"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- Products ----------------
function ProductsTab() {
  const [items, setItems] = useState<AdminProduct[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = async () => {
    try { setItems(await adminFetch<AdminProduct[]>("/api/products?limit=2000")); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void load(); }, []);

  const toggle = async (p: AdminProduct) => {
    setBusy(p.id);
    try {
      const action = p.paused ? "unpause" : "pause";
      await adminFetch<{ ok: boolean }>(`/api/admin/products/${p.id}/${action}`, { method: "POST" });
      toast.success(`Product ${action}d`);
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const remove = async (p: AdminProduct) => {
    if (!window.confirm(`Delete product "${p.name}"? This cannot be undone.`)) return;
    setBusy(p.id);
    try {
      await adminFetch<{ ok: boolean }>(`/api/admin/products/${p.id}`, { method: "DELETE" });
      toast.success("Product deleted");
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const filtered = items.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.store_name || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <div data-testid="admin-products-panel">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Products ({filtered.length})</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by product/store…" data-testid="admin-products-search" className="px-3 py-2 rounded-full border border-[#E5E2DC] text-sm w-64" />
      </div>
      <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
            <tr><th className="px-4 py-3">Product</th><th className="px-4 py-3">Store</th><th className="px-4 py-3 text-right">Price</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((p) => (
              <tr key={p.id} className="border-t border-[#E5E2DC]" data-testid={`admin-prod-row-${p.id}`}>
                <td className="px-4 py-3 font-semibold text-[#0A1F5C]">{p.name}</td>
                <td className="px-4 py-3 text-[#595959]">{p.store_name || "—"}</td>
                <td className="px-4 py-3 text-right">₹{Number(p.price).toLocaleString()}</td>
                <td className="px-4 py-3"><span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${p.paused ? "bg-red-100 text-red-500" : "bg-[#4F7363]/15 text-[#4F7363]"}`}>{p.paused ? "paused" : "active"}</span></td>
                <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                  <button onClick={() => toggle(p)} disabled={busy === p.id} data-testid={`admin-prod-toggle-${p.id}`} className="text-xs font-semibold text-[#E68910] hover:underline disabled:opacity-50">{p.paused ? "Unpause" : "Pause"}</button>
                  <button onClick={() => remove(p)} disabled={busy === p.id} data-testid={`admin-prod-delete-${p.id}`} className="text-xs font-semibold text-red-500 hover:underline disabled:opacity-50">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 && <div className="text-center text-xs text-[#595959] py-2">Showing first 200 of {filtered.length} — refine search.</div>}
      </div>
    </div>
  );
}

// ---------------- Orders ----------------
function OrdersTab() {
  const [items, setItems] = useState<AdminOrder[]>([]);
  const [filter, setFilter] = useState<string>("live");

  const load = async () => {
    try {
      const url = filter === "all" ? "/api/admin/orders" : `/api/admin/orders?status=${filter}`;
      setItems(await adminFetch<AdminOrder[]>(url));
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void load(); }, [filter]);

  const totalRevenue = useMemo(() => items.filter((o) => o.status === "delivered").reduce((s, o) => s + Number(o.total || 0), 0), [items]);

  return (
    <div data-testid="admin-orders-panel">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Orders ({items.length}) <span className="text-sm text-[#595959] font-normal">· ₹{Math.round(totalRevenue).toLocaleString()} delivered revenue</span></h2>
        <select data-testid="orders-filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="px-3 py-2 rounded-full border border-[#E5E2DC] text-sm">
          <option value="live">Live</option>
          <option value="delivered">Delivered</option>
          <option value="rejected">Rejected/Cancelled</option>
          <option value="all">All</option>
        </select>
      </div>
      <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
            <tr><th className="px-4 py-3">Order ID</th><th className="px-4 py-3">Store(s)</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Placed</th></tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id} className="border-t border-[#E5E2DC]" data-testid={`order-row-${o.id}`}>
                <td className="px-4 py-3 font-mono text-xs text-[#0A1F5C]">{o.id}</td>
                <td className="px-4 py-3 text-[#595959]">{(o.store_names || []).join(", ") || "—"}</td>
                <td className="px-4 py-3 text-[#595959]">{o.customer?.name || o.customer?.phone || "—"}</td>
                <td className="px-4 py-3 text-right font-semibold">₹{Number(o.total).toLocaleString()}</td>
                <td className="px-4 py-3"><span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-[#0A1F5C]/10 text-[#0A1F5C]">{o.status}</span></td>
                <td className="px-4 py-3 text-xs text-[#595959]">{o.created_at?.slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
