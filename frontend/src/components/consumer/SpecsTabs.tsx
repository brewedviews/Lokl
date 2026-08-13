"use client";

/**
 * SpecsTabs — segmented Specifications / Description control. Specs are
 * assembled by the caller from real product fields (see product/[id]/page.tsx)
 * — no fabricated attributes (fabric, material, etc.) that aren't in the
 * data model. 3-column grid, 2 rows visible by default with a "View more"
 * expand once there are more than 6 rows.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";

export interface SpecRow {
  label: string;
  value: string;
}

const VISIBLE_ROWS = 2;
const COLS = 3;

export function SpecsTabs({ specs, description }: { specs: SpecRow[]; description?: string | null }) {
  const [tab, setTab] = useState<"specs" | "description">(specs.length > 0 ? "specs" : "description");
  const [expanded, setExpanded] = useState(false);

  if (specs.length === 0 && !description) return null;

  const visibleCount = VISIBLE_ROWS * COLS;
  const shownSpecs = expanded ? specs : specs.slice(0, visibleCount);
  const hasMore = specs.length > visibleCount;

  return (
    <div data-testid="specs-tabs" className="px-4 md:px-0 mt-4">
      {/* Segmented control */}
      <div className="inline-flex p-1 rounded-xl bg-[#F1EEE7] gap-1">
        {specs.length > 0 && (
          <button
            type="button"
            onClick={() => setTab("specs")}
            data-testid="specs-tab-specifications"
            className={`px-4 py-1.5 rounded-t-lg rounded-b-lg text-xs font-bold transition ${
              tab === "specs" ? "bg-white text-ink-navy rounded-t-xl" : "text-slate-gray"
            }`}
          >
            Specifications
          </button>
        )}
        {description && (
          <button
            type="button"
            onClick={() => setTab("description")}
            data-testid="specs-tab-description"
            className={`px-4 py-1.5 rounded-t-lg rounded-b-lg text-xs font-bold transition ${
              tab === "description" ? "bg-white text-ink-navy rounded-t-xl" : "text-slate-gray"
            }`}
          >
            Description
          </button>
        )}
      </div>

      {tab === "specs" && specs.length > 0 && (
        <div className="mt-4">
          <div className="grid grid-cols-3 gap-x-3 gap-y-4">
            {shownSpecs.map((s) => (
              <div key={s.label} data-testid={`spec-row-${s.label}`}>
                <p className="text-[12px] text-slate-gray">{s.label}</p>
                <p className="text-[16px] font-bold text-ink-navy mt-0.5">{s.value}</p>
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              data-testid="specs-view-more"
              className="w-full flex items-center justify-center gap-1 mt-4 text-xs font-bold text-ink-navy"
            >
              {expanded ? "View less" : "View more"}
              <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      )}

      {tab === "description" && description && (
        <p className="mt-4 text-sm text-[#595959] leading-relaxed">{description}</p>
      )}
    </div>
  );
}
