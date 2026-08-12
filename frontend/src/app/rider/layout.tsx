"use client";

/**
 * RiderLayout — minimal chrome for the rider PWA (Phase 1, Commit 4).
 *
 * Deliberately NOT the consumer shell (no bottom nav, no shopper header) and
 * NOT the merchant sidebar dashboard — riders work one-handed, outdoors,
 * on the move, so this is just a slim top bar (online/offline toggle +
 * rider name + logout) over a full-height content area. High-contrast,
 * function first.
 *
 * Auth-gate mirrors MerchantLayout's hydration-wait pattern (wait one render
 * for zustand-persist to rehydrate before deciding to redirect, so a hard
 * refresh on an authenticated route doesn't flash-bounce to /rider/login),
 * simplified — riders have no approval/KYC status to branch on, just
 * signed-in-or-not (server-side suspension is enforced per-request by the
 * backend; see the 403 rider scope handling in api-client.ts).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import { LogOut, Bike } from "lucide-react";
import { useRiderAuthStore } from "@/stores";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";

const PUBLIC = ["/rider/login"];

export default function RiderLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);

  const isAuthed = useRiderAuthStore((s) => s.isAuthenticated);
  const rider = useRiderAuthStore((s) => s.rider);
  const clearAuth = useRiderAuthStore((s) => s.clearAuth);
  const updateRider = useRiderAuthStore((s) => s.updateRider);

  const isPublic = PUBLIC.includes(pathname);

  useEffect(() => { setHydrated(true); }, []);
  useEffect(() => { document.title = "Lokl Rider"; }, []);

  useEffect(() => {
    if (!hydrated || isPublic) return;
    if (!isAuthed) router.replace("/rider/login");
  }, [hydrated, isPublic, isAuthed, router]);

  // Scoped PWA manifest — installable "Lokl Rider" home-screen shortcut.
  // Deliberately lightweight: no service worker / offline caching build-out,
  // just the add-to-home-screen nicety the brief asked for.
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/rider-manifest.json";
    document.head.appendChild(link);
    const theme = document.createElement("meta");
    theme.name = "theme-color";
    theme.content = "#0A1F5C";
    document.head.appendChild(theme);
    return () => {
      document.head.removeChild(link);
      document.head.removeChild(theme);
    };
  }, []);

  const toggleOnline = async () => {
    if (!rider || togglingOnline) return;
    const next = !rider.online;
    setTogglingOnline(true);
    try {
      await api.rider.setStatus({ online: next });
      updateRider({ online: next });
      toast.success(next ? "You're online" : "You're offline");
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setTogglingOnline(false);
    }
  };

  const signOut = () => {
    clearAuth();
    router.replace("/rider/login");
  };

  if (isPublic) {
    return (<><Toaster position="top-center" richColors />{children}</>);
  }
  if (!hydrated) {
    return (
      <div className="min-h-screen bg-brand-primary flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-white/40 border-t-white animate-spin" />
      </div>
    );
  }
  // After hydration, if we genuinely have no token the redirect-to-login
  // effect is already queued — render nothing meanwhile.
  if (!isAuthed) return null;

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      <Toaster position="top-center" richColors />
      <header
        data-testid="rider-topbar"
        className="sticky top-0 z-40 bg-brand-primary text-white px-4 flex items-center justify-between gap-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))", paddingBottom: "0.75rem" }}
      >
        <Link href="/rider" data-testid="rider-logo" className="flex items-center gap-2 font-display font-bold text-lg shrink-0">
          <Bike size={20} className="text-brand-accent-alt" />
          Lokl Rider
        </Link>
        <div className="flex items-center gap-2 min-w-0">
          {rider?.name && (
            <span className="hidden sm:block text-xs text-white/70 truncate max-w-[8rem]">{rider.name}</span>
          )}
          <button
            type="button"
            onClick={toggleOnline}
            disabled={togglingOnline}
            data-testid="rider-online-toggle"
            className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-bold transition disabled:opacity-60 shrink-0 ${
              rider?.online ? "bg-[#22C55E] text-white" : "bg-white/15 text-white"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${rider?.online ? "bg-white animate-pulse" : "bg-white/50"}`} />
            {rider?.online ? "Online" : "Offline"}
          </button>
          <button type="button" onClick={signOut} data-testid="rider-logout-btn" className="p-2 text-white/80 hover:text-white shrink-0">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="flex-1 flex flex-col" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {children}
      </main>
    </div>
  );
}
