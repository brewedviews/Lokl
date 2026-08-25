"use client";

/**
 * Big online/offline availability toggle in the merchant sidebar.
 * Ported from legacy `components/merchant/OnlineToggle.jsx`.
 *
 * Renders only when the merchant is fully launched (approved + storefront set
 * + ≥1 live product + not admin-paused). When OFF the store stays visible
 * with an "Offline now" tag, but all of the store's products are hidden from
 * the public products listing.
 */
import { useEffect, useState } from "react";
import { Power, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

interface StoreState {
  online: boolean;
  published: boolean;
  offline_reason?: "manual" | "closed" | "12h" | null;
  paused?: boolean;
  product_count?: number;
  can_toggle: boolean;
}

const OFFLINE_REASON_LABEL: Record<string, string> = {
  closed: "Closed for the day",
  "12h": "Live limit reached — go live again",
  manual: "Tap to go online",
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
          ? "You're online — accepting orders"
          : "store is offline · products shown at end of feed",
      );
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Couldn't update");
    } finally {
      setBusy(false);
    }
  };

  const on = state.online;
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
            {on ? "Online" : "Offline"}
          </div>
          <div className="text-[11px] text-[#1A2B4C] font-semibold">
            {on ? "Tap to go offline" : (OFFLINE_REASON_LABEL[state.offline_reason ?? "manual"] ?? "Tap to go online")}
          </div>
        </div>
        <div className={`w-9 h-5 rounded-full relative transition ${on ? "bg-[#4F7363]" : "bg-[#595959]/40"}`}>
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? "left-[1rem]" : "left-0.5"}`} />
        </div>
      </div>
    </button>
  );
}
