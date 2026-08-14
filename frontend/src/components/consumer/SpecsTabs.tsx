"use client";

/**
 * SpecsTabs — segmented Specifications / Description control. Specs are
 * assembled by the caller from real product fields (see product/[id]/page.tsx)
 * — trimmed to only genuinely new data (sizes, category, and fabric/fit
 * when those fields exist) since delivery/returns/try-and-buy/store are
 * already shown elsewhere on the page. 3-column grid, 2 rows visible by
 * default with a "View more" expand once there are more than 6 rows.
 *
 * The segmented control only renders when there's genuinely a CHOICE to
 * make (both specs and a description exist) — a product with, say, specs
 * but no description skips the tab chrome entirely and just shows the
 * specs grid directly, rather than a single orphaned "Specifications" pill
 * with nothing to switch to.
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
  const hasSpecs = specs.length > 0;
  const hasDescription = !!description;
  const showTabs = hasSpecs && hasDescription;
  const [tab, setTab] = useState<"specs" | "description">(hasSpecs ? "specs" : "description");
  const [expanded, setExpanded] = useState(false);

  if (!hasSpecs && !hasDescription) return null;

  const visibleCount = VISIBLE_ROWS * COLS;
  const shownSpecs = expanded ? specs : specs.slice(0, visibleCount);
  const hasMore = specs.length > visibleCount;
  const showSpecsPanel = (!showTabs || tab === "specs") && hasSpecs;
  const showDescriptionPanel = (!showTabs || tab === "description") && hasDescription;

  return (
    <div data-testid="specs-tabs" className="px-4 md:px-0 mt-4">
      {showTabs && (
        <div className="inline-flex p-1 rounded-xl bg-[#F1EEE7] gap-1">
          <button
            type="button"
            onClick={() => setTab("specs")}
            data-testid="specs-tab-specifications"
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition ${
              tab === "specs" ? "bg-white text-ink-navy" : "text-slate-gray"
            }`}
          >
            Specifications
          </button>
          <button
            type="button"
            onClick={() => setTab("description")}
            data-testid="specs-tab-description"
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition ${
              tab === "description" ? "bg-white text-ink-navy" : "text-slate-gray"
            }`}
          >
            Description
          </button>
        </div>
      )}

      {showSpecsPanel && (
        <div className={showTabs ? "mt-4" : ""}>
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

      {showDescriptionPanel && (
        <p className={`text-sm text-[#595959] leading-relaxed ${showTabs ? "mt-4" : ""}`}>{description}</p>
      )}
    </div>
  );
}
