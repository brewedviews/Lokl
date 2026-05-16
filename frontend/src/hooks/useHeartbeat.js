import { useEffect } from "react";
import api from "../lib/api";

// Stable per-tab session id (persists for the lifetime of the tab via sessionStorage)
function getSid() {
  let sid = sessionStorage.getItem("lokl_sid");
  if (!sid) {
    sid = `s-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    sessionStorage.setItem("lokl_sid", sid);
  }
  return sid;
}

/**
 * Pings /api/heartbeat every 30s so the admin Live-Users tab knows who is online.
 *
 * @param {"customer"|"merchant"|"guest"} role
 * @param {{phone?: string, mid?: string}} ctx optional context
 */
export default function useHeartbeat(role = "guest", ctx = {}) {
  useEffect(() => {
    const sid = getSid();
    const ping = () => {
      api.post("/heartbeat", {
        sid, role,
        phone: ctx.phone || null,
        mid: ctx.mid || null,
        path: window.location.pathname,
      }).catch(() => {});
    };
    ping();
    const i = setInterval(ping, 30_000);
    return () => clearInterval(i);
    // role + ctx are usually stable per session; explicitly stringify ctx to be safe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, ctx.phone, ctx.mid]);
}
