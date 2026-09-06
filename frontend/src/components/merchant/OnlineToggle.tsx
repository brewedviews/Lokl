"use client";

/**
 * Store-availability control in the merchant sidebar.
 *
 * Store-availability redesign (2026-09): the store's SCHEDULE (opening
 * hours + weekly off-day, set on the Storefront page) is now the source of
 * truth for whether it's open — it goes LIVE and OFFLINE automatically
 * every day with no action here. This control is a TEMPORARY CLOSURE
 * override only ("close early today" / "reopen"), not a daily "Go Live"
 * button — tapping it while the schedule already has the store closed
 * (outside hours, or a weekly off-day) does nothing to force it open.
 *
 * Renders only when the merchant is fully launched (approved + storefront set
 * + ≥1 live product + not admin-paused). While effectively closed for any
 * reason, the store stays visible with an offline tag, and its products are
 * hidden from the public products listing.
 */
import { useEffect, useState } from "react";
import { Power, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

interface StoreState {
  online: boolean;
  published: boolean;
  offline_reason?: "manual" | "closed" | "weekly_off" | null;
  paused?: boolean;
  product_count?: number;
  can_toggle: boolean;
}

// Copy for each of the four states a merchant can see here — schedule-driven
// states are informational only (the toggle can't override them); "manual"
// is the one state this control actually changes.
const OFFLINE_REASON_LABEL: Record<string, string> = {
  closed: "Outside opening hours",
  weekly_off: "Weekly off today",
  manual: "Temporarily closed — tap to reopen",
};

export function OnlineToggle() {
  const [state, setState] = useState<StoreState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.merchant.storeState()
      .then((s) => { if (!cancelled) setState(s as StoreState); })
      .catch(() => { if (!cancelled) setState(null); });
    return () => { cancelled = true; };
  }, []);

  if (!state || !state.can_toggle) return null;

  const flip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await api.merchant.setOnline(!state.online);
      setState((s) => (s ? { ...s, online: data.online } : s));
      toast.success(
        data.online
          ? "Open — following your configured hours"
          : "Temporarily closed · products shown at end of feed",
      );
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Couldn't update");
    } finally {
      setBusy(false);
    }
  };

  const on = state.online;
  // Schedule-driven closures (outside hours / weekly off) aren't something
  // this button can fix — tapping it only clears a MANUAL override, so we
  // still show the schedule reason but don't imply the tap will open the
  // store when the schedule itself says closed.
  const scheduleClosed = !on && (state.offline_reason === "closed" || state.offline_reason === "weekly_off");
  const label = on
    ? "Tap to close temporarily"
    : (OFFLINE_REASON_LABEL[state.offline_reason ?? "manual"] ?? "Tap to reopen");

  return (
    <button
      type="button"
      onClick={flip}
      disabled={busy}
      data-testid="online-toggle"
      className={`w-full px-3 py-2.5 rounded-2xl text-left transition border-2 ${on ? "bg-[#4F7363]/10 border-[#4F7363]/40 hover:bg-[#4F7363]/15" : "bg-[#E68910]/10 border-[#E68910]/40 hover:bg-[#E68910]/15"}`}
    >
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${on ? "bg-[#4F7363] text-white" : "bg-[#E68910] text-white"}`}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-[9px] uppercase tracking-widest font-bold ${on ? "text-[#4F7363]" : "text-[#E68910]"}`}>
            {on ? "Open" : scheduleClosed ? "Closed (schedule)" : "Closed"}
          </div>
          <div className="text-[11px] text-[#1A2B4C] font-semibold">
            {label}
          </div>
        </div>
        <div className={`w-9 h-5 rounded-full relative transition ${on ? "bg-[#4F7363]" : "bg-[#595959]/40"}`}>
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? "left-[1rem]" : "left-0.5"}`} />
        </div>
      </div>
    </button>
  );
}
