"use client";

/**
 * Admin Bank/Address change request approvals.
 *
 * Backend:
 *  GET  /api/admin/change-requests[?status=]
 *  POST /api/admin/change-requests/{cid}/approve
 *  POST /api/admin/change-requests/{cid}/reject     body: {reason?}
 *
 * change_type ∈ {bank, address}. `new_values` carries the merchant's
 * proposed payload — we render it as a clean field list, not raw JSON.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Landmark, MapPin, RefreshCw } from "lucide-react";
import { adminFetch } from "@/lib/legacy-admin";

interface ChangeRequest {
  id: string;
  merchant_id: string;
  change_type: "bank" | "address" | string;
  status: "pending" | "approved" | "rejected" | string;
  created_at: string;
  reason?: string;
  new_values?: Record<string, unknown>;
  old_values?: Record<string, unknown>;
  merchant?: { store_name?: string; email?: string; owner_name?: string; city?: string };
}

const LABELS: Record<string, string> = {
  bank_account_number: "Account #",
  bank_ifsc: "IFSC",
  account_holder_name: "Holder",
  business_address: "Address",
};

export function BankRequestsTab() {
  const [items, setItems] = useState<ChangeRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("pending");

  const load = useCallback(async () => {
    try {
      const url = filter === "all" ? "/api/admin/change-requests" : `/api/admin/change-requests?status=${filter}`;
      setItems(await adminFetch<ChangeRequest[]>(url));
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  const approve = async (cr: ChangeRequest) => {
    setBusy(cr.id);
    try {
      await adminFetch(`/api/admin/change-requests/${cr.id}/approve`, { method: "POST" });
      toast.success("Change approved");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };
  const reject = async (cr: ChangeRequest) => {
    const reason = window.prompt("Rejection reason (visible to merchant):");
    if (!reason) return;
    setBusy(cr.id);
    try {
      await adminFetch(`/api/admin/change-requests/${cr.id}/reject`, {
        method: "POST", body: JSON.stringify({ reason }),
      });
      toast.success("Change rejected");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  return (
    <div data-testid="bank-requests-panel">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Change requests</h2>
        <div className="flex items-center gap-2">
          <select data-testid="cr-filter" value={filter} onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 rounded-full border border-[#E5E2DC] text-sm">
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
          <button onClick={() => void load()} data-testid="cr-refresh" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0A1F5C] hover:underline">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center text-sm text-[#595959]">
          {filter === "pending"
            ? "No bank or address change requests waiting on approval."
            : "Nothing in this state."}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((cr) => {
            const Icon = cr.change_type === "address" ? MapPin : Landmark;
            return (
              <div key={cr.id} className="bg-white border border-[#E5E2DC] rounded-2xl p-4" data-testid={`cr-row-${cr.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon size={14} className="text-[#0A1F5C]" />
                      <div className="font-semibold text-[#0A1F5C]">{cr.change_type === "bank" ? "Bank details" : "Address"} change</div>
                    </div>
                    <div className="text-xs text-[#595959] mt-0.5">
                      {cr.merchant?.store_name || cr.merchant_id} · {cr.merchant?.email || "—"}
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-[#E68910] mt-2">{cr.status}</div>
                    {cr.reason && <div className="text-xs text-red-500 mt-1">Rejected: {cr.reason}</div>}

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {Object.entries(cr.new_values ?? {}).map(([k, v]) => (
                        <div key={k} className="bg-[#FDFBF7] rounded-xl px-3 py-2">
                          <div className="text-[10px] uppercase tracking-widest text-[#595959]">{LABELS[k] || k}</div>
                          <div className="text-xs font-mono text-[#0A1F5C] truncate">{String(v ?? "—")}</div>
                          {cr.old_values?.[k] !== undefined && (
                            <div className="text-[10px] text-[#595959] mt-0.5 line-through truncate">was {String(cr.old_values[k])}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  {cr.status === "pending" && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button disabled={busy === cr.id} onClick={() => approve(cr)}
                        data-testid={`cr-approve-${cr.id}`}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#4F7363] text-white disabled:opacity-50">
                        Approve
                      </button>
                      <button disabled={busy === cr.id} onClick={() => reject(cr)}
                        data-testid={`cr-reject-${cr.id}`}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold bg-red-500 text-white disabled:opacity-50">
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
