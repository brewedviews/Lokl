import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Shield, CheckCircle2, XCircle, Eye, LogOut, Sparkles, Clock } from "lucide-react";
import api, { API } from "../lib/api";
import { toast } from "sonner";

export default function AdminLogin() {
  const nav = useNavigate();
  const [form, setForm] = useState({ email: "admin@bharat-os.com", password: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/admin/login", form);
      localStorage.setItem("bf_admin_token", data.token);
      toast.success("Welcome back, admin");
      nav("/admin");
    } catch (e) { toast.error("Invalid admin credentials"); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[#1A2B4C] flex items-center justify-center p-6 relative overflow-hidden">
      <div className="bf-noise absolute inset-0 opacity-30" />
      <form onSubmit={submit} className="relative bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-full bg-[#1A2B4C] flex items-center justify-center"><Shield size={18} className="text-[#E68910]" /></div>
          <div>
            <div className="display text-xl font-bold text-[#1A2B4C]">Admin Console</div>
            <div className="text-xs text-[#595959]">Bharat Fashion OS · Operations</div>
          </div>
        </div>
        <input data-testid="admin-email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] mb-3" />
        <input data-testid="admin-password" required type="password" placeholder="Admin password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] mb-4" />
        <button data-testid="admin-login" disabled={busy} className="w-full px-5 py-3 rounded-full bg-[#1A2B4C] text-white font-semibold disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
        <p className="text-[10px] text-center text-[#595959] mt-4">Restricted area · authorized personnel only</p>
      </form>
    </div>
  );
}

export function AdminDashboard() {
  const nav = useNavigate();
  const [stats, setStats] = useState(null);
  const [merchants, setMerchants] = useState([]);
  const [tab, setTab] = useState("submitted");
  const [selected, setSelected] = useState(null);

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem("bf_admin_token") || ""}` });

  const load = async () => {
    try {
      const [s, m] = await Promise.all([
        fetch(`${API}/admin/stats`, { headers: authHeader() }).then((r) => r.ok ? r.json() : Promise.reject(r)),
        fetch(`${API}/admin/merchants?status=${tab}`, { headers: authHeader() }).then((r) => r.ok ? r.json() : Promise.reject(r)),
      ]);
      setStats(s); setMerchants(m);
    } catch (e) {
      if (e.status === 401) { localStorage.removeItem("bf_admin_token"); nav("/admin/login"); }
    }
  };

  useEffect(() => {
    if (!localStorage.getItem("bf_admin_token")) { nav("/admin/login"); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const approve = async (mid) => {
    await fetch(`${API}/admin/merchants/${mid}/approve`, { method: "POST", headers: authHeader() });
    toast.success("Approved · notification sent");
    setSelected(null);
    load();
  };

  const reject = async (mid) => {
    const reason = window.prompt("Reason for rejection?", "Please re-upload clearer documents.");
    if (!reason) return;
    await fetch(`${API}/admin/merchants/${mid}/reject`, {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    toast.success("Rejected · merchant notified");
    setSelected(null);
    load();
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <header className="bg-[#1A2B4C] text-white">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield size={20} className="text-[#E68910]" />
            <div>
              <div className="display font-bold">Bharat OS · Admin Console</div>
              <div className="text-[10px] text-white/60">Operations dashboard</div>
            </div>
          </div>
          <button onClick={() => { localStorage.removeItem("bf_admin_token"); nav("/admin/login"); }} data-testid="admin-logout" className="text-sm flex items-center gap-1 hover:text-[#E68910]"><LogOut size={14} /> Sign out</button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 md:px-10 py-8">
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Pending KYC", value: stats?.submitted ?? "—", icon: Clock, color: "text-[#E68910]" },
            { label: "Approved", value: stats?.approved ?? "—", icon: CheckCircle2, color: "text-[#4F7363]" },
            { label: "Rejected", value: stats?.rejected ?? "—", icon: XCircle, color: "text-red-500" },
          ].map((k) => (
            <div key={k.label} className="bg-white border border-[#E5E2DC] rounded-2xl p-5">
              <k.icon size={18} className={k.color} />
              <div className="display text-3xl font-bold text-[#1A2B4C] mt-2">{k.value}</div>
              <div className="text-xs text-[#595959] mt-1">{k.label}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mb-5">
          {[
            ["submitted", "Pending"],
            ["approved", "Approved"],
            ["rejected", "Rejected"],
          ].map(([k, l]) => (
            <button key={k} data-testid={`admin-tab-${k}`} onClick={() => setTab(k)} className={`px-4 py-2 rounded-full text-sm font-semibold transition ${tab === k ? "bg-[#1A2B4C] text-white" : "bg-white border border-[#E5E2DC] text-[#595959]"}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
          {merchants.length === 0 ? (
            <div className="p-10 text-center text-[#595959]">No merchants in this status</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#FDFBF7] text-left text-xs uppercase tracking-wider text-[#595959]">
                <tr>
                  <th className="px-4 py-3">Store</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">City</th>
                  <th className="px-4 py-3">PAN</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {merchants.map((m) => (
                  <tr key={m.id} data-testid={`admin-row-${m.id}`} className="border-t border-[#E5E2DC] hover:bg-[#FDFBF7]">
                    <td className="px-4 py-3 font-semibold text-[#1A2B4C]">{m.store_name}<div className="text-[10px] text-[#595959]">{m.email}</div></td>
                    <td className="px-4 py-3">{m.owner_name}</td>
                    <td className="px-4 py-3">{m.city}</td>
                    <td className="px-4 py-3 font-mono text-xs">{m.pan_number || "—"}</td>
                    <td className="px-4 py-3 text-xs text-[#595959]">{m.kyc_submitted_at ? new Date(m.kyc_submitted_at).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setSelected(m)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-white border border-[#E5E2DC] text-xs font-semibold hover:border-[#1A2B4C]"><Eye size={12} /> View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="display text-2xl font-bold text-[#1A2B4C]">{selected.store_name}</h2>
                <p className="text-sm text-[#595959]">{selected.owner_name} · {selected.email}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-[#595959]"><XCircle size={20} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Business name", selected.business_name],
                ["Type", selected.business_type],
                ["Category", selected.business_category],
                ["Address", selected.business_address],
                ["PAN", selected.pan_number],
                ["GST", selected.gst_number],
                ["Account holder", selected.account_holder_name],
                ["Account / IFSC", `${selected.bank_account_number || ""} · ${selected.bank_ifsc || ""}`],
              ].map(([k, v]) => (
                <div key={k} className="bg-[#FDFBF7] rounded-xl px-3 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-[#595959]">{k}</div>
                  <div className="text-[#1C1C1C] font-medium break-words">{v || "—"}</div>
                </div>
              ))}
            </div>
            {selected.kyc_status === "submitted" && (
              <div className="flex gap-2 mt-5 pt-4 border-t border-[#E5E2DC] justify-end">
                <button data-testid={`reject-${selected.id}`} onClick={() => reject(selected.id)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-red-300 text-red-500 font-semibold hover:bg-red-50"><XCircle size={14} /> Reject</button>
                <button data-testid={`approve-${selected.id}`} onClick={() => approve(selected.id)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#4F7363] text-white font-semibold"><CheckCircle2 size={14} /> Approve</button>
              </div>
            )}
            {selected.kyc_status !== "submitted" && (
              <div className="mt-5 pt-4 border-t border-[#E5E2DC]">
                <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${selected.kyc_status === "approved" ? "bg-[#4F7363]/15 text-[#4F7363]" : "bg-red-100 text-red-500"}`}>
                  {selected.kyc_status === "approved" ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {selected.kyc_status.toUpperCase()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
