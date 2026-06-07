"use client";

/**
 * Admin Live tab — live presence + auto-refreshing platform stats.
 *
 * Backend:
 *  GET /api/admin/live-users   — sessions seen in the last 2 min, by_role
 *  GET /api/admin/stats        — refresh every 10s for the platform pulse panel
 *  GET /api/admin/orders?status=live — live order count
 */
import { useEffect, useState } from "react";
import { Activity, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { adminFetch } from "@/lib/legacy-admin";

interface LiveSession {
  sid: string;
  role: string;
  phone?: string;
  mid?: string;
  path?: string;
  last_seen: string;
}
interface LiveUsersPayload {
  sessions: LiveSession[];
  count: number;
  by_role: Record<string, number>;
}
interface Stats {
  submitted_kyc?: number;
  approved?: number;
  stores_live?: number;
  stores_paused?: number;
  pending_changes?: number;
}

export function LiveMetricsTab() {
  const [live, setLive] = useState<LiveUsersPayload | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [liveOrders, setLiveOrders] = useState<number>(0);
  const [paused, setPaused] = useState(false);
  const [lastTick, setLastTick] = useState<string>("—");

  const load = async () => {
    try {
      const [l, s, o] = await Promise.all([
        adminFetch<LiveUsersPayload>("/api/admin/live-users"),
        adminFetch<Stats>("/api/admin/stats"),
        adminFetch<unknown[]>("/api/admin/orders?status=live&limit=500"),
      ]);
      setLive(l); setStats(s); setLiveOrders(o.length);
      setLastTick(new Date().toLocaleTimeString());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
    if (paused) return;
    const id = setInterval(() => { void load(); }, 10_000);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <div data-testid="live-panel">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C] flex items-center gap-2">
          <Activity size={20} className="text-[#E68910]" />
          Live pulse
        </h2>
        <div className="flex items-center gap-3 text-xs text-[#595959]">
          <span>Last sync: <span className="font-mono">{lastTick}</span></span>
          <button onClick={() => setPaused((p) => !p)} data-testid="live-pause"
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border ${paused ? "bg-[#E68910] text-white border-[#E68910]" : "bg-white border-[#E5E2DC] text-[#0A1F5C]"}`}>
            {paused ? <><Play size={11} /> Resume</> : <><Pause size={11} /> Pause</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Live users" value={live?.count ?? "—"} accent="text-[#E68910]" />
        <Card label="Customers" value={live?.by_role.customer ?? 0} />
        <Card label="Merchants" value={live?.by_role.merchant ?? 0} />
        <Card label="Guests" value={live?.by_role.guest ?? 0} />
        <Card label="Live orders" value={liveOrders} />
        <Card label="KYC pending" value={stats?.submitted_kyc ?? "—"} />
        <Card label="Stores live" value={stats?.stores_live ?? "—"} />
        <Card label="Change reqs" value={stats?.pending_changes ?? "—"} />
      </div>

      <div className="mt-6 bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E5E2DC] text-xs uppercase tracking-widest text-[#595959]">
          Sessions seen in the last 2 minutes ({live?.sessions.length ?? 0})
        </div>
        <table className="w-full text-sm">
          <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
            <tr><th className="px-4 py-2">Session</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Identity</th><th className="px-4 py-2">Path</th><th className="px-4 py-2">Last seen</th></tr>
          </thead>
          <tbody>
            {(live?.sessions ?? []).map((s) => (
              <tr key={s.sid} className="border-t border-[#E5E2DC]" data-testid={`live-row-${s.sid}`}>
                <td className="px-4 py-2 font-mono text-[11px] text-[#0A1F5C]">{s.sid.slice(0, 12)}…</td>
                <td className="px-4 py-2">
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-[#0A1F5C]/10 text-[#0A1F5C]">{s.role}</span>
                </td>
                <td className="px-4 py-2 text-[#595959]">{s.phone || s.mid || "—"}</td>
                <td className="px-4 py-2 text-xs text-[#595959] font-mono truncate max-w-[260px]">{s.path || "—"}</td>
                <td className="px-4 py-2 text-xs text-[#595959]">{s.last_seen?.slice(11, 19)}</td>
              </tr>
            ))}
            {(!live || live.sessions.length === 0) && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-[#595959]">No active sessions.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
      <div className="text-[10px] uppercase tracking-widest text-[#595959]">{label}</div>
      <div className={`font-display text-2xl font-bold mt-1 ${accent ?? "text-[#0A1F5C]"}`}>{value}</div>
    </div>
  );
}
