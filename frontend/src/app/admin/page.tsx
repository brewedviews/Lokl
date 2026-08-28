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
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Shield, Users, Package, ShoppingBag, BarChart3, LogOut, FileText, ExternalLink, RefreshCw, RotateCcw, Activity, Landmark, UserSquare2, LayoutPanelTop, TicketPercent, MessageSquare, Bike, Search } from "lucide-react";
import { adminFetch } from "@/lib/legacy-admin";
import { useAdminAuthStore } from "@/stores";
import { ReturnsTab } from "@/components/admin/ReturnsTab";
import { CustomersTab } from "@/components/admin/CustomersTab";
import { BankRequestsTab } from "@/components/admin/BankRequestsTab";
import { LiveMetricsTab } from "@/components/admin/LiveMetricsTab";
import { CmsTab } from "@/components/admin/CmsTab";
import { SupportTab } from "@/components/admin/SupportTab";
import { RidersTab } from "@/components/admin/RidersTab";

type Tab = "stats" | "live" | "merchants" | "bank" | "products" | "orders" | "returns" | "support" | "customers" | "cms" | "waitlist" | "coupons" | "riders";

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
  business_category?: string; plan?: string; subscription_status?: string;
  plan_expires_at?: string;
}
interface AdminStoreItem {
  id: string; name: string; merchant_id: string; published?: boolean; paused?: boolean;
  product_count?: number; locality?: string; merchant?: { phone?: string; email?: string };
}
interface AdminProduct {
  id: string; name: string; price: number; store_id: string; store_name?: string;
  merchant_id?: string; paused?: boolean; image?: string;
}
interface AdminOrder {
  id: string; total: number; status: string; created_at: string;
  store_names?: string[]; customer?: { name?: string; phone?: string };
  otp?: string; merchant_ids?: string[];
  store_breakdown?: Array<{ merchant_id: string; store_name: string; items: Array<{ name?: string; qty?: number; size?: string }>; subtotal: number; state: string; otp?: string; delivered_at?: string; cancel_reason?: string }>;
}

const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "stats", label: "Overview", icon: BarChart3 },
  { id: "live", label: "Live", icon: Activity },
  { id: "merchants", label: "Merchants", icon: Users },
  { id: "bank", label: "Bank/Address", icon: Landmark },
  { id: "products", label: "Products", icon: Package },
  { id: "orders", label: "Orders", icon: ShoppingBag },
  { id: "riders", label: "Riders", icon: Bike },
  { id: "returns", label: "Returns", icon: RotateCcw },
  { id: "support", label: "Support", icon: MessageSquare },
  { id: "customers", label: "Customers", icon: UserSquare2 },
  { id: "cms", label: "Homepage CMS", icon: LayoutPanelTop },
  { id: "waitlist", label: "Waitlist", icon: Users },
  { id: "coupons", label: "Coupons", icon: TicketPercent },
];

export default function AdminDashboardPage() {
  const clearAuth = useAdminAuthStore((s) => s.clearAuth);
  const [tab, setTab] = useState<Tab>("stats");
  const [openSupportCount, setOpenSupportCount] = useState(0);

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
                {t.id === "support" && openSupportCount > 0 && (
                  <span className="ml-0.5 bg-[#E68910] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    {openSupportCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {tab === "stats" && <StatsTab />}
        {tab === "live" && <LiveMetricsTab />}
        {tab === "merchants" && <MerchantsTab />}
        {tab === "bank" && <BankRequestsTab />}
        {tab === "products" && <ProductsTab />}
        {tab === "orders" && <OrdersTab />}
        {tab === "riders" && <RidersTab />}
        {tab === "returns" && <ReturnsTab />}
        {tab === "support" && <SupportTab onOpenCountChange={setOpenSupportCount} />}
        {tab === "customers" && <CustomersTab />}
        {tab === "cms" && <CmsTab />}
        {tab === "waitlist" && <WaitlistTab />}
        {tab === "coupons" && <CouponsTab />}
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
// G25: converted from a card-per-merchant list with inline action forms to
// a compact, searchable table. Approve/Reject/Hold/plan/store-pause/store-
// delete now live on the Merchant Detail page (/admin/merchants/[id]) —
// this tab keeps only a fast-path Approve for the common case (a
// `submitted` row that just needs a nod) so an operator isn't forced to
// open every row just to clear a queue.
function MerchantsTab() {
  const router = useRouter();
  const [items, setItems] = useState<Merchant[]>([]);
  const [stores, setStores] = useState<AdminStoreItem[]>([]);
  const [filter, setFilter] = useState<string>("submitted");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const url = filter === "all" ? "/api/admin/merchants" : `/api/admin/merchants?status=${filter}`;
      const [ms, ss] = await Promise.all([
        adminFetch<Merchant[]>(url),
        adminFetch<AdminStoreItem[]>("/api/admin/stores"),
      ]);
      setItems(ms);
      setStores(ss);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  const approve = async (mid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(mid);
    try {
      await adminFetch<{ ok: boolean }>(`/api/admin/merchants/${mid}/approve`, { method: "POST" });
      toast.success("Merchant approved");
      void load();
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  };

  const storeMap = Object.fromEntries(stores.map((s) => [s.merchant_id, s]));

  const filtered = items.filter((m) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return [m.store_name, m.owner_name, m.email, m.phone].some((v) => (v || "").toLowerCase().includes(needle));
  });

  return (
    <div data-testid="merchants-panel">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Merchants ({filtered.length})</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search store, owner, phone, email…" data-testid="merchant-search"
              className="pl-8 pr-3 py-2 rounded-full border border-[#E5E2DC] text-sm w-64" />
          </div>
          <select data-testid="merchant-filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="px-3 py-2 rounded-full border border-[#E5E2DC] text-sm">
            <option value="submitted">KYC submitted</option>
            <option value="on_hold">On hold</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center text-sm text-[#595959]">
          No merchants match.
        </div>
      ) : (
        <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF7] text-left text-[10px] uppercase text-[#595959]">
              <tr>
                <th className="px-4 py-3">Store</th>
                <th className="px-4 py-3">Merchant</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">KYC</th>
                <th className="px-4 py-3 text-right">Products</th>
                <th className="px-4 py-3">Store status</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const st = storeMap[m.id];
                const kyc = kycTabMeta(m.kyc_status);
                const lastUpdated = m.kyc_submitted_at || m.approved_at;
                return (
                  <tr key={m.id} onClick={() => router.push(`/admin/merchants/${m.id}`)} data-testid={`merchant-row-${m.id}`}
                    className="border-t border-[#E5E2DC] cursor-pointer hover:bg-[#FDFBF7]">
                    <td className="px-4 py-3 font-semibold text-[#0A1F5C]">{m.store_name}</td>
                    <td className="px-4 py-3 text-[#595959]">{m.owner_name || "—"}</td>
                    <td className="px-4 py-3 text-[#595959]">{st?.locality || "—"}</td>
                    <td className="px-4 py-3"><span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${kyc.cls}`}>{kyc.label}</span></td>
                    <td className="px-4 py-3 text-right">{st?.product_count ?? 0}</td>
                    <td className="px-4 py-3">
                      {st ? (
                        <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${st.paused ? "bg-red-100 text-red-500" : st.published ? "bg-green-100 text-green-600" : "bg-zinc-100 text-zinc-500"}`}>
                          {st.paused ? "suspended" : st.published ? "live" : "draft"}
                        </span>
                      ) : <span className="text-[#94A3B8]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[#595959] whitespace-nowrap">{lastUpdated ? lastUpdated.slice(0, 10) : "—"}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {m.kyc_status === "submitted" && (
                        <button onClick={(e) => approve(m.id, e)} disabled={busy === m.id} data-testid={`approve-${m.id}`}
                          className="text-xs font-semibold text-[#4F7363] hover:underline disabled:opacity-50 mr-3">
                          {busy === m.id ? "…" : "Quick approve"}
                        </button>
                      )}
                      <span className="text-xs font-semibold text-[#0A1F5C]">Open →</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const KYC_TAB_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Not submitted", cls: "bg-zinc-100 text-zinc-500" },
  submitted: { label: "Pending review", cls: "bg-[#E68910]/15 text-[#E68910]" },
  approved: { label: "Approved", cls: "bg-green-100 text-green-700" },
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-600" },
  on_hold: { label: "Needs changes", cls: "bg-[#E68910]/15 text-[#E68910]" },
};
function kycTabMeta(status: string) {
  return KYC_TAB_META[status] || { label: status, cls: "bg-zinc-100 text-zinc-500" };
}

// ---------------- Products ----------------
// G25: kept as a lean, secondary, all-stores discovery tool (per the task's
// explicit allowance) now that product management itself lives inside the
// Merchant Detail page. Only addition here is a per-row jump to the
// owning merchant, derived from the deterministic store_id convention
// `store-m-{merchant_id}` — no new lookup/endpoint needed for that.
function ProductsTab() {
  const router = useRouter();
  const [items, setItems] = useState<AdminProduct[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = async () => {
    // Admin-scoped endpoint (not the public customer catalog) — must show
    // products regardless of store KYC/publish/pause status, since a
    // pending or suspended merchant's inventory still needs to be
    // findable and manageable here.
    try { setItems(await adminFetch<AdminProduct[]>("/api/admin/products?limit=2000")); }
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
                  <button onClick={() => router.push(`/admin/merchants/${p.merchant_id || p.store_id.replace(/^store-m-/, "")}`)} data-testid={`admin-prod-merchant-${p.id}`} className="text-xs font-semibold text-[#0A1F5C] hover:underline">Merchant →</button>
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
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const url = filter === "all" ? "/api/admin/orders" : `/api/admin/orders?status=${filter}`;
      setItems(await adminFetch<AdminOrder[]>(url));
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  const totalRevenue = useMemo(() => items.filter((o) => o.status === "delivered").reduce((s, o) => s + Number(o.total || 0), 0), [items]);

  const markDelivered = async (o: AdminOrder, merchant_id?: string) => {
    setBusy(`${o.id}-${merchant_id ?? "all"}`);
    try {
      await adminFetch(`/api/admin/orders/${o.id}/mark-delivered`, {
        method: "POST",
        body: JSON.stringify(merchant_id ? { merchant_id } : {}),
      });
      toast.success("Marked delivered");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const cancel = async (o: AdminOrder, merchant_id?: string) => {
    const reason = window.prompt("Cancellation reason:");
    if (!reason) return;
    setBusy(`${o.id}-c-${merchant_id ?? "all"}`);
    try {
      await adminFetch(`/api/admin/orders/${o.id}/cancel`, {
        method: "POST",
        body: JSON.stringify(merchant_id ? { reason, merchant_id } : { reason }),
      });
      toast.success("Order cancelled");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const LIVE_STATES = ["pending_merchant", "accepted", "preparing", "on_the_way", "handed_off"];
  const isLive = (s?: string) => !!s && LIVE_STATES.includes(s);

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
      <div className="space-y-3">
        {items.map((o) => {
          const isExpanded = expanded === o.id;
          const live = isLive(o.status);
          return (
            <div key={o.id} className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden" data-testid={`order-row-${o.id}`}>
              <div className="px-4 py-3 flex items-start gap-3 flex-wrap">
                <button onClick={() => setExpanded(isExpanded ? null : o.id)}
                  data-testid={`order-toggle-${o.id}`}
                  className="font-mono text-xs text-[#0A1F5C] underline-offset-2 hover:underline">
                  {o.id}
                </button>
                <div className="flex-1 min-w-[200px]">
                  <div className="text-xs text-[#595959]">{(o.store_names || []).join(", ") || "—"} · {o.customer?.name || o.customer?.phone || "—"}</div>
                  <div className="text-[11px] text-[#595959]">{o.created_at?.slice(0, 16).replace("T", " ")}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-[#0A1F5C]">₹{Number(o.total).toLocaleString()}</div>
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-[#0A1F5C]/10 text-[#0A1F5C]">{o.status}</span>
                </div>
                {live && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => markDelivered(o)} disabled={!!busy}
                      data-testid={`order-deliver-${o.id}`}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#4F7363] text-white disabled:opacity-50">
                      Mark delivered
                    </button>
                    <button onClick={() => cancel(o)} disabled={!!busy}
                      data-testid={`order-cancel-${o.id}`}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold bg-red-500 text-white disabled:opacity-50">
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {isExpanded && (
                <div className="border-t border-[#E5E2DC] bg-[#FDFBF7] px-4 py-3 text-sm" data-testid={`order-detail-${o.id}`}>
                  {(o.store_breakdown ?? []).length > 0 ? (
                    <div className="space-y-3">
                      {(o.store_breakdown ?? []).map((b) => (
                        <div key={b.merchant_id} className="bg-white rounded-xl border border-[#E5E2DC] p-3">
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                              <div className="font-semibold text-[#0A1F5C]">{b.store_name}</div>
                              <div className="text-xs text-[#595959]">₹{b.subtotal.toLocaleString()} · {b.items.length} item(s)</div>
                              {b.otp && isLive(b.state) && (
                                <div className="text-xs text-[#E68910] mt-1">Delivery OTP: <span className="font-mono font-bold text-base">{b.otp}</span></div>
                              )}
                              {b.cancel_reason && <div className="text-xs text-red-500 mt-1">Cancelled: {b.cancel_reason}</div>}
                              {b.delivered_at && <div className="text-xs text-[#4F7363] mt-1">Delivered {b.delivered_at.slice(0, 16).replace("T", " ")}</div>}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-[#0A1F5C]/10 text-[#0A1F5C]">{b.state}</span>
                              {isLive(b.state) && (
                                <>
                                  <button onClick={() => markDelivered(o, b.merchant_id)} disabled={!!busy}
                                    data-testid={`order-deliver-${o.id}-${b.merchant_id}`}
                                    className="px-2 py-1 rounded-full text-[10px] font-semibold bg-[#4F7363] text-white disabled:opacity-50">
                                    Deliver slice
                                  </button>
                                  <button onClick={() => cancel(o, b.merchant_id)} disabled={!!busy}
                                    data-testid={`order-cancel-${o.id}-${b.merchant_id}`}
                                    className="px-2 py-1 rounded-full text-[10px] font-semibold bg-red-500 text-white disabled:opacity-50">
                                    Cancel slice
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          <ul className="mt-2 text-xs text-[#595959] list-disc list-inside">
                            {b.items.map((it, i) => (
                              <li key={`${b.merchant_id}-${i}-${it.name ?? "item"}`}>{it.name || "Item"} {it.size ? `(${it.size})` : ""} × {it.qty ?? 1}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-[#595959]">No store breakdown available.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center text-sm text-[#595959]">
            No orders in this state.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Waitlist ----------------
interface WaitlistCustomer { id: string; phone: string; created_at: string; }
interface WaitlistMerchant { id: string; phone: string; store_name?: string; category?: string; created_at: string; }
interface WaitlistData { customers: WaitlistCustomer[]; merchants: WaitlistMerchant[]; total_customers: number; total_merchants: number; }
interface PageViewsData { total: number; }

function fmtDate(iso: string) {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-IN", { month: "short" });
  const yr = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon} ${yr} ${hh}:${mm}`;
}

function WaitlistTab() {
  const [data, setData] = useState<WaitlistData | null>(null);
  const [pageViews, setPageViews] = useState<number | null>(null);

  const load = async () => {
    try {
      const [wl, pv] = await Promise.all([
        adminFetch<WaitlistData>("/api/admin/waitlist"),
        adminFetch<PageViewsData>("/api/admin/page-views"),
      ]);
      setData(wl);
      setPageViews(pv.total ?? null);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void load(); }, []);

  return (
    <div data-testid="waitlist-panel">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Waitlist</h2>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0A1F5C] hover:underline"><RefreshCw size={12} /> Refresh</button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Page views" value={pageViews ?? "—"} />
        <Stat label="Customers" value={data?.total_customers ?? "—"} />
        <Stat label="Merchants" value={data?.total_merchants ?? "—"} />
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="font-display text-base font-bold text-[#0A1F5C] mb-2">Customers</h3>
          <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
                <tr>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Joined</th>
                </tr>
              </thead>
              <tbody>
                {(data?.customers ?? []).map((c) => (
                  <tr key={c.id} className="border-t border-[#E5E2DC]">
                    <td className="px-4 py-3 font-mono text-[#0A1F5C]">+91 {c.phone}</td>
                    <td className="px-4 py-3 text-[#595959]">{fmtDate(c.created_at)}</td>
                  </tr>
                ))}
                {(data?.customers ?? []).length === 0 && (
                  <tr><td colSpan={2} className="px-4 py-8 text-center text-sm text-[#595959]">No customers yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="font-display text-base font-bold text-[#0A1F5C] mb-2">Merchants</h3>
          <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
                <tr>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Store Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Joined</th>
                </tr>
              </thead>
              <tbody>
                {(data?.merchants ?? []).map((m) => (
                  <tr key={m.id} className="border-t border-[#E5E2DC]">
                    <td className="px-4 py-3 font-mono text-[#0A1F5C]">+91 {m.phone}</td>
                    <td className="px-4 py-3 font-semibold text-[#0A1F5C]">{m.store_name ?? "—"}</td>
                    <td className="px-4 py-3 text-[#595959]">{m.category ?? "—"}</td>
                    <td className="px-4 py-3 text-[#595959]">{fmtDate(m.created_at)}</td>
                  </tr>
                ))}
                {(data?.merchants ?? []).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-[#595959]">No merchants yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Coupons ----------------
interface AdminCoupon {
  id: string;
  code: string;
  discount_type: string;
  discount_value: number;
  min_order_value: number;
  max_uses?: number | null;
  used_count: number;
  expires_at?: string | null;
  created_at: string;
}

const BLANK_COUPON = { code: "", discount_type: "percent", discount_value: "", min_order_value: "", max_uses: "", expires_at: "" };

function CouponsTab() {
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [form, setForm] = useState(BLANK_COUPON);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await adminFetch<{ coupons: AdminCoupon[] }>("/api/admin/coupons");
      setCoupons(data.coupons ?? []);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!form.code.trim() || !form.discount_value) return toast.error("Code and discount value are required");
    setSaving(true);
    try {
      await adminFetch("/api/admin/coupons", {
        method: "POST",
        body: JSON.stringify({
          code: form.code.trim().toUpperCase(),
          discount_type: form.discount_type,
          discount_value: parseFloat(form.discount_value),
          min_order_value: parseFloat(form.min_order_value || "0"),
          max_uses: form.max_uses ? parseInt(form.max_uses) : null,
          expires_at: form.expires_at || null,
        }),
      });
      toast.success("Coupon created");
      setForm(BLANK_COUPON);
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this coupon?")) return;
    try {
      await adminFetch(`/api/admin/coupons/${id}`, { method: "DELETE" });
      toast.success("Deleted");
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div data-testid="coupons-panel">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Coupons</h2>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0A1F5C] hover:underline"><RefreshCw size={12} /> Refresh</button>
      </div>

      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4 mb-6 space-y-3">
        <h3 className="font-semibold text-[#0A1F5C] text-sm">New Coupon</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <input placeholder="Code (e.g. SAVE20)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="px-3 py-2 border border-[#E5E2DC] rounded-xl text-sm outline-none focus:border-[#0A1F5C]" />
          <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })} className="px-3 py-2 border border-[#E5E2DC] rounded-xl text-sm outline-none focus:border-[#0A1F5C]">
            <option value="percent">Percent off</option>
            <option value="flat">Flat off (₹)</option>
          </select>
          <input placeholder="Discount value" type="number" min="0" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} className="px-3 py-2 border border-[#E5E2DC] rounded-xl text-sm outline-none focus:border-[#0A1F5C]" />
          <input placeholder="Min order (₹, 0 = none)" type="number" min="0" value={form.min_order_value} onChange={(e) => setForm({ ...form, min_order_value: e.target.value })} className="px-3 py-2 border border-[#E5E2DC] rounded-xl text-sm outline-none focus:border-[#0A1F5C]" />
          <input placeholder="Max uses (blank = unlimited)" type="number" min="1" value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} className="px-3 py-2 border border-[#E5E2DC] rounded-xl text-sm outline-none focus:border-[#0A1F5C]" />
          <input placeholder="Expires at" type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} className="px-3 py-2 border border-[#E5E2DC] rounded-xl text-sm outline-none focus:border-[#0A1F5C]" />
        </div>
        <button onClick={create} disabled={saving} className="px-5 py-2 bg-[#0A1F5C] text-white text-sm font-semibold rounded-xl hover:bg-[#0A1F5C]/90 disabled:opacity-50">
          {saving ? "Saving…" : "Create Coupon"}
        </button>
      </div>

      <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Min order</th>
              <th className="px-4 py-3">Uses</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {coupons.map((c) => (
              <tr key={c.id} className="border-t border-[#E5E2DC]">
                <td className="px-4 py-3 font-mono font-bold text-[#0A1F5C]">{c.code}</td>
                <td className="px-4 py-3 text-[#595959]">{c.discount_type === "percent" ? `${c.discount_value}%` : `₹${c.discount_value}`}</td>
                <td className="px-4 py-3 text-[#595959]">{c.min_order_value ? `₹${c.min_order_value}` : "—"}</td>
                <td className="px-4 py-3 text-[#595959]">{c.used_count}{c.max_uses ? ` / ${c.max_uses}` : ""}</td>
                <td className="px-4 py-3 text-[#595959]">{c.expires_at ? c.expires_at.slice(0, 10) : "—"}</td>
                <td className="px-4 py-3">
                  <button onClick={() => void remove(c.id)} className="text-xs text-red-500 hover:underline font-semibold">Delete</button>
                </td>
              </tr>
            ))}
            {coupons.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[#595959]">No coupons yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
