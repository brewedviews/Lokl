"use client";

/** Mobile info chips for the store cover area. Trigger story/delivery sheets. */
import { useState } from "react";
import { Bike, ShieldCheck, MapPin, Clock, ChevronRight } from "lucide-react";

interface InfoChipProps {
  icon: typeof Bike;
  label: string;
  value: string;
  accent?: boolean;
  onClick?: () => void;
  testid?: string;
}

function InfoChip({ icon: Icon, label, value, accent, onClick, testid }: InfoChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className="flex-1 min-w-0 bg-white rounded-xl border border-[#E5E2DC] px-3 py-2.5 text-left flex items-center gap-2 active:bg-[#FAF8F2] transition"
    >
      <div className={`w-8 h-8 shrink-0 rounded-lg grid place-items-center ${accent ? "bg-[#E68910]/10 text-[#E68910]" : "bg-[#0A1F5C]/8 text-[#0A1F5C]"}`}>
        <Icon size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-[#64748B] leading-tight">{label}</div>
        <div className="text-xs font-semibold text-[#0A1F5C] truncate">{value}</div>
      </div>
      <ChevronRight size={14} className="text-[#94A3B8] shrink-0" />
    </button>
  );
}

interface Props {
  storyText: string | null;
  area: string;
  eta: string;
  city: string;
  timing?: string | null;
}

export function StoreInfoChips({ storyText, area, eta, city, timing }: Props) {
  const [sheet, setSheet] = useState<"story" | "delivery" | null>(null);
  return (
    <>
      <div className="md:hidden -mt-3 relative z-10 px-4">
        <div className="flex gap-2.5">
          {storyText && (
            <InfoChip
              icon={ShieldCheck}
              label="The Story"
              value={`About this store`}
              onClick={() => setSheet("story")}
              testid="chip-story"
            />
          )}
          <InfoChip
            icon={Bike}
            label="Delivery"
            value={`${eta} · ${area}`}
            accent
            onClick={() => setSheet("delivery")}
            testid="chip-delivery"
          />
        </div>
      </div>

      {sheet && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" data-testid="store-info-sheet">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSheet(null)} />
          <div className="relative bg-white w-full sm:max-w-md sm:mx-4 rounded-t-2xl sm:rounded-2xl p-5 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-lg font-bold text-[#0A1F5C]">{sheet === "story" ? "The Story" : "Delivery"}</h3>
              <button onClick={() => setSheet(null)} className="text-[#64748B] text-2xl leading-none -mt-1" data-testid="store-info-sheet-close">×</button>
            </div>
            {sheet === "story" && (
              <p className="text-sm text-[#595959] leading-relaxed whitespace-pre-line">{storyText}</p>
            )}
            {sheet === "delivery" && (
              <div className="space-y-3 text-sm text-[#595959]">
                <div className="flex items-center gap-2"><Bike size={15} className="text-[#E68910]" /> Estimated arrival: <b className="text-[#0A1F5C]">{eta}</b></div>
                <div className="flex items-center gap-2"><MapPin size={15} className="text-[#E68910]" /> {area} · {city}</div>
                <div className="flex items-center gap-2"><ShieldCheck size={15} className="text-[#4F7363]" /> Try-at-doorstep available</div>
                {timing && <div className="flex items-center gap-2"><Clock size={15} className="text-[#E68910]" /> {timing}</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
