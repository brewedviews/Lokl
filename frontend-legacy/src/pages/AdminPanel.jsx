import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, CheckCircle2, XCircle, Eye, LogOut, Clock, Store as StoreIcon, Pause, Play, Trash2, Download, Sparkles, AlertTriangle, PauseCircle, FileText } from "lucide-react";
import api, { API } from "../lib/api";
import { toast } from "sonner";

const safeJson = async (p, fallback = []) => {
  try {
    const r = await p;
    if (!r.ok) return fallback;
    return await r.json();
  } catch { return fallback; }
};

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
          {[["approvals", "Approvals"], ["stores", "Stores"], ["live", "Live orders"], ["delivered", "Delivered"], ["returns", "Returns"], ["complaints", "Complaints"], ["liveusers", "Live users"], ["customers", "Customers"], ["cms", "Site CMS"]].map(([k, l]) => (
            <button key={k} data-testid={`admin-tab-${k}`} onClick={() => setTab(k)}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition ${tab === k ? "bg-[#1A2B4C] text-white" : "bg-white border border-[#E5E2DC] text-[#595959]"}`}>{l}</button>
          ))}
        </div>

        {tab === "approvals" && <ApprovalsTab />}
        {tab === "stores" && <StoresTab />}
        {tab === "live" && <OrdersTab kind="live" />}
        {tab === "delivered" && <OrdersTab kind="delivered" />}
        {tab === "returns" && <ReturnsTab />}
        {tab === "complaints" && <ComplaintsTab />}
        {tab === "liveusers" && <LiveUsersTab />}
        {tab === "customers" && <CustomersTab />}
        {tab === "cms" && <SiteCmsTab />}
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
      safeJson(apiFetch(`/admin/merchants?status=${kycStatus}`), []),
      safeJson(apiFetch(`/admin/change-requests${period ? `?period=${period}` : ""}`), []),
    ]);
    setMerchants(Array.isArray(m) ? m : []);
    setChanges(Array.isArray(c) ? c : []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [subtab, kycStatus, period]);

  const approve = async (mid) => { await apiFetch(`/admin/merchants/${mid}/approve`, { method: "POST" }); toast.success("Approved"); setSelected(null); load(); };
  const reject = async (mid) => {
    const reason = window.prompt("Reason?", "Please re-upload clearer documents.");
    if (!reason) return;
    await apiFetch(`/admin/merchants/${mid}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    toast.success("Rejected"); setSelected(null); load();
  };
  const hold = async (mid, comment) => {
    if (!comment || !comment.trim()) { toast.error("Comment required so the merchant knows what to fix"); return; }
    const r = await apiFetch(`/admin/merchants/${mid}/hold`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment: comment.trim() }) });
    if (r.ok) { toast.success("Put on hold — merchant notified"); setSelected(null); load(); }
    else { const e = await r.json().catch(() => ({})); toast.error(e.detail || "Failed to hold"); }
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
            <select value={kycStatus} onChange={(e) => setKycStatus(e.target.value)} data-testid="admin-kyc-status" className="px-3 py-2 rounded-full bg-white border border-[#E5E2DC] text-xs">
              <option value="submitted">Pending</option>
              <option value="on_hold">On hold</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
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

      {selected && <KycModal merchant={selected} onClose={() => setSelected(null)} onApprove={approve} onReject={reject} onHold={hold} />}
      {selectedCR && <ChangeModal cr={selectedCR} onClose={() => setSelectedCR(null)} onApprove={approveCR} onReject={rejectCR} />}
    </div>
  );
}

// Sniff base64 to figure out the file kind. Stored docs lack mime metadata so
// we peek at the first few base64 chars (each char = 6 bits of the binary
// signature) to recognise PDF / JPG / PNG / WebP. Falls back to JPEG for legacy
// uploads that have neither prefix nor magic header.
function decodeDocMime(b64) {
  if (!b64) return { mime: "application/octet-stream", ext: "bin", isPdf: false, isImg: false };
  // Some stored docs may already carry a `data:...;base64,` prefix
  if (b64.startsWith("data:")) {
    const m = /^data:([^;]+);base64,(.*)$/i.exec(b64);
    if (m) {
      const mime = m[1];
      return {
        mime,
        ext: mime === "application/pdf" ? "pdf" : mime.split("/")[1] || "bin",
        b64: m[2],
        isPdf: mime === "application/pdf",
        isImg: mime.startsWith("image/"),
      };
    }
  }
  const head = b64.slice(0, 8);
  if (head.startsWith("JVBER")) return { mime: "application/pdf", ext: "pdf", b64, isPdf: true, isImg: false };
  if (head.startsWith("iVBOR")) return { mime: "image/png", ext: "png", b64, isPdf: false, isImg: true };
  if (head.startsWith("R0lGOD")) return { mime: "image/gif", ext: "gif", b64, isPdf: false, isImg: true };
  if (head.startsWith("UklGR")) return { mime: "image/webp", ext: "webp", b64, isPdf: false, isImg: true };
  if (head.startsWith("/9j/")) return { mime: "image/jpeg", ext: "jpg", b64, isPdf: false, isImg: true };
  return { mime: "image/jpeg", ext: "jpg", b64, isPdf: false, isImg: true };
}

function DocPreview({ label, data, filename }) {
  const { mime, ext, b64, isPdf, isImg } = decodeDocMime(data);
  const dl = `${(filename || label).toString().toLowerCase().replace(/\s+/g, "-")}.${ext}`;
  if (!data) return <div className="bg-[#FDFBF7] rounded-xl p-3 text-xs text-[#595959]">{label}: not uploaded</div>;
  return (
    <div className="bg-[#FDFBF7] rounded-xl p-2" data-testid={`doc-${label}`}>
      <div className="text-[10px] uppercase text-[#595959] mb-1 flex items-center gap-1">{isPdf && <FileText size={11} />}{label}</div>
      {isImg && <img src={`data:${mime};base64,${b64}`} alt={label} className="w-full h-32 object-cover rounded" onError={(e) => { e.target.style.display = "none"; }} />}
      {isPdf && (
        <a href={`data:${mime};base64,${b64}`} target="_blank" rel="noopener noreferrer" className="block w-full h-32 rounded bg-white border border-[#E5E2DC] flex items-center justify-center text-xs font-semibold text-[#1A2B4C] hover:border-[#E68910]">
          <FileText size={20} className="mr-1.5" /> Open PDF
        </a>
      )}
      <a href={`data:${mime};base64,${b64}`} download={dl} className="text-[10px] text-[#E68910] hover:underline mt-1 inline-block">Download .{ext}</a>
    </div>
  );
}

function KycModal({ merchant, onClose, onApprove, onReject, onHold }) {
  const [holdComment, setHoldComment] = useState("");
  const [showHoldBox, setShowHoldBox] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="display text-2xl font-bold text-[#1A2B4C]">{merchant.store_name}</h2>
            <p className="text-sm text-[#595959]">{merchant.owner_name} · {merchant.email}</p>
          </div>
          <button onClick={onClose}><XCircle size={20} /></button>
        </div>

        {merchant.kyc_status === "on_hold" && merchant.hold_comment && (
          <div data-testid="hold-banner" className="mb-4 p-3 rounded-2xl bg-[#E68910]/10 border border-[#E68910]/30">
            <div className="text-[10px] uppercase tracking-widest text-[#E68910] font-bold mb-1 flex items-center gap-1"><PauseCircle size={12} /> Currently on hold</div>
            <div className="text-sm text-[#1C1C1C]">{merchant.hold_comment}</div>
            {merchant.hold_at && <div className="text-[10px] text-[#595959] mt-1">Sent {new Date(merchant.hold_at).toLocaleString()}</div>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          {[["Business name", merchant.business_name], ["Type", merchant.business_type], ["Category", merchant.business_category],
            ["Address", merchant.business_address], ["PAN", merchant.pan_number], ["GST", merchant.gst_number],
            ["Account holder", merchant.account_holder_name], ["Account / IFSC", `${merchant.bank_account_number || ""} · ${merchant.bank_ifsc || ""}`]].map(([k, v]) => (
            <div key={k} className="bg-[#FDFBF7] rounded-xl px-3 py-2"><div className="text-[10px] uppercase tracking-widest text-[#595959]">{k}</div><div className="text-[#1C1C1C] font-medium break-words">{v || "—"}</div></div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          <DocPreview label="PAN" data={merchant.pan_doc_b64} filename={`${merchant.id}-pan`} />
          <DocPreview label="GST" data={merchant.gst_doc_b64} filename={`${merchant.id}-gst`} />
          <DocPreview label="Cheque" data={merchant.cancelled_cheque_b64} filename={`${merchant.id}-cheque`} />
        </div>

        {showHoldBox && (
          <div className="mb-3 p-3 rounded-2xl bg-[#E68910]/5 border border-[#E68910]/30">
            <div className="text-[10px] uppercase tracking-widest text-[#E68910] font-bold mb-2">What does the merchant need to fix?</div>
            <textarea
              data-testid={`hold-comment-${merchant.id}`}
              value={holdComment}
              onChange={(e) => setHoldComment(e.target.value)}
              rows={3}
              placeholder="e.g. The PAN photo is blurry — please re-upload a clearer copy."
              className="w-full px-3 py-2 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#E68910] text-sm"
            />
            <div className="flex gap-2 mt-2 justify-end">
              <button onClick={() => { setShowHoldBox(false); setHoldComment(""); }} className="px-4 py-2 rounded-full border border-[#E5E2DC] text-xs">Cancel</button>
              <button data-testid={`confirm-hold-${merchant.id}`} onClick={() => onHold(merchant.id, holdComment)} className="px-4 py-2 rounded-full bg-[#E68910] text-white text-xs font-semibold">Send hold message</button>
            </div>
          </div>
        )}

        {(merchant.kyc_status === "submitted" || merchant.kyc_status === "on_hold") && !showHoldBox && (
          <div className="flex gap-2 pt-4 border-t border-[#E5E2DC] justify-end flex-wrap">
            <button data-testid={`reject-${merchant.id}`} onClick={() => onReject(merchant.id)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-red-300 text-red-500 font-semibold hover:bg-red-50"><XCircle size={14} /> Reject</button>
            <button data-testid={`hold-${merchant.id}`} onClick={() => setShowHoldBox(true)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-[#E68910] text-[#E68910] font-semibold hover:bg-[#E68910]/10"><PauseCircle size={14} /> Hold with comment</button>
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

  const load = () => safeJson(apiFetch("/admin/stores"), []).then((d) => setStores(Array.isArray(d) ? d : []));
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
              <div className="border-t border-[#E5E2DC] p-4 space-y-5">
                {/* Merchant / KYC / Bank details */}
                {s.merchant && (
                  <div className="grid md:grid-cols-3 gap-3 text-xs">
                    <div className="bg-[#FDFBF7] rounded-xl p-3">
                      <div className="text-[10px] uppercase tracking-widest text-[#595959] mb-1">Merchant</div>
                      <div className="font-semibold text-[#1A2B4C]">{s.merchant.store_name}</div>
                      <div>{s.merchant.owner_name}</div>
                      <div className="text-[#595959]">{s.merchant.email}</div>
                      <div className="text-[#595959]">{s.merchant.phone}</div>
                      <div className="text-[#595959] mt-1">{s.merchant.business_address}</div>
                    </div>
                    <div className="bg-[#FDFBF7] rounded-xl p-3">
                      <div className="text-[10px] uppercase tracking-widest text-[#595959] mb-1">KYC</div>
                      <div><span className="text-[#595959]">PAN:</span> <span className="font-mono">{s.merchant.pan_number || "—"}</span></div>
                      <div><span className="text-[#595959]">GST:</span> <span className="font-mono">{s.merchant.gst_number || "—"}</span></div>
                      <div><span className="text-[#595959]">Type:</span> {s.merchant.business_type || "—"}</div>
                      <div><span className="text-[#595959]">Category:</span> {s.merchant.business_category || "—"}</div>
                      <div className="mt-1"><span className="text-[#595959]">Status:</span> <span className="font-semibold">{s.merchant.kyc_status}</span></div>
                    </div>
                    <div className="bg-[#FDFBF7] rounded-xl p-3">
                      <div className="text-[10px] uppercase tracking-widest text-[#595959] mb-1">Bank</div>
                      <div><span className="text-[#595959]">A/c:</span> <span className="font-mono">{s.merchant.bank_account_number || "—"}</span></div>
                      <div><span className="text-[#595959]">IFSC:</span> <span className="font-mono">{s.merchant.bank_ifsc || "—"}</span></div>
                      <div><span className="text-[#595959]">Holder:</span> {s.merchant.account_holder_name || "—"}</div>
                    </div>
                  </div>
                )}
                {/* Uploaded KYC docs (PAN / GST / Cheque + any legacy kyc_docs map) */}
                {(s.merchant?.pan_doc_b64 || s.merchant?.gst_doc_b64 || s.merchant?.cancelled_cheque_b64 || (s.merchant?.kyc_docs && Object.keys(s.merchant.kyc_docs).length > 0)) && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-[#595959] mb-2">Uploaded documents</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {s.merchant.pan_doc_b64 && <DocPreview label="PAN" data={s.merchant.pan_doc_b64} filename={`${s.merchant.id}-pan`} />}
                      {s.merchant.gst_doc_b64 && <DocPreview label="GST" data={s.merchant.gst_doc_b64} filename={`${s.merchant.id}-gst`} />}
                      {s.merchant.cancelled_cheque_b64 && <DocPreview label="Cheque" data={s.merchant.cancelled_cheque_b64} filename={`${s.merchant.id}-cheque`} />}
                      {Object.entries(s.merchant.kyc_docs || {}).map(([k, v]) => <DocPreview key={k} label={k} data={v} filename={`${s.merchant.id}-${k}`} />)}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[#595959] mb-2">Products ({(s.products || []).length})</div>
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

  const markDelivered = async (oid, merchantId) => {
    const body = merchantId ? { merchant_id: merchantId } : {};
    const r = await apiFetch(`/admin/orders/${oid}/mark-delivered`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) { toast.success(merchantId ? "Store slice delivered" : "Marked delivered"); load(); }
    else { toast.error("Failed"); }
  };
  const cancel = async (oid, merchantId) => {
    const reason = window.prompt(merchantId
      ? "Reason for cancelling THIS store's slice? (sent to customer)"
      : "Reason for cancelling this order? (will be sent to customer)") || "";
    if (!reason.trim()) return;
    const body = { reason: reason.trim(), ...(merchantId ? { merchant_id: merchantId } : {}) };
    const r = await apiFetch(`/admin/orders/${oid}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) { toast.success(merchantId ? "Store slice cancelled" : "Order cancelled"); load(); }
    else { toast.error("Failed"); }
  };

  const STATUS_BADGE = {
    pending_merchant: { l: "Pending merchant", c: "bg-[#E68910]/15 text-[#E68910]" },
    accepted:         { l: "Accepted · awaiting rider", c: "bg-blue-100 text-blue-700" },
    on_the_way:       { l: "On the way",                c: "bg-purple-100 text-purple-700" },
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

      <div className="space-y-3">
        {orders.map((o) => {
          const badge = STATUS_BADGE[o.status] || { l: o.status, c: "bg-zinc-200 text-zinc-700" };
          const canFinalize = ["pending_merchant", "accepted", "on_the_way"].includes(o.status);
          const isMulti = !!o.is_multi_store && (o.store_breakdown || []).length > 1;
          const stateBadge = (s) => {
            const map = {
              pending:    { l: "Pending",       c: "bg-[#E68910]/15 text-[#E68910]" },
              accepted:   { l: "Confirmed",     c: "bg-blue-100 text-blue-700" },
              handed_off: { l: "On the way",    c: "bg-purple-100 text-purple-700" },
              delivered:  { l: "Delivered",     c: "bg-[#4F7363]/15 text-[#4F7363]" },
              cancelled:  { l: "Cancelled",     c: "bg-zinc-200 text-zinc-700" },
            };
            return map[s] || { l: s || "—", c: "bg-zinc-100 text-zinc-600" };
          };
          return (
            <div key={o.id} data-testid={`order-row-${o.id}`} className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <div className="flex-1 min-w-[240px]">
                  <div className="font-semibold text-[#1A2B4C]">
                    {o.id} · ₹{Number(o.total).toLocaleString()}
                    {isMulti && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#E68910] bg-[#E68910]/10 px-1.5 py-0.5 rounded">Multi-store · {o.store_breakdown.length}</span>}
                  </div>
                  <div className="text-xs text-[#595959]">
                    {(o.customer?.name || o.address?.name || "Customer")} · {o.address?.phone || "—"} · {o.address?.line1}, {o.address?.city || "Bhilai"}
                  </div>
                  <div className="text-[11px] text-[#595959] mt-0.5">
                    {(o.store_names || []).join(", ") || "—"} · {o.items?.length || 0} item(s) · {o.payment_method || "—"}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${badge.c}`}>{badge.l}</span>
                  {!isMulti && o.otp && kind === "live" && (
                    <div className="text-right">
                      <div className="text-[9px] uppercase tracking-widest text-[#595959]">Rider OTP</div>
                      <div data-testid={`admin-otp-${o.id}`} className="display text-2xl font-bold text-[#E68910] tracking-[0.2em] tabular-nums">{o.otp}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Per-merchant breakdown for multi-store orders */}
              {isMulti && (
                <div className="border-t border-[#E5E2DC] pt-3 mb-2 space-y-2">
                  {o.store_breakdown.map((b) => {
                    const sb = stateBadge(b.state);
                    const sliceCanFinalize = !["delivered", "cancelled"].includes(b.state);
                    return (
                      <div key={b.merchant_id} data-testid={`admin-slice-${o.id}-${b.merchant_id}`} className="bg-[#FAF8F3] border border-[#E5E2DC] rounded-xl p-3">
                        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-[#1A2B4C] truncate">{b.store_name}</div>
                            <div className="text-[11px] text-[#595959] mt-0.5">
                              {b.items.length} item(s) · ₹{Number(b.subtotal).toLocaleString()}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {b.otp && kind === "live" && !["delivered", "cancelled"].includes(b.state) && (
                              <div className="text-right">
                                <div className="text-[9px] uppercase tracking-widest text-[#595959]">Rider OTP</div>
                                <div data-testid={`admin-slice-otp-${b.merchant_id}`} className="display text-xl font-bold text-[#E68910] tracking-[0.2em] tabular-nums">{b.otp}</div>
                              </div>
                            )}
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide ${sb.c}`}>{sb.l}</span>
                          </div>
                        </div>
                        {sliceCanFinalize && (
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => markDelivered(o.id, b.merchant_id)} data-testid={`admin-slice-deliver-${o.id}-${b.merchant_id}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#4F7363] text-white text-[11px] font-semibold hover:bg-[#3a5a4d]">
                              <CheckCircle2 size={11} /> Mark delivered
                            </button>
                            <button onClick={() => cancel(o.id, b.merchant_id)} data-testid={`admin-slice-cancel-${o.id}-${b.merchant_id}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-red-300 text-red-600 text-[11px] font-semibold hover:bg-red-50">
                              <XCircle size={11} /> Cancel
                            </button>
                          </div>
                        )}
                        {b.state === "cancelled" && b.cancel_reason && (
                          <div className="mt-1 text-[10px] text-red-600">Reason: {b.cancel_reason}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Whole-order finalize buttons (single-store only) */}
              {!isMulti && canFinalize && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-[#E5E2DC]">
                  <button onClick={() => markDelivered(o.id)} data-testid={`admin-deliver-${o.id}`} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#4F7363] text-white text-xs font-semibold hover:bg-[#3a5a4d]">
                    <CheckCircle2 size={13} /> Mark delivered
                  </button>
                  <button onClick={() => cancel(o.id)} data-testid={`admin-cancel-${o.id}`} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-red-300 text-red-600 text-xs font-semibold hover:bg-red-50">
                    <XCircle size={13} /> Cancel order
                  </button>
                </div>
              )}
              {o.status === "cancelled" && o.cancel_reason && (
                <div className="mt-2 text-[11px] text-red-600">Reason: {o.cancel_reason}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LiveUsersTab() {
  const [data, setData] = useState({ sessions: [], count: 0, by_role: {} });
  const [busy, setBusy] = useState(true);
  const load = async () => {
    setBusy(true);
    try {
      const r = await apiFetch("/admin/live-users");
      const j = await r.json();
      setData(j || { sessions: [], count: 0, by_role: {} });
    } catch { /* noop */ }
    setBusy(false);
  };
  useEffect(() => { load(); const i = setInterval(load, 15_000); return () => clearInterval(i); }, []);

  return (
    <div data-testid="live-users">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="display text-xl font-bold text-[#1A2B4C]">Live users</h2>
          <p className="text-xs text-[#595959]">{busy ? "Loading…" : `${data.count} active in the last 2 min · auto-refreshes every 15s`}</p>
        </div>
        <button onClick={load} className="text-xs font-semibold text-[#E68910] hover:underline">Refresh</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[["customer", "Customers", "bg-[#E68910]/10 text-[#E68910]"], ["merchant", "Merchants", "bg-[#1A2B4C]/10 text-[#1A2B4C]"], ["guest", "Guests", "bg-zinc-100 text-zinc-700"]].map(([k, l, c]) => (
          <div key={k} className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
            <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${c}`}>{l}</div>
            <div className="display text-3xl font-bold text-[#1A2B4C] mt-2">{data.by_role[k] || 0}</div>
          </div>
        ))}
      </div>
      {!busy && data.sessions.length === 0 && (
        <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center text-sm text-[#595959]">
          No one is online right now.
        </div>
      )}
      <div className="space-y-2">
        {data.sessions.map((s) => (
          <div key={s.sid} className="bg-white border border-[#E5E2DC] rounded-2xl p-3 flex items-center justify-between gap-3" data-testid={`live-${s.sid}`}>
            <div>
              <div className="text-sm font-semibold text-[#1A2B4C]">
                {s.role === "merchant" ? `Merchant ${(s.mid || "—").slice(-8)}`
                  : s.role === "customer" ? `Customer ${s.phone || "—"}`
                  : "Guest"}
              </div>
              <div className="text-[11px] text-[#595959]">on {s.path || "/"} · last ping {new Date(s.last_seen).toLocaleTimeString()}</div>
            </div>
            <span className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-full bg-green-100 text-green-700">Online</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const RETURN_STATUS_PILLS = {
  requested: { l: "Requested", c: "bg-[#E68910]/15 text-[#E68910]" },
  pickup_assigned: { l: "Pickup assigned", c: "bg-[#1A2B4C]/15 text-[#1A2B4C]" },
  arriving: { l: "Arriving", c: "bg-purple-100 text-purple-700" },
  picked_up: { l: "Picked up", c: "bg-blue-100 text-blue-700" },
  completed: { l: "Completed", c: "bg-green-100 text-green-700" },
};
const NEXT_ACTION = {
  requested: { key: "assign", label: "Assign pickup" },
  pickup_assigned: { key: "arriving", label: "Mark arriving" },
  arriving: { key: "picked_up", label: "Mark picked up" },
  picked_up: { key: "complete", label: "Mark completed" },
};

function ReturnsTab() {
  const [returns, setReturns] = useState([]);
  const [analytics, setAnalytics] = useState({ total: 0, by_reason: [], by_merchant: [], by_status: [] });
  const [statusFilter, setStatusFilter] = useState("");
  const [busy, setBusy] = useState(true);

  const load = async () => {
    setBusy(true);
    const [rs, an] = await Promise.all([
      safeJson(apiFetch(`/admin/returns${statusFilter ? `?status=${statusFilter}` : ""}`), []),
      safeJson(apiFetch("/admin/returns/analytics"), { total: 0, by_reason: [], by_merchant: [], by_status: [] }),
    ]);
    setReturns(Array.isArray(rs) ? rs : []);
    setAnalytics(an && typeof an === "object" && !Array.isArray(an) ? an : { total: 0, by_reason: [], by_merchant: [], by_status: [] });
    setBusy(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  const advance = async (rid, actionKey) => {
    const r = await apiFetch(`/admin/returns/${rid}/${actionKey}`, { method: "POST" });
    if (r.ok) { toast.success("Updated"); load(); }
    else { const e = await r.json().catch(() => ({})); toast.error(e.detail || "Failed"); }
  };

  return (
    <div data-testid="returns-tab">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="display text-xl font-bold text-[#1A2B4C]">Returns</h2>
          <p className="text-xs text-[#595959]">{analytics.total} return requests total · refresh every action</p>
        </div>
        <select data-testid="returns-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 rounded-full bg-white border border-[#E5E2DC] text-xs">
          <option value="">All statuses</option>
          {Object.entries(RETURN_STATUS_PILLS).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {(analytics.by_status || []).map((s) => {
          const meta = RETURN_STATUS_PILLS[s.status] || { l: s.status, c: "bg-zinc-100 text-zinc-700" };
          return (
            <div key={s.status} className="bg-white border border-[#E5E2DC] rounded-2xl p-3" data-testid={`returns-stat-${s.status}`}>
              <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${meta.c}`}>{meta.l}</div>
              <div className="display text-2xl font-bold text-[#1A2B4C] mt-1.5">{s.count}</div>
            </div>
          );
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-3 mb-5">
        <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
          <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-2">Reasons</div>
          {(analytics.by_reason || []).length === 0 ? <div className="text-xs text-[#595959]">No data yet.</div> :
            <div className="space-y-1.5">
              {analytics.by_reason.map((r) => (
                <div key={r.reason} className="flex items-center gap-2 text-sm" data-testid={`reason-row-${r.reason}`}>
                  <div className="flex-1 truncate text-[#1A2B4C]">{r.reason}</div>
                  <div className="font-semibold text-[#1A2B4C] tabular-nums">{r.count}</div>
                </div>
              ))}
            </div>}
        </div>
        <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
          <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-2">By merchant</div>
          {(analytics.by_merchant || []).length === 0 ? <div className="text-xs text-[#595959]">No data yet.</div> :
            <div className="space-y-1.5">
              {analytics.by_merchant.slice(0, 8).map((m) => (
                <div key={m.merchant_id} className="flex items-center gap-2 text-sm">
                  <div className="flex-1 truncate text-[#1A2B4C]">{m.store_name}</div>
                  <div className="font-semibold text-[#1A2B4C] tabular-nums">{m.count}</div>
                </div>
              ))}
            </div>}
        </div>
      </div>

      {busy ? <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center text-sm text-[#595959]">Loading…</div>
        : returns.length === 0 ? <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center text-sm text-[#595959]">No return requests for this filter.</div>
        : <div className="space-y-2">
            {returns.map((r) => {
              const meta = RETURN_STATUS_PILLS[r.status] || { l: r.status, c: "bg-zinc-100 text-zinc-700" };
              const next = NEXT_ACTION[r.status];
              return (
                <div key={r.id} className="bg-white border border-[#E5E2DC] rounded-2xl p-4" data-testid={`return-row-${r.id}`}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-semibold text-[#1A2B4C]">{r.id} <span className="text-xs text-[#595959] font-normal">· order {r.order_id}</span></div>
                      <div className="text-[11px] text-[#595959]">{new Date(r.created_at).toLocaleString()} · {r.reason} · {(r.items || []).length} item(s) · OTP {r.otp}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] uppercase font-bold px-2.5 py-1 rounded-full ${meta.c}`}>{meta.l}</span>
                      {next && <button data-testid={`advance-${next.key}-${r.id}`} onClick={() => advance(r.id, next.key)} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[#E68910] text-white hover:bg-[#cc7a0a]">{next.label}</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>}
    </div>
  );
}

const COMPLAINT_TYPE_LABEL = {
  return: "Return",
  missing_item: "Missing item",
  damaged_item: "Damaged item",
  delivery_issue: "Delivery issue",
  general: "General",
};

function ComplaintsTab() {
  const [list, setList] = useState([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [busy, setBusy] = useState(true);

  const load = async () => {
    setBusy(true);
    const d = await safeJson(apiFetch(`/admin/complaints${statusFilter ? `?status=${statusFilter}` : ""}`), []);
    setList(Array.isArray(d) ? d : []);
    setBusy(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  const resolve = async (cid) => {
    const note = window.prompt("Resolution note (optional)", "") || "";
    const r = await apiFetch(`/admin/complaints/${cid}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
    if (r.ok) { toast.success("Resolved"); load(); }
  };

  return (
    <div data-testid="complaints-tab">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="display text-xl font-bold text-[#1A2B4C]">Complaints</h2>
          <p className="text-xs text-[#595959]">{list.length} complaint(s) in this filter</p>
        </div>
        <select data-testid="complaints-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 rounded-full bg-white border border-[#E5E2DC] text-xs">
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="">All</option>
        </select>
      </div>

      {busy ? <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center text-sm text-[#595959]">Loading…</div>
        : list.length === 0 ? <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center text-sm text-[#595959]">No complaints in this filter.</div>
        : <div className="space-y-2">
            {list.map((c) => (
              <div key={c.id} className="bg-white border border-[#E5E2DC] rounded-2xl p-4" data-testid={`complaint-row-${c.id}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-semibold text-[#1A2B4C]">{c.id} <span className="text-xs text-[#595959] font-normal">· order {c.order_id}</span></div>
                    <div className="text-[11px] text-[#595959]">{new Date(c.created_at).toLocaleString()} · {COMPLAINT_TYPE_LABEL[c.type] || c.type} · {c.customer_phone}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] uppercase font-bold px-2.5 py-1 rounded-full ${c.status === "resolved" ? "bg-green-100 text-green-700" : "bg-[#E68910]/15 text-[#E68910]"}`}>{c.status}</span>
                    {c.status !== "resolved" && <button data-testid={`resolve-${c.id}`} onClick={() => resolve(c.id)} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[#1A2B4C] text-white hover:bg-[#101D36]">Resolve</button>}
                  </div>
                </div>
                <p className="text-sm text-[#1A2B4C] mt-2 whitespace-pre-wrap">{c.message}</p>
                {c.resolution_note && <p className="text-[11px] text-[#595959] mt-1">Resolution: {c.resolution_note}</p>}
              </div>
            ))}
          </div>}
    </div>
  );
}



function CustomersTab() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(true);
  const [open, setOpen] = useState(null); // selected customer detail

  const load = async (term = "") => {
    setBusy(true);
    try {
      const r = await apiFetch(`/admin/customers${term ? `?q=${encodeURIComponent(term)}` : ""}`);
      const data = await r.json();
      setList(Array.isArray(data) ? data : []);
    } catch { setList([]); }
    setBusy(false);
  };
  useEffect(() => { load(""); }, []);

  const openDetail = async (phone) => {
    try {
      const r = await apiFetch(`/admin/customers/${phone}`);
      const data = await r.json();
      setOpen(data);
    } catch { toast.error("Failed to load"); }
  };

  return (
    <div data-testid="customers">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="display text-xl font-bold text-[#1A2B4C]">Customers directory</h2>
          <p className="text-xs text-[#595959]">{busy ? "Loading…" : `${list.length} customers`}</p>
        </div>
        <div className="flex items-center gap-2 flex-1 md:max-w-sm">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(q)}
            placeholder="Search by phone, name, email…"
            data-testid="customer-search"
            className="flex-1 px-4 py-2 rounded-full bg-white border border-[#E5E2DC] outline-none text-sm focus:border-[#1A2B4C]"
          />
          <button onClick={() => load(q)} className="px-4 py-2 rounded-full bg-[#1A2B4C] text-white text-xs font-semibold">Search</button>
        </div>
      </div>

      {!busy && list.length === 0 && (
        <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center text-sm text-[#595959]">
          No customers yet — they'll appear here after they place their first order.
        </div>
      )}

      <div className="grid gap-2">
        {list.map((c) => (
          <button
            key={c.phone}
            onClick={() => openDetail(c.phone)}
            data-testid={`customer-${c.phone}`}
            className="text-left bg-white border border-[#E5E2DC] hover:border-[#1A2B4C] rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3"
          >
            <div>
              <div className="font-semibold text-[#1A2B4C]">{c.name || "Unnamed"} · {c.phone}</div>
              <div className="text-[11px] text-[#595959]">{c.email || "no email"} · {(c.addresses || []).length} address(es)</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest text-[#595959]">Orders / spend</div>
              <div className="font-bold text-[#1A2B4C]">{c.order_count || 0} · ₹{Number(c.total_spend || 0).toLocaleString()}</div>
            </div>
          </button>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4" onClick={() => setOpen(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="display text-2xl font-bold text-[#1A2B4C]">{open.customer.name || "Customer"}</h3>
                <div className="text-sm text-[#595959]">{open.customer.phone} · {open.customer.email || "no email"}</div>
              </div>
              <button onClick={() => setOpen(null)} className="w-9 h-9 rounded-full border border-[#E5E2DC] flex items-center justify-center"><XCircle size={16} /></button>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-[#FDFBF7] rounded-xl p-3">
                <div className="text-[10px] uppercase text-[#595959]">Orders</div>
                <div className="display text-xl font-bold text-[#1A2B4C]">{open.orders.length}</div>
              </div>
              <div className="bg-[#FDFBF7] rounded-xl p-3">
                <div className="text-[10px] uppercase text-[#595959]">Delivered spend</div>
                <div className="display text-xl font-bold text-[#1A2B4C]">₹{open.orders.filter((o) => o.status === "delivered").reduce((s, o) => s + Number(o.total || 0), 0).toLocaleString()}</div>
              </div>
              <div className="bg-[#FDFBF7] rounded-xl p-3">
                <div className="text-[10px] uppercase text-[#595959]">Addresses</div>
                <div className="display text-xl font-bold text-[#1A2B4C]">{(open.customer.addresses || []).length}</div>
              </div>
            </div>

            <h4 className="text-xs uppercase tracking-widest text-[#595959] mb-2">Order history</h4>
            {open.orders.length === 0 ? (
              <p className="text-sm text-[#595959]">No orders yet.</p>
            ) : (
              <div className="space-y-2">
                {open.orders.map((o) => (
                  <div key={o.id} className="bg-[#FDFBF7] rounded-xl p-3 flex items-center justify-between flex-wrap gap-2 text-sm">
                    <div>
                      <div className="font-semibold text-[#1A2B4C]">{o.id} · ₹{Number(o.total).toLocaleString()}</div>
                      <div className="text-[11px] text-[#595959]">{(o.items || []).length} item(s) · {(o.created_at || "").slice(0, 10)} · {o.payment_method}</div>
                    </div>
                    <span className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-full bg-white border border-[#E5E2DC] text-[#595959]">{o.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function SiteCmsTab() {
  const [cfg, setCfg] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const load = () => api.get("/admin/site/homepage-config").then((r) => setCfg(r.data)).catch(() => {});
  React.useEffect(() => { load(); }, []);

  if (!cfg) return <div className="text-[#595959]">Loading…</div>;

  const updateSection = (id, patch) => {
    setCfg((c) => ({ ...c, sections: c.sections.map((s) => s.id === id ? { ...s, ...patch } : s) }));
  };
  const updateHero = (patch) => setCfg((c) => ({ ...c, hero: { ...c.hero, ...patch } }));

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.put("/admin/site/homepage-config", { sections: cfg.sections, hero: cfg.hero });
      setCfg(data);
      toast.success("Homepage config saved — live within seconds");
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6" data-testid="site-cms-tab">
      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5">
        <h3 className="display text-xl font-bold text-[#1A2B4C] mb-1">Homepage sections</h3>
        <p className="text-xs text-[#595959] mb-4">Drag rank to reorder. Toggle to hide a section without redeploying.</p>
        <div className="space-y-2">
          {cfg.sections.sort((a, b) => a.rank - b.rank).map((s) => (
            <div key={s.id} data-testid={`cms-row-${s.id}`} className="flex items-center gap-3 p-3 rounded-xl border border-[#E5E2DC]">
              <input type="number" value={s.rank} onChange={(e) => updateSection(s.id, { rank: parseInt(e.target.value || "0", 10) })}
                className="w-16 px-2 py-1 rounded-lg border border-[#E5E2DC] text-sm" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-[#1A2B4C]">{s.label}</div>
                <div className="text-[10px] uppercase tracking-widest text-[#595959]">{s.id}</div>
              </div>
              <button data-testid={`cms-toggle-${s.id}`} onClick={() => updateSection(s.id, { enabled: !s.enabled })}
                className={`px-3 py-1.5 rounded-full text-xs font-bold ${s.enabled ? "bg-[#4F7363] text-white" : "bg-[#595959]/20 text-[#595959]"}`}>
                {s.enabled ? "ON" : "OFF"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-5">
        <h3 className="display text-xl font-bold text-[#1A2B4C] mb-1">Hero</h3>
        <p className="text-xs text-[#595959] mb-4">Image URL, copy, CTA labels and links — all editable here.</p>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          {[
            ["image", "Image URL"], ["eyebrow", "Eyebrow chip"],
            ["title_line1", "Title line 1"], ["title_line2", "Title line 2"],
            ["subtitle", "Subtitle"],
            ["cta_primary_label", "Primary CTA label"], ["cta_primary_link", "Primary CTA link"],
            ["cta_secondary_label", "Secondary CTA label"], ["cta_secondary_link", "Secondary CTA link"],
          ].map(([k, label]) => (
            <label key={k} className="block">
              <span className="text-[10px] uppercase tracking-widest text-[#595959] font-bold">{label}</span>
              <input value={cfg.hero?.[k] || ""} data-testid={`cms-hero-${k}`}
                onChange={(e) => updateHero({ [k]: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-[#E5E2DC]" />
            </label>
          ))}
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={cfg.hero?.show_stats !== false} onChange={(e) => updateHero({ show_stats: e.target.checked })} />
            <span className="text-sm">Show stats strip</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={cfg.hero?.show_usp_chips !== false} onChange={(e) => updateHero({ show_usp_chips: e.target.checked })} />
            <span className="text-sm">Show USP chips</span>
          </label>
        </div>
      </div>

      <button onClick={save} disabled={busy} data-testid="cms-save"
        className="px-6 py-3 rounded-full bg-[#E68910] text-white font-bold disabled:opacity-50">
        {busy ? "Saving…" : "Save homepage config"}
      </button>
    </div>
  );
}
