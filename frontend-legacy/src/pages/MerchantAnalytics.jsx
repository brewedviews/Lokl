import React, { useEffect, useState } from "react";
import { Download, TrendingUp, ShoppingBag, Users, Package, IndianRupee, RotateCcw } from "lucide-react";
import MerchantLayout from "../components/merchant/MerchantLayout";
import api, { API } from "../lib/api";

const PERIODS = [
  { k: "yesterday", label: "Yesterday" },
  { k: "7d", label: "Last 7 days" },
  { k: "30d", label: "Last 30 days" },
  { k: "quarter", label: "Last quarter" },
];

export default function MerchantAnalytics() {
  const [period, setPeriod] = useState("30d");
  const [stats, setStats] = useState(null);
  const [returnsStats, setReturnsStats] = useState(null);

  useEffect(() => {
    api.get(`/merchant/analytics?period=${period}`).then((r) => setStats(r.data));
  }, [period]);

  useEffect(() => {
    api.get("/merchant/analytics/returns").then((r) => setReturnsStats(r.data)).catch(() => setReturnsStats(null));
  }, []);

  const download = () => {
    const token = localStorage.getItem("bf_token");
    fetch(`${API}/merchant/analytics/report.csv?period=${period}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.blob()).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `lokl-sales-${period}.csv`; a.click();
    });
  };

  if (!stats) return <MerchantLayout><div className="p-10 text-[#595959]">Loading…</div></MerchantLayout>;

  const max = Math.max(1, ...stats.trend.map((t) => t.revenue));

  return (
    <MerchantLayout>
      <div className="p-6 md:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 data-testid="analytics-title" className="display text-3xl md:text-4xl font-bold text-[#1A2B4C]">Sales analytics</h1>
            <p className="text-[#595959] text-sm mt-1">
              {stats.orders === 0 ? "No revenue yet — your first delivered order will show up here." : "Real-time data from your delivered orders."}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className="inline-flex rounded-full bg-white border border-[#E5E2DC] p-1">
              {PERIODS.map((p) => (
                <button key={p.k} data-testid={`period-${p.k}`} onClick={() => setPeriod(p.k)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${period === p.k ? "bg-[#1A2B4C] text-white" : "text-[#595959]"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <button onClick={download} data-testid="download-report" className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#E68910] text-white text-sm font-semibold hover:bg-[#C9770E]">
              <Download size={14} /> Download report
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Revenue", value: `₹${stats.revenue.toLocaleString()}`, icon: IndianRupee },
            { label: "Orders", value: stats.orders, icon: ShoppingBag },
            { label: "Avg. order", value: `₹${stats.avg_order_value.toLocaleString()}`, icon: Package },
            { label: "Repeat customers", value: `${stats.repeat_rate}%`, icon: Users },
          ].map((k) => (
            <div key={k.label} className="bg-white border border-[#E5E2DC] rounded-2xl p-5">
              <k.icon size={18} className="text-[#E68910]" />
              <div className="display text-2xl md:text-3xl font-bold text-[#1A2B4C] mt-2">{k.value}</div>
              <div className="text-xs text-[#595959] mt-1">{k.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-white border border-[#E5E2DC] rounded-2xl p-6">
            <h3 className="display text-lg font-bold text-[#1A2B4C] mb-4 flex items-center gap-2"><TrendingUp size={16} /> Revenue trend</h3>
            <div className="flex items-end gap-1.5 h-48">
              {stats.trend.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center">
                  <div className="w-full bg-[#1A2B4C] rounded-t-lg hover:bg-[#E68910] transition" style={{ height: `${(d.revenue / max) * 100}%` }} title={`₹${Math.round(d.revenue)}`} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-[#595959] mt-2">
              <span>{stats.trend[0]?.date.slice(5)}</span>
              <span>{stats.trend[stats.trend.length - 1]?.date.slice(5)}</span>
            </div>
          </div>
          <div className="bg-white border border-[#E5E2DC] rounded-2xl p-6">
            <h3 className="display text-lg font-bold text-[#1A2B4C] mb-4">Top products</h3>
            <div className="space-y-3">
              {stats.top_products.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-[#E68910]/10 text-[#E68910] flex items-center justify-center font-bold text-xs">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-[#1A2B4C] truncate">{p.name}</div>
                    <div className="text-xs text-[#595959]">{p.sold} sold</div>
                  </div>
                  <div className="text-sm font-semibold text-[#4F7363]">₹{Math.round(p.revenue).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Returns rate widget — across all-time delivered orders, not period-filtered, so the signal is stable for low-volume merchants */}
        <div className="mt-6 grid lg:grid-cols-3 gap-5">
          <div className="bg-white border border-[#E5E2DC] rounded-2xl p-6" data-testid="returns-rate-card">
            <h3 className="display text-lg font-bold text-[#1A2B4C] mb-4 flex items-center gap-2"><RotateCcw size={16} /> Returns rate</h3>
            {!returnsStats ? <div className="text-xs text-[#595959]">Loading…</div> : (
              <>
                <div className="display text-4xl font-bold text-[#1A2B4C]" data-testid="returns-rate-pct">{returnsStats.returns_rate_pct}%</div>
                <div className="text-xs text-[#595959] mt-1">{returnsStats.returns_total} returns / {returnsStats.delivered_count} delivered</div>
                <p className="text-[11px] text-[#595959] mt-3 leading-snug">Lower is better — under 5% is excellent for fashion. If higher, the histogram on the right tells you exactly where to look.</p>
              </>
            )}
          </div>
          <div className="lg:col-span-2 bg-white border border-[#E5E2DC] rounded-2xl p-6">
            <h3 className="display text-lg font-bold text-[#1A2B4C] mb-4">Returns by reason</h3>
            {!returnsStats || (returnsStats.by_reason || []).length === 0 ? <div className="text-xs text-[#595959]">No returns yet — keep it that way 🤞</div> :
              (() => {
                const max = Math.max(1, ...returnsStats.by_reason.map((r) => r.count));
                return (
                  <div className="space-y-3" data-testid="returns-reason-histogram">
                    {returnsStats.by_reason.map((r) => (
                      <div key={r.reason} className="flex items-center gap-3">
                        <div className="w-32 shrink-0 text-xs text-[#1A2B4C] truncate">{r.reason}</div>
                        <div className="flex-1 h-3 bg-[#FDFBF7] rounded-full overflow-hidden">
                          <div className="h-full bg-[#E68910] rounded-full" style={{ width: `${(r.count / max) * 100}%` }} />
                        </div>
                        <div className="w-8 text-right text-sm font-semibold tabular-nums text-[#1A2B4C]">{r.count}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
          </div>
        </div>
      </div>
    </MerchantLayout>
  );
}
