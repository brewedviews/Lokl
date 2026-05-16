import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, CheckCircle2, XCircle, Eye, LogOut, Clock, Store as StoreIcon, Pause, Play, Trash2, Download, Sparkles, AlertTriangle } from "lucide-react";
import api, { API } from "../lib/api";
import { toast } from "sonner";

const authH = () => ({ Authorization: `Bearer ${localStorage.getItem("bf_admin_token") || ""}` });
const apiFetch = (path, opts = {}) =>
  fetch(`${API}${path}`, { ...opts, headers: { ...authH(), ...(opts.headers || {}) } });

export default function AdminLogin() {
  const nav = useNavigate();
  const [form, setForm] = useState({ email: "admin@lokl.in", password: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const { data } = await api.post("/admin/login", form);
      localStorage.setItem("bf_admin_token", data.token);
      toast.success("Welcome back, admin"); nav("/admin");
    } catch { toast.error("Invalid admin credentials"); }
    finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen bg-[#1A2B4C] flex items-center justify-center p-6 relative overflow-hidden">
      <div className="bf-noise absolute inset-0 opacity-30" />
      <form onSubmit={submit} className="relative bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-full bg-[#1A2B4C] flex items-center justify-center"><Shield size={18} className="text-[#E68910]" /></div>
          <div><div className="display text-xl font-bold text-[#1A2B4C]">Admin Console</div><div className="text-xs text-[#595959]">Lokl · Operations</div></div>
        </div>
        <input data-testid="admin-email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] mb-3" />
        <input data-testid="admin-password" required type="password" placeholder="Admin password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] mb-4" />
        <button data-testid="admin-login" disabled={busy} className="w-full px-5 py-3 rounded-full bg-[#1A2B4C] text-white font-semibold disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}

export function AdminDashboard() {
  const nav = useNavigate();
  const [tab, setTab] = useState("approvals");
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem("bf_admin_token")) { nav("/admin/login"); return; }
    apiFetch("/admin/stats").then((r) => r.ok ? r.json() : Promise.reject(r))
      .then(setStats).catch((e) => { if (e.status === 401) { localStorage.removeItem("bf_admin_token"); nav("/admin/login"); } });
  }, [nav, tab]);

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <header className="bg-[#1A2B4C] text-white">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield size={20} className="text-[#E68910]" />
            <div><div className="display font-bold">Lokl · Admin Console</div><div className="text-[10px] text-white/60">Operations dashboard</div></div>
          </div>
          <button onClick={() => { localStorage.removeItem("bf_admin_token"); nav("/admin/login"); }} data-testid="admin-logout" className="text-sm flex items-center gap-1 hover:text-[#E68910]"><LogOut size={14} /> Sign out</button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 md:px-10 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { k: "submitted_kyc", l: "Pending KYC", c: "text-[#E68910]" },
            { k: "pending_changes", l: "Pending changes", c: "text-[#E68910]" },
            { k: "stores_live", l: "Stores live", c: "text-[#4F7363]" },
            { k: "stores_paused", l: "Stores paused", c: "text-[#595959]" },
          ].map((s) => (
            <div key={s.k} className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
              <div className={`text-xs ${s.c} uppercase font-semibold`}>{s.l}</div>
              <div className="display text-2xl font-bold text-[#1A2B4C] mt-1">{stats?.[s.k] ?? "—"}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mb-5 flex-wrap">
          {[["approvals", "Approvals"], ["stores", "Stores"], ["live", "Live orders"], ["delivered", "Delivered"]].map(([k, l]) => (
            <button key={k} data-testid={`admin-tab-${k}`} onClick={() => setTab(k)}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition ${tab === k ? "bg-[#1A2B4C] text-white" : "bg-white border border-[#E5E2DC] text-[#595959]"}`}>{l}</button>
          ))}
        </div>

        {tab === "approvals" && <ApprovalsTab />}
        {tab === "stores" && <StoresTab />}
        {tab === "live" && <OrdersTab kind="live" />}
        {tab === "delivered" && <OrdersTab kind="delivered" />}
      </div>
    </div>
  );
}

function ApprovalsTab() {
  const [subtab, setSubtab] = useState("kyc"); // kyc | changes
  const [period, setPeriod] = useState("30d");
  const [merchants, setMerchants] = useState([]);
  const [changes, setChanges] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedCR, setSelectedCR] = useState(null);
  const [kycStatus, setKycStatus] = useState("submitted");

  const load = async () => {
    const [m, c] = await Promise.all([
      apiFetch(`/admin/merchants?status=${kycStatus}`).then((r) => r.json()),
      apiFetch(`/admin/change-requests${period ? `?period=${period}` : ""}`).then((r) => r.json()),
    ]);
    setMerchants(m); setChanges(c);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [subtab, kycStatus, period]);

  const approve = async (mid) => { await apiFetch(`/admin/merchants/${mid}/approve`, { method: "POST" }); toast.success("Approved"); setSelected(null); load(); };
  const reject = async (mid) => {
    const reason = window.prompt("Reason?", "Please re-upload clearer documents.");
    if (!reason) return;
    await apiFetch(`/admin/merchants/${mid}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    toast.success("Rejected"); setSelected(null); load();
  };
  const approveCR = async (cid) => { await apiFetch(`/admin/change-requests/${cid}/approve`, { method: "POST" }); toast.success("Change approved"); setSelectedCR(null); load(); };
  const rejectCR = async (cid) => {
    const reason = window.prompt("Reason?", "Please re-submit with clearer documents.");
    if (!reason) return;
    await apiFetch(`/admin/change-requests/${cid}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    toast.success("Rejected"); setSelectedCR(null); load();
  };
  const download = () => {
    const token = localStorage.getItem("bf_admin_token");
    fetch(`${API}/admin/export/approvals.csv?period=${period}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob()).then((b) => {
        const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `approvals-${period}.csv`; a.click();
      });
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex gap-2">
          <button data-testid="subtab-kyc" onClick={() => setSubtab("kyc")} className={`px-4 py-2 rounded-full text-sm font-semibold ${subtab === "kyc" ? "bg-[#1A2B4C] text-white" : "bg-white border border-[#E5E2DC]"}`}>KYC</button>
          <button data-testid="subtab-changes" onClick={() => setSubtab("changes")} className={`px-4 py-2 rounded-full text-sm font-semibold ${subtab === "changes" ? "bg-[#1A2B4C] text-white" : "bg-white border border-[#E5E2DC]"}`}>Bank / Address changes</button>
        </div>
        <div className="flex items-center gap-2">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="admin-period" className="px-3 py-2 rounded-full bg-white border border-[#E5E2DC] text-xs">
            <option value="yesterday">Yesterday</option><option value="7d">Last 7d</option>
            <option value="30d">Last 30d</option><option value="quarter">Last quarter</option>
          </select>
          {subtab === "kyc" && (
            <select value={kycStatus} onChange={(e) => setKycStatus(e.target.value)} className="px-3 py-2 rounded-full bg-white border border-[#E5E2DC] text-xs">
              <option value="submitted">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
            </select>
          )}
          <button onClick={download} data-testid="export-csv" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#E68910] text-white text-xs font-semibold"><Download size={12} /> Excel</button>
        </div>
      </div>

      <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-x-auto">
        {subtab === "kyc" ? (
          merchants.length === 0 ? <div className="p-10 text-center text-[#595959]">Nothing in this status</div> : (
            <table className="w-full text-sm">
              <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
                <tr><th className="px-4 py-3">Store</th><th className="px-4 py-3">PAN</th><th className="px-4 py-3">City</th><th className="px-4 py-3">Submitted</th><th className="px-4 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody>
                {merchants.map((m) => (
                  <tr key={m.id} data-testid={`mr-${m.id}`} className="border-t border-[#E5E2DC]">
                    <td className="px-4 py-3 font-semibold text-[#1A2B4C]">{m.store_name}<div className="text-[10px] text-[#595959]">{m.email}</div></td>
                    <td className="px-4 py-3 font-mono text-xs">{m.pan_number || "—"}</td>
                    <td className="px-4 py-3">{m.city}</td>
                    <td className="px-4 py-3 text-xs text-[#595959]">{m.kyc_submitted_at ? new Date(m.kyc_submitted_at).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3 text-right"><button onClick={() => setSelected(m)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-white border border-[#E5E2DC] text-xs font-semibold hover:border-[#1A2B4C]"><Eye size={12} /> View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          changes.length === 0 ? <div className="p-10 text-center text-[#595959]">No change requests in this period</div> : (
            <table className="w-full text-sm">
              <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
                <tr><th className="px-4 py-3">Type</th><th className="px-4 py-3">Store</th><th className="px-4 py-3">Submitted</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id} className="border-t border-[#E5E2DC]">
                    <td className="px-4 py-3 font-semibold">{c.change_type.toUpperCase()}</td>
                    <td className="px-4 py-3">{c.merchant?.store_name}<div className="text-[10px] text-[#595959]">{c.merchant?.email}</div></td>
                    <td className="px-4 py-3 text-xs">{new Date(c.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3"><span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${c.status === "approved" ? "bg-[#4F7363]/15 text-[#4F7363]" : c.status === "rejected" ? "bg-red-100 text-red-500" : "bg-[#E68910]/15 text-[#E68910]"}`}>{c.status}</span></td>
                    <td className="px-4 py-3 text-right"><button onClick={() => setSelectedCR(c)} className="text-xs font-semibold text-[#E68910] hover:underline">View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      {selected && <KycModal merchant={selected} onClose={() => setSelected(null)} onApprove={approve} onReject={reject} />}
      {selectedCR && <ChangeModal cr={selectedCR} onClose={() => setSelectedCR(null)} onApprove={approveCR} onReject={rejectCR} />}
    </div>
  );
}

function KycModal({ merchant, onClose, onApprove, onReject }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div><h2 className="display text-2xl font-bold text-[#1A2B4C]">{merchant.store_name}</h2><p className="text-sm text-[#595959]">{merchant.owner_name} · {merchant.email}</p></div>
          <button onClick={onClose}><XCircle size={20} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          {[["Business name", merchant.business_name], ["Type", merchant.business_type], ["Category", merchant.business_category],
            ["Address", merchant.business_address], ["PAN", merchant.pan_number], ["GST", merchant.gst_number],
            ["Account holder", merchant.account_holder_name], ["Account / IFSC", `${merchant.bank_account_number || ""} · ${merchant.bank_ifsc || ""}`]].map(([k, v]) => (
            <div key={k} className="bg-[#FDFBF7] rounded-xl px-3 py-2"><div className="text-[10px] uppercase tracking-widest text-[#595959]">{k}</div><div className="text-[#1C1C1C] font-medium break-words">{v || "—"}</div></div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[["PAN", merchant.pan_doc_b64], ["GST", merchant.gst_doc_b64], ["Cheque", merchant.cancelled_cheque_b64]].map(([label, b64]) => b64 ? (
            <div key={label} className="bg-[#FDFBF7] rounded-xl p-2">
              <div className="text-[10px] uppercase text-[#595959] mb-1">{label}</div>
              <img src={`data:image/*;base64,${b64}`} alt={label} className="w-full h-32 object-cover rounded" onError={(e) => { e.target.style.display = "none"; }} />
              <a href={`data:application/octet-stream;base64,${b64}`} download={`${merchant.id}-${label.toLowerCase()}.bin`} className="text-[10px] text-[#E68910] hover:underline">Download</a>
            </div>
          ) : <div key={label} className="bg-[#FDFBF7] rounded-xl p-3 text-xs text-[#595959]">{label}: not uploaded</div>)}
        </div>
        {merchant.kyc_status === "submitted" && (
          <div className="flex gap-2 pt-4 border-t border-[#E5E2DC] justify-end">
            <button data-testid={`reject-${merchant.id}`} onClick={() => onReject(merchant.id)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-red-300 text-red-500 font-semibold hover:bg-red-50"><XCircle size={14} /> Reject</button>
            <button data-testid={`approve-${merchant.id}`} onClick={() => onApprove(merchant.id)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#4F7363] text-white font-semibold"><CheckCircle2 size={14} /> Approve</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChangeModal({ cr, onClose, onApprove, onReject }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div><h2 className="display text-2xl font-bold text-[#1A2B4C]">{cr.change_type.toUpperCase()} change</h2><p className="text-sm text-[#595959]">{cr.merchant?.store_name} · {cr.merchant?.email}</p></div>
          <button onClick={onClose}><XCircle size={20} /></button>
        </div>
        <div className="bg-[#FDFBF7] rounded-xl p-3 mb-3"><div className="text-[10px] uppercase text-[#595959] mb-1">New values</div><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(cr.new_values, null, 2)}</pre></div>
        {cr.supporting_doc_b64 && (
          <div className="mb-3"><div className="text-[10px] uppercase text-[#595959] mb-1">Supporting doc</div>
            <img src={`data:image/*;base64,${cr.supporting_doc_b64}`} alt="doc" className="w-full max-h-72 object-contain rounded-xl border border-[#E5E2DC]" onError={(e) => { e.target.style.display = "none"; }} />
          </div>
        )}
        <div className="flex gap-2 pt-4 border-t border-[#E5E2DC] justify-end">
          <button onClick={() => onReject(cr.id)} className="px-5 py-2.5 rounded-full border border-red-300 text-red-500 font-semibold"><XCircle size={14} className="inline" /> Reject</button>
          <button onClick={() => onApprove(cr.id)} className="px-5 py-2.5 rounded-full bg-[#4F7363] text-white font-semibold"><CheckCircle2 size={14} className="inline" /> Approve</button>
        </div>
      </div>
    </div>
  );
}

function StoresTab() {
  const [stores, setStores] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [otpModal, setOtpModal] = useState(null);

  const load = () => apiFetch("/admin/stores").then((r) => r.json()).then(setStores);
  useEffect(() => { load(); }, []);

  const toggleStorePause = async (s) => {
    await apiFetch(`/admin/stores/${s.id}/${s.paused ? "unpause" : "pause"}`, { method: "POST" });
    toast.success(s.paused ? "Store live again" : "Store paused"); load();
  };
  const requestDeleteOtp = async (s) => {
    const { otp_demo, message } = await apiFetch(`/admin/stores/${s.id}/request-delete-otp`, { method: "POST" }).then((r) => r.json());
    toast.warning(message, { duration: 8000 });
    setOtpModal({ store: s, hint: otp_demo });
  };
  const confirmDelete = async (otp) => {
    const r = await apiFetch(`/admin/stores/${otpModal.store.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ otp }) });
    if (r.ok) { toast.success("Store deleted"); setOtpModal(null); load(); }
    else { const e = await r.json(); toast.error(e.detail || "Invalid OTP"); }
  };
  const togglePauseProduct = async (p) => {
    await apiFetch(`/admin/products/${p.id}/${p.paused ? "unpause" : "pause"}`, { method: "POST" });
    toast.success(p.paused ? "Product live again" : "Product paused"); load();
  };
  const deleteProduct = async (p) => {
    if (!window.confirm(`Delete product "${p.name}"?`)) return;
    await apiFetch(`/admin/products/${p.id}`, { method: "DELETE" });
    toast.success("Deleted"); load();
  };

  return (
    <div className="space-y-3">
      {stores.length === 0 ? <div className="p-10 bg-white border border-[#E5E2DC] rounded-2xl text-center text-[#595959]">No stores onboarded yet</div> :
        stores.map((s) => (
          <div key={s.id} data-testid={`store-${s.id}`} className="bg-white border border-[#E5E2DC] rounded-2xl">
            <div className="p-4 flex flex-wrap items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-[#FDFBF7] overflow-hidden">{s.banner && <img src={s.banner} alt={s.name} className="w-full h-full object-cover" />}</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[#1A2B4C]">{s.name}<span className="ml-2 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full {s.published ? 'bg-[#4F7363]/15 text-[#4F7363]' : 'bg-[#E5E2DC] text-[#595959]'}">{s.paused ? "PAUSED" : s.published ? "LIVE" : "DRAFT"}</span></div>
                <div className="text-xs text-[#595959]">{s.city} · {s.product_count || 0} products</div>
              </div>
              <button onClick={() => setExpanded(expanded === s.id ? null : s.id)} className="text-xs font-semibold text-[#E68910]">{expanded === s.id ? "Collapse" : "View products"}</button>
              <button onClick={() => toggleStorePause(s)} data-testid={`pause-store-${s.id}`} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-[#E5E2DC] text-xs font-semibold">{s.paused ? <><Play size={11} /> Resume</> : <><Pause size={11} /> Pause</>}</button>
              <button onClick={() => requestDeleteOtp(s)} data-testid={`delete-store-${s.id}`} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-red-300 text-red-500 text-xs font-semibold hover:bg-red-50"><Trash2 size={11} /> Delete</button>
            </div>
            {expanded === s.id && (
              <div className="border-t border-[#E5E2DC] p-4">
                {(s.products || []).length === 0 ? <div className="text-sm text-[#595959]">No products yet</div> :
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {s.products.map((p) => (
                      <div key={p.id} className="bg-[#FDFBF7] rounded-xl overflow-hidden">
                        {p.image && <img src={p.image} alt={p.name} className="w-full aspect-square object-cover" />}
                        <div className="p-2">
                          <div className="text-xs font-semibold truncate">{p.name}</div>
                          <div className="text-[10px] text-[#595959]">₹{p.price} {p.paused ? "· PAUSED" : ""}</div>
                          <div className="flex gap-1 mt-1.5">
                            <button onClick={() => togglePauseProduct(p)} className="flex-1 px-2 py-1 rounded-full bg-white border border-[#E5E2DC] text-[10px]">{p.paused ? "Resume" : "Pause"}</button>
                            <button onClick={() => deleteProduct(p)} className="px-2 py-1 rounded-full bg-white border border-red-300 text-red-500 text-[10px]">Delete</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>}
              </div>
            )}
          </div>
        ))}
      {otpModal && <OtpModal store={otpModal.store} hint={otpModal.hint} onClose={() => setOtpModal(null)} onSubmit={confirmDelete} />}
    </div>
  );
}

function OtpModal({ store, hint, onClose, onSubmit }) {
  const [otp, setOtp] = useState("");
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-md p-6">
        <div className="flex items-center gap-2 mb-3"><AlertTriangle size={22} className="text-red-500" /><h2 className="display text-xl font-bold text-[#1A2B4C]">Delete {store.name}?</h2></div>
        <p className="text-sm text-[#595959] mb-4">This permanently removes the store and all its products. Enter the 6-digit OTP sent to <strong>admin@lokl.in</strong>.</p>
        {hint && <div className="text-xs bg-[#E68910]/10 text-[#E68910] rounded-xl p-2 mb-3"><strong>Demo OTP (mocked email):</strong> {hint}</div>}
        <input data-testid="delete-otp-input" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6-digit OTP" maxLength={6} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none tracking-widest text-center text-lg" />
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 px-5 py-2.5 rounded-full border border-[#E5E2DC]">Cancel</button>
          <button onClick={() => onSubmit(otp)} data-testid="confirm-delete" className="flex-1 px-5 py-2.5 rounded-full bg-red-500 text-white font-semibold">Delete store</button>
        </div>
      </div>
    </div>
  );
}

function OrdersTab({ kind }) {
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(true);

  const load = async () => {
    setBusy(true);
    try {
      const r = await apiFetch(`/admin/orders?status=${kind}`);
      const data = await r.json();
      setOrders(Array.isArray(data) ? data : []);
    } catch { setOrders([]); }
    setBusy(false);
  };
  useEffect(() => { load(); const i = setInterval(load, 12000); return () => clearInterval(i); /* eslint-disable-next-line */ }, [kind]);

  const STATUS_BADGE = {
    pending_merchant: { l: "Pending merchant", c: "bg-[#E68910]/15 text-[#E68910]" },
    accepted:         { l: "Accepted",          c: "bg-blue-100 text-blue-700" },
    preparing:        { l: "Preparing",         c: "bg-amber-100 text-amber-700" },
    on_the_way:       { l: "On the way",        c: "bg-purple-100 text-purple-700" },
    delivered:        { l: "Delivered",         c: "bg-[#4F7363]/15 text-[#4F7363]" },
    rejected:         { l: "Rejected",          c: "bg-red-100 text-red-700" },
    cancelled:        { l: "Cancelled",         c: "bg-zinc-200 text-zinc-700" },
  };

  return (
    <div data-testid={`orders-${kind}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="display text-xl font-bold text-[#1A2B4C]">
            {kind === "live" ? "Live orders" : "Delivered orders"}
          </h2>
          <p className="text-xs text-[#595959]">{busy ? "Loading…" : `${orders.length} order(s) · auto-refreshes every 12s`}</p>
        </div>
        <button onClick={load} data-testid={`refresh-orders-${kind}`} className="text-xs font-semibold text-[#E68910] hover:underline">Refresh</button>
      </div>

      {!busy && orders.length === 0 && (
        <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center text-sm text-[#595959]">
          {kind === "live" ? "No live orders right now." : "No delivered orders yet."}
        </div>
      )}

      <div className="space-y-2">
        {orders.map((o) => {
          const badge = STATUS_BADGE[o.status] || { l: o.status, c: "bg-zinc-200 text-zinc-700" };
          return (
            <div key={o.id} data-testid={`order-row-${o.id}`} className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold text-[#1A2B4C]">{o.id} · ₹{Number(o.total).toLocaleString()}</div>
                  <div className="text-xs text-[#595959]">
                    {(o.customer?.name || o.address?.name || "Customer")} · {o.address?.line1} · {o.address?.city || "Bhilai"}
                  </div>
                  <div className="text-[11px] text-[#595959] mt-0.5">
                    Stores: {(o.store_names || []).join(", ") || "—"} · {o.items?.length || 0} item(s) · {o.payment_method || "—"}
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${badge.c}`}>{badge.l}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
