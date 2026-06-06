import React, { useEffect, useState } from "react";
import { Power, Loader2 } from "lucide-react";
import api from "../../lib/api";
import { toast } from "sonner";

/**
 * Big online/offline availability toggle.
 * Renders only when the merchant is fully launched: approved + storefront set + ≥1 live product
 * and not admin-paused. Off → store still visible with "Offline now" tag, products hidden.
 */
export default function OnlineToggle() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/merchant/store/state").then((r) => setState(r.data)).catch(() => setState(null));
  useEffect(() => { load(); }, []);

  if (!state || !state.can_toggle) return null;

  const flip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/merchant/store/online", { online: !state.online });
      setState((s) => ({ ...s, online: data.online }));
      toast.success(data.online ? "You're online — accepting orders" : "You're offline — products hidden from customers");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't update");
    } finally { setBusy(false); }
  };

  const on = state.online;
  return (
    <button
      type="button"
      onClick={flip}
      disabled={busy}
      data-testid="online-toggle"
      className={`w-full mt-2 px-4 py-3 rounded-2xl text-left transition border-2 ${on ? "bg-[#4F7363]/10 border-[#4F7363]/40 hover:bg-[#4F7363]/15" : "bg-[#E68910]/10 border-[#E68910]/40 hover:bg-[#E68910]/15"}`}
    >
      <div className="flex items-center gap-2">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${on ? "bg-[#4F7363] text-white" : "bg-[#E68910] text-white"}`}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-[10px] uppercase tracking-widest font-bold ${on ? "text-[#4F7363]" : "text-[#E68910]"}`}>
            {on ? "Online · accepting orders" : "Offline · hidden from customers"}
          </div>
          <div className="text-xs text-[#1A2B4C] font-semibold mt-0.5">
            {on ? "Tap to go offline" : "Tap to go online"}
          </div>
        </div>
        <div className={`w-10 h-6 rounded-full relative transition ${on ? "bg-[#4F7363]" : "bg-[#595959]/40"}`}>
          <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? "left-[1.125rem]" : "left-0.5"}`} />
        </div>
      </div>
    </button>
  );
}
