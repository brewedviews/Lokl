"use client";

/**
 * Lightweight Top-clicks widget — fetches /api/admin/analytics/top-clicks
 * for each asset type at the requested time window.
 *
 * Mounts inside the CMS tab footer; also exportable for the Overview tab.
 */
import { useEffect, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import type { AnalyticsAssetType, TopClickRow } from "@/types";

const TYPES: { id: AnalyticsAssetType; label: string }[] = [
  { id: "hero",     label: "Hero" },
  { id: "category", label: "Categories" },
  { id: "offer",    label: "Offers" },
];

export function TopClicksWidget() {
  const [days, setDays] = useState<7 | 30>(7);
  const [data, setData] = useState<Record<AnalyticsAssetType, TopClickRow[]> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all(TYPES.map((t) => adminApi.topClicks(t.id, days, 5).catch(() => ({ asset_type: t.id, days, rows: [] }))))
      .then((arr) => {
        const out = {} as Record<AnalyticsAssetType, TopClickRow[]>;
        arr.forEach((r, i) => { out[TYPES[i]!.id] = r.rows; });
        setData(out);
      })
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <section data-testid="cms-top-clicks" className="bg-white border border-[#E5E2DC] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-[#0A1F5C]" />
          <h3 className="font-display text-base font-bold text-[#0A1F5C]">Top clicks</h3>
        </div>
        <div className="inline-flex rounded-full border border-[#E5E2DC] overflow-hidden">
          {[7, 30].map((d) => (
            <button key={d} onClick={() => setDays(d as 7 | 30)}
              data-testid={`cms-clicks-window-${d}`}
              className={`px-3 py-1 text-[10px] font-bold ${days === d ? "bg-[#0A1F5C] text-white" : "bg-white text-[#64748B]"}`}>
              Last {d} days
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-center text-[11px] text-[#94A3B8] py-4"><Loader2 size={14} className="inline animate-spin" /> Loading…</div>}

      {!loading && data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {TYPES.map((t) => (
            <div key={t.id} className="border border-[#F1F5F9] rounded-xl p-3" data-testid={`cms-clicks-block-${t.id}`}>
              <div className="text-[10px] uppercase tracking-widest font-bold text-[#94A3B8] mb-2">Top {t.label}</div>
              {data[t.id].length === 0 ? (
                <div className="text-[11px] text-[#94A3B8] py-2">No clicks yet</div>
              ) : (
                <ul className="space-y-1.5">
                  {data[t.id].map((row, i) => (
                    <li key={`${row.asset_id}-${i}`} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-[#0A1F5C] font-mono">{row.asset_id || "—"}</span>
                      <span className="font-bold text-[#0A1F5C] shrink-0">{row.count.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
