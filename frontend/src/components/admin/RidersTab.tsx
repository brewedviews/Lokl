"use client";

/**
 * Admin Riders tab (Phase 1 rider delivery platform, Commit 5) — provision
 * and manage the rider roster the /rider PWA (Commit 4) logs into.
 *
 * Backend (Commit 2):
 *  GET   /api/admin/riders          — list
 *  POST  /api/admin/riders          — create {phone, name, zone?}
 *  PATCH /api/admin/riders/{id}     — update {status?, name?, zone?}
 *
 * Riders are ADMIN-PROVISIONED, not self-registered (see rider_request_otp
 * in server.py) — this screen is the only place a rider identity comes into
 * existence, so it's wired into the main admin tab bar like every other
 * admin CMS screen, not left reachable only by a direct URL.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Ban, CheckCircle2, Pencil, X } from "lucide-react";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import type { Rider } from "@/types";

const BLANK_FORM = { name: "", phone: "", zone: "" };

function formatLastSeen(iso?: string | null): string {
  if (!iso) return "Never";
  return iso.slice(0, 16).replace("T", " ");
}

export function RidersTab() {
  const [riders, setRiders] = useState<Rider[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", zone: "" });

  const load = useCallback(async () => {
    try {
      setRiders(await api.admin.listRiders());
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    const phone = form.phone.replace(/\D/g, "");
    if (!/^[0-9]{10}$/.test(phone)) return toast.error("Enter a valid 10-digit phone number");
    if (!form.name.trim()) return toast.error("Name is required");
    setSaving(true);
    try {
      await api.admin.createRider({ phone, name: form.name.trim(), zone: form.zone.trim() || undefined });
      toast.success("Rider added");
      setForm(BLANK_FORM);
      void load();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (r: Rider) => {
    const next = r.status === "active" ? "suspended" : "active";
    setBusyId(r.id);
    try {
      await api.admin.updateRider(r.id, { status: next });
      toast.success(next === "suspended" ? `${r.name} suspended — they can no longer log in` : `${r.name} reactivated`);
      void load();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (r: Rider) => {
    setEditingId(r.id);
    setEditForm({ name: r.name, zone: r.zone ?? "" });
  };

  const saveEdit = async (id: string) => {
    if (!editForm.name.trim()) return toast.error("Name cannot be empty");
    setBusyId(id);
    try {
      await api.admin.updateRider(id, { name: editForm.name.trim(), zone: editForm.zone.trim() || undefined });
      toast.success("Rider updated");
      setEditingId(null);
      void load();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-testid="riders-panel">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Riders ({riders.length})</h2>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0A1F5C] hover:underline">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4 mb-6 space-y-3">
        <h3 className="font-semibold text-[#0A1F5C] text-sm">Add rider</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <input
            placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            data-testid="rider-form-name"
            className="px-3 py-2 border border-[#E5E2DC] rounded-xl text-sm outline-none focus:border-[#0A1F5C]"
          />
          <input
            placeholder="10-digit phone" value={form.phone} inputMode="numeric"
            onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
            data-testid="rider-form-phone"
            className="px-3 py-2 border border-[#E5E2DC] rounded-xl text-sm outline-none focus:border-[#0A1F5C]"
          />
          <input
            placeholder="Zone (optional)" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}
            data-testid="rider-form-zone"
            className="px-3 py-2 border border-[#E5E2DC] rounded-xl text-sm outline-none focus:border-[#0A1F5C]"
          />
        </div>
        <button
          onClick={() => void create()} disabled={saving} data-testid="rider-form-submit"
          className="px-5 py-2 bg-[#0A1F5C] text-white text-sm font-semibold rounded-xl hover:bg-[#0A1F5C]/90 disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add rider"}
        </button>
      </div>

      <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Zone</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Online</th>
              <th className="px-4 py-3">Last seen</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-[#595959]">Loading…</td></tr>
            ) : riders.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-[#595959]">No riders yet — add one above.</td></tr>
            ) : riders.map((r) => {
              const isEditing = editingId === r.id;
              const isBusy = busyId === r.id;
              return (
                <tr key={r.id} className="border-t border-[#E5E2DC]" data-testid={`rider-row-${r.id}`}>
                  <td className="px-4 py-3 font-semibold text-[#0A1F5C]">
                    {isEditing ? (
                      <input
                        value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        data-testid={`rider-edit-name-${r.id}`}
                        className="px-2 py-1 border border-[#E5E2DC] rounded-lg text-sm w-full outline-none focus:border-[#0A1F5C]"
                      />
                    ) : r.name}
                  </td>
                  <td className="px-4 py-3 text-[#595959] font-mono">{r.phone}</td>
                  <td className="px-4 py-3 text-[#595959]">
                    {isEditing ? (
                      <input
                        value={editForm.zone} onChange={(e) => setEditForm({ ...editForm, zone: e.target.value })}
                        placeholder="—" data-testid={`rider-edit-zone-${r.id}`}
                        className="px-2 py-1 border border-[#E5E2DC] rounded-lg text-sm w-full outline-none focus:border-[#0A1F5C]"
                      />
                    ) : (r.zone || "—")}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      r.status === "active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                    }`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${r.online ? "text-green-600" : "text-[#595959]"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${r.online ? "bg-green-500" : "bg-[#E5E2DC]"}`} />
                      {r.online ? "Online" : "Offline"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#595959]">{formatLastSeen(r.last_seen_at)}</td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void saveEdit(r.id)} disabled={isBusy} data-testid={`rider-save-${r.id}`}
                          className="text-xs font-semibold text-[#0A1F5C] hover:underline disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button onClick={() => setEditingId(null)} data-testid={`rider-cancel-edit-${r.id}`} className="text-[#595959] hover:text-[#0A1F5C]">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => startEdit(r)} data-testid={`rider-edit-${r.id}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#595959] hover:text-[#0A1F5C]"
                        >
                          <Pencil size={12} /> Edit
                        </button>
                        <button
                          onClick={() => void toggleStatus(r)} disabled={isBusy} data-testid={`rider-toggle-status-${r.id}`}
                          className={`inline-flex items-center gap-1 text-xs font-semibold hover:underline disabled:opacity-50 ${
                            r.status === "active" ? "text-red-500" : "text-green-600"
                          }`}
                        >
                          {r.status === "active" ? <><Ban size={12} /> Suspend</> : <><CheckCircle2 size={12} /> Reactivate</>}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
