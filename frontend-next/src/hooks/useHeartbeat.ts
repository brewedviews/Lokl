"use client";

/**
 * useHeartbeat — POST /api/heartbeat every 30s with the caller's role+context.
 * Ported verbatim from legacy `hooks/useHeartbeat.js`: same interval, same
 * sessionStorage sid pattern, same silent-failure semantics.
 */
import { useEffect } from "react";
import { apiClient } from "@/lib/api-client";

type Role = "customer" | "merchant" | "guest";
interface Ctx { phone?: string | null; mid?: string | null }

function getSid(): string {
  if (typeof window === "undefined") return "ssr";
  let sid = sessionStorage.getItem("lokl_sid");
  if (!sid) {
    sid = `s-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    sessionStorage.setItem("lokl_sid", sid);
  }
  return sid;
}

export function useHeartbeat(role: Role = "guest", ctx: Ctx = {}): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sid = getSid();
    const ping = () => {
      apiClient
        .post("/api/heartbeat", {
          sid, role,
          phone: ctx.phone ?? null,
          mid: ctx.mid ?? null,
          path: window.location.pathname,
        })
        .catch(() => { /* silent — heartbeat never blocks UI */ });
    };
    ping();
    const i = window.setInterval(ping, 30_000);
    return () => window.clearInterval(i);
  }, [role, ctx.phone, ctx.mid]);
}

export default useHeartbeat;
