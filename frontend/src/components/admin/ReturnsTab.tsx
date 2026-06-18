"use client";

/**
 * Admin Returns + Complaints tab.
 *
 * Backend:
 *  GET  /api/admin/returns                       — list returns (optional ?status=)
 *  POST /api/admin/returns/{rid}/{action}        — action ∈ assign|arriving|picked_up|complete
 *  GET  /api/admin/returns/analytics             — totals by reason + merchant
 *  GET  /api/admin/complaints                    — list complaints (optional ?status=)
 *  POST /api/admin/complaints/{cid}/resolve      — body: {note?}
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { adminFetch } from "@/lib/legacy-admin";

interface ReturnItem {
  id: string;
  order_id: string;
  status: string;
  reason?: string;
  created_at: string;
  customer_phone?: string;
  merchant_ids?: string[];
  otp?: string;
  items?: Array<{ name?: string; qty?: number; size?: string }>;
}
interface Complaint {
  id: string;
  order_id?: string;
  type?: string;
  details?: string;
  status: string;
  created_at: string;
  customer_phone?: string;
}
interface ReturnsAnalytics {
  total: number;
  by_reason: Array<{ reason: string; count: number }>;
  by_merchant: Array<{ merchant_id: string; store_name: string; count: number }>;
}

const RETURN_ACTIONS: Array<{ from: string[]; action: "assign" | "arriving" | "picked_up" | "complete"; label: string }> = [
  { from: ["requested"], action: "assign", label: "Assign pickup" },
  { from: ["pickup_assigned"], action: "arriving", label: "Mark arriving" },
  { from: ["arriving"], action: "picked_up", label: "Mark picked up" },
  { from: ["picked_up"], action: "complete", label: "Complete return" },
];

export function ReturnsTab() {
  const [returns, setReturns] = useState<ReturnItem[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [analytics, setAnalytics] = useState<ReturnsAnalytics | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<"returns" | "complaints">("returns");
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    try {
      const [r, a, c] = await Promise.all([
        adminFetch<ReturnItem[]>(filter === "all" ? "/api/admin/returns" : `/api/admin/returns?status=${filter}`),
        adminFetch<ReturnsAnalytics>("/api/admin/returns/analytics"),
        adminFetch<Complaint[]>("/api/admin/complaints"),
      ]);
      setReturns(r); setAnalytics(a); setComplaints(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  const advance = async (r: ReturnItem, action: string) => {
    setBusy(r.id);
    try {
      await adminFetch(`/api/admin/returns/${r.id}/${action}`, { method: "POST" });
      toast.success(`Return ${action.replace(/_/g, " ")}`);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const resolveComplaint = async (c: Complaint) => {
    const note = window.prompt("Resolution note (visible to customer):") ?? "";
    if (note === null) return;
    setBusy(c.id);
    try {
      await adminFetch(`/api/admin/complaints/${c.id}/resolve`, {
        method: "POST", body: JSON.stringify({ note }),
      });
      toast.success("Complaint resolved");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const openComplaintsCount = useMemo(() => complaints.filter((c) => c.status !== "resolved").length, [complaints]);

  return (
    <div data-testid="returns-panel">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Returns & complaints</h2>
        <button onClick={() => void load()} data-testid="returns-refresh" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0A1F5C] hover:underline">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Card label="Total returns" value={analytics.total} />
          <Card label="Open returns" value={returns.filter((r) => r.status !== "completed").length} />
          <Card label="Top reason" value={analytics.by_reason[0]?.reason ?? "—"} />
          <Card label="Open complaints" value={openComplaintsCount} />
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <button data-testid="returns-view-returns" onClick={() => setView("returns")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold ${view === "returns" ? "bg-[#0A1F5C] text-white" : "bg-white border border-[#E5E2DC]"}`}>
          Returns ({returns.length})
        </button>
        <button data-testid="returns-view-complaints" onClick={() => setView("complaints")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold ${view === "complaints" ? "bg-[#0A1F5C] text-white" : "bg-white border border-[#E5E2DC]"}`}>
          Complaints ({complaints.length})
        </button>
        {view === "returns" && (
          <select data-testid="returns-filter" value={filter} onChange={(e) => setFilter(e.target.value)}
            className="ml-auto px-3 py-1.5 rounded-full border border-[#E5E2DC] text-xs">
            <option value="all">All</option>
            <option value="requested">Requested</option>
            <option value="pickup_assigned">Pickup assigned</option>
            <option value="arriving">Arriving</option>
            <option value="picked_up">Picked up</option>
            <option value="completed">Completed</option>
          </select>
        )}
      </div>

      {view === "returns" ? (
        returns.length === 0 ? (
          <Empty label="No returns in this state." />
        ) : (
          <div className="space-y-3">
            {returns.map((r) => {
              const nextActions = RETURN_ACTIONS.filter((a) => a.from.includes(r.status));
              const statusColor =
                r.status === "completed" ? "bg-[#4F7363]/15 text-[#4F7363]" :
                r.status === "requested" ? "bg-[#E68910]/15 text-[#E68910]" :
                "bg-[#0A1F5C]/10 text-[#0A1F5C]";
              return (
                <div key={r.id} className="bg-white border border-[#E5E2DC] rounded-2xl p-4" data-testid={`return-row-${r.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-[#0A1F5C] text-sm">Return <span className="font-mono text-xs">{r.id}</span></span>
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${statusColor}`}>{r.status.replace(/_/g, " ")}</span>
                      </div>
                      <div className="text-xs text-[#595959]">
                        Order{" "}
                        <a href={`/orders/${r.order_id}`} target="_blank" rel="noreferrer" className="font-mono text-[#0A1F5C] underline hover:text-[#E68910]">{r.order_id}</a>
                        {r.customer_phone && <> · <span className="font-semibold">{r.customer_phone}</span></>}
                      </div>
                      {r.items && r.items.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {r.items.map((it, i) => (
                            <span key={i} className="inline-flex items-center gap-1.5 bg-[#FDFBF7] border border-[#E5E2DC] rounded-lg px-2 py-1 text-xs text-[#0A1F5C]">
                              {it.name || "Item"}{it.qty && it.qty > 1 ? ` ×${it.qty}` : ""}{it.size ? ` (${it.size})` : ""}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="text-xs text-[#595959] mt-1.5">
                        <span className="font-semibold">Reason:</span> {r.reason || "—"}
                      </div>
                      {r.otp && <div className="text-xs text-[#E68910] mt-1">Pickup OTP: <span className="font-mono font-bold">{r.otp}</span></div>}
                      <div className="text-[10px] text-[#94A3B8] mt-1">{new Date(r.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap shrink-0">
                      {nextActions.map((a) => (
                        <button key={a.action} disabled={busy === r.id}
                          onClick={() => advance(r, a.action)}
                          data-testid={`return-action-${r.id}-${a.action}`}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#0A1F5C] text-white disabled:opacity-50">
                          {a.label}
                        </button>
                      ))}
                      {r.status === "completed" && <span className="text-xs text-[#4F7363] font-semibold">Completed</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        complaints.length === 0 ? (
          <Empty label="No complaints filed." />
        ) : (
          <div className="space-y-3">
            {complaints.map((c) => {
              const statusColor =
                c.status === "resolved" ? "bg-[#4F7363]/15 text-[#4F7363]" :
                "bg-[#E68910]/15 text-[#E68910]";
              return (
                <div key={c.id} className="bg-white border border-[#E5E2DC] rounded-2xl p-4" data-testid={`complaint-row-${c.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-[#0A1F5C] text-sm">{c.type || "Complaint"}</span>
                        <span className="font-mono text-xs text-[#595959]">{c.id}</span>
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${statusColor}`}>{c.status}</span>
                      </div>
                      {c.order_id && (
                        <div className="text-xs text-[#595959] mb-1">
                          Order{" "}
                          <a href={`/orders/${c.order_id}`} target="_blank" rel="noreferrer" className="font-mono text-[#0A1F5C] underline hover:text-[#E68910] font-semibold">{c.order_id}</a>
                          {c.customer_phone && <> · <span className="font-semibold">{c.customer_phone}</span></>}
                        </div>
                      )}
                      {c.details && (
                        <div className="mt-1 p-2 bg-[#FDFBF7] rounded-xl border border-[#E5E2DC]">
                          <pre className="text-xs text-[#1C1C1C] whitespace-pre-wrap font-sans">{c.details}</pre>
                        </div>
                      )}
                      <div className="text-[10px] text-[#94A3B8] mt-1.5">{new Date(c.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                    {c.status !== "resolved" && (
                      <button disabled={busy === c.id} onClick={() => resolveComplaint(c)}
                        data-testid={`complaint-resolve-${c.id}`}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#4F7363] text-white disabled:opacity-50 shrink-0">
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
      <div className="text-[10px] uppercase tracking-widest text-[#595959]">{label}</div>
      <div className="font-display text-2xl font-bold text-[#0A1F5C] mt-1">{value}</div>
    </div>
  );
}
function Empty({ label }: { label: string }) {
  return <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center text-sm text-[#595959]">{label}</div>;
}
