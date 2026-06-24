"use client";

/**
 * MerchantLayout — sidebar nav + per-route auth/approval guard.
 *
 * Guards (legacy App.js parity):
 *   • Public routes        : /merchant/login, /merchant/register
 *   • Protected (auth req.) : onboarding, kyc, dashboard
 *   • ApprovedOnly (kyc=="approved"): orders, storefront, bank, products, ai-studio, analytics
 *
 * Iter-26 — Hydration-wait pattern. Zustand-persist is async in the App
 * Router so `isAuthenticated` is briefly `false` after a hard refresh
 * even when a valid JWT lives in localStorage. The accreted complexity of
 * persist.hasHydrated() + getState() reads had a race window that bounced
 * approved merchants off /merchant/products. We replace that with the
 * "wait one render for setHydrated(true), then read state normally" pattern.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Toaster } from "sonner";
import { Package, LogOut, Store, BarChart3, FileText, Rocket, Bell, Landmark, ShoppingBag, Crown } from "lucide-react";
import { useMerchantAuthStore } from "@/stores";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { api } from "@/lib/api";
import { OnlineToggle } from "@/components/merchant/OnlineToggle";

type WinWithWebkit = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

function playOrderAlert(ctxRef: { current: AudioContext | null }) {
  try {
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as WinWithWebkit).webkitAudioContext;
      if (!AC) return;
      ctxRef.current = new AC();
    }
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const now = ctx.currentTime + 0.02;
    [880, 880, 1100].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      const t = now + i * 0.5;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.8, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.5);
    });
  } catch { /* noop */ }
}

const PUBLIC = ["/merchant/login", "/merchant/register"];
const APPROVED_ONLY = [
  "/merchant/orders", "/merchant/storefront", "/merchant/bank",
  "/merchant/products", "/merchant/analytics", "/merchant/subscription",
];

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isOnline, setIsOnline] = useState(true);

  const user = useMerchantAuthStore((s) => s.user);
  const token = useMerchantAuthStore((s) => s.token);
  const isAuthed = useMerchantAuthStore((s) => s.isAuthenticated);
  const setAuth = useMerchantAuthStore((s) => s.setAuth);
  const clearAuth = useMerchantAuthStore((s) => s.clearAuth);

  const isPublic = PUBLIC.includes(pathname);
  const isApproved = user?.kyc_status === "approved";
  const userKnown = !!user;

  const prevOrderIds = useRef<Set<string>>(new Set());
  const alertAudioRef = useRef<AudioContext | null>(null);
  const initialPollDone = useRef(false);
  const userInteractedRef = useRef(false);

  useEffect(() => {
    if (!isPublic) document.title = "Lokl.shop — Merchant Dashboard";
  }, [isPublic]);

  // Step 1 — wait one render for Zustand persist to finish rehydrating.
  useEffect(() => { setHydrated(true); }, []);

  // Step 1b — stop showing the checking spinner once user identity is known.
  // Covers: public routes, no token, and user already in store.
  // The /auth/me path sets checking=false inside the fetch promise below.
  useEffect(() => {
    if (!hydrated) return;
    if (isPublic || !token || user) setChecking(false);
  }, [hydrated, isPublic, token, user]);

  useEffect(() => {
    const markInteracted = () => { userInteractedRef.current = true; };
    document.addEventListener("touchstart", markInteracted, { once: true });
    document.addEventListener("click", markInteracted, { once: true });
    return () => {
      document.removeEventListener("touchstart", markInteracted);
      document.removeEventListener("click", markInteracted);
    };
  }, []);

  useEffect(() => {
    if (!isApproved) return;
    const raw = typeof window !== "undefined" ? localStorage.getItem("lokl_merchant_auth") : null;
    if (!raw) return;
    let tok: string | null = null;
    try { tok = (JSON.parse(raw) as { state?: { token?: string } })?.state?.token ?? null; } catch { return; }
    if (!tok) return;
    fetch("/api/merchant/store/state", { headers: { Authorization: `Bearer ${tok}` } })
      .then(r => r.json())
      .then((d: { online?: boolean }) => { if (d.online !== undefined) setIsOnline(d.online); })
      .catch(() => {});
  }, [isApproved]);

  useHeartbeat("merchant", { mid: user?.id });

  // Step 2 — once hydrated, rehydrate the `user` object from /auth/me if we
  // only have a token (persisted state keeps token only to dodge the legacy
  // bf_token quota bug).
  useEffect(() => {
    if (!hydrated || isPublic || user || !token) return;
    let cancelled = false;
    api.auth.me().then((m) => {
      if (!cancelled && m) setAuth(token, m);
      if (!cancelled) setChecking(false);
    }).catch(() => {
      if (!cancelled) {
        clearAuth();
        router.replace("/merchant/login");
        setChecking(false);
      }
    });
    return () => { cancelled = true; };
  }, [hydrated, isPublic, user, token, setAuth, clearAuth, router]);

  // Order ping — runs on ALL merchant pages so the merchant hears new orders
  // regardless of which tab they're on. 15-second interval, no mute control here
  // (orders/page.tsx has the per-page mute toggle for when they're actively watching).
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    const poll = async () => {
      const raw = typeof window !== "undefined" ? localStorage.getItem("lokl_merchant_auth") : null;
      if (!raw) return;
      let tok: string | null = null;
      try { tok = (JSON.parse(raw) as { state?: { token?: string } })?.state?.token ?? null; } catch { return; }
      if (!tok) return;
      try {
        const resp = await fetch("/api/merchant/orders", { headers: { Authorization: `Bearer ${tok}` } });
        if (!resp.ok) return;
        const orders = (await resp.json()) as Array<{ id: string; status: string; my_state?: string }>;
        const newPending = orders.filter(
          (o) => (o.my_state === "pending" || o.status === "pending_merchant") && !prevOrderIds.current.has(o.id)
        );
        if (newPending.length > 0 && initialPollDone.current) {
          if (userInteractedRef.current) playOrderAlert(alertAudioRef);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try { new Notification("New order on Lokl", { body: `${newPending.length} new order(s) waiting` }); } catch { /* noop */ }
          }
        }
        orders.forEach((o) => prevOrderIds.current.add(o.id));
        initialPollDone.current = true;
      } catch { /* noop */ }
    };
    poll();
    const i = setInterval(poll, 15000);
    return () => clearInterval(i);
  }, []);

  // Step 3 — auth + approval guard. Only fires AFTER hydration so a hard
  // refresh on /merchant/products no longer bounces back to login.
  useEffect(() => {
    if (!hydrated || isPublic) return;
    if (!isAuthed) { router.replace("/merchant/login"); return; }
    if (userKnown && APPROVED_ONLY.includes(pathname) && !isApproved) {
      router.replace("/merchant/onboarding");
      return;
    }
    // Approved merchants should never be stuck on onboarding.
    if (userKnown && isApproved && pathname === "/merchant/onboarding") {
      router.replace("/merchant/orders");
    }
  }, [hydrated, isAuthed, isApproved, pathname, isPublic, userKnown, router]);

  if (isPublic) {
    return (<><Toaster position="top-center" richColors />{children}</>);
  }
  if (!hydrated || checking) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#E68910] border-t-transparent animate-spin" />
      </div>
    );
  }
  // After hydration, if we genuinely have no token the redirect-to-login
  // effect is already queued — render nothing meanwhile.
  if (!isAuthed) return null;

  const links: Array<{ to: string; label: string; icon: React.ComponentType<{ size?: number }>; disabled?: boolean }> = isApproved
    ? [
        { to: "/merchant/orders",       label: "Order requests",  icon: Bell },
        { to: "/merchant/products",     label: "Products",        icon: Package },
        { to: "/merchant/analytics",    label: "Sales analytics", icon: BarChart3 },
        { to: "/merchant/storefront",   label: "Storefront",      icon: Store },
        { to: "/merchant/bank",         label: "Bank details",    icon: Landmark },
        { to: "/merchant/subscription", label: "Subscription",    icon: Crown, disabled: true },
      ]
    : [
        { to: "/merchant/onboarding", label: "Onboarding", icon: Rocket },
        { to: "/merchant/kyc",        label: "KYC details", icon: FileText },
      ];

  const toggleOnline = async () => {
    const raw = typeof window !== "undefined" ? localStorage.getItem("lokl_merchant_auth") : null;
    if (!raw) return;
    let tok: string | null = null;
    try { tok = (JSON.parse(raw) as { state?: { token?: string } })?.state?.token ?? null; } catch { return; }
    if (!tok) return;
    const next = !isOnline;
    setIsOnline(next);
    try {
      await fetch("/api/merchant/store/online", {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ online: next }),
      });
    } catch { setIsOnline(!next); }
  };

  const signOut = async () => {
    try { await api.auth.logout(); } catch { /* ignore */ }
    clearAuth();
    router.replace("/merchant/login");
  };

  return (
    <div className="min-h-screen bg-white flex">
      <Toaster position="top-center" richColors />
      <aside data-testid="merchant-sidebar" className="hidden md:flex w-64 border-r border-card-border flex-col bg-brand-bg">
        <Link href="/merchant/orders" data-testid="merchant-logo" className="p-6 flex items-center gap-2 border-b border-card-border">
          <span className="font-display text-2xl font-bold text-brand-primary">
            lokl<span className="text-brand-accent">.</span>shop
          </span>
        </Link>
        <nav className="flex-1 p-3 space-y-1">
          {links.map((l) => {
            const isActive = pathname.startsWith(l.to);
            if (l.disabled) {
              return (
                <div key={l.to}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-card text-sm font-medium text-[#9CA3AF] cursor-not-allowed opacity-50 select-none"
                >
                  <l.icon size={16} />
                  <span className="flex-1">{l.label}</span>
                  <span className="text-[10px] bg-[#E5E2DC] text-[#9CA3AF] px-2 py-0.5 rounded-full font-medium">Soon</span>
                </div>
              );
            }
            return (
              <Link key={l.to} href={l.to}
                data-testid={`nav-${l.label.toLowerCase().replace(/\s/g, "-")}`}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-card text-sm font-medium transition ${
                  isActive ? "bg-brand-primary text-white" : "text-brand-primary hover:bg-white"
                }`}>
                <l.icon size={16} />
                <span className="flex-1">{l.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-card-border">
          {isApproved && (
            <div className="mb-2">
              <OnlineToggle />
            </div>
          )}
          <div className="px-3 py-2">
            <div className="text-[10px] text-text-muted uppercase">Signed in</div>
            <div className="font-semibold text-sm text-brand-primary truncate">{user?.store_name}</div>
            <div className="text-[10px] text-text-muted truncate">{user?.email}</div>
            <div className={`mt-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
              isApproved ? "bg-green-100 text-green-700" :
              user?.kyc_status === "submitted" ? "bg-brand-accent/15 text-brand-accent" :
              user?.kyc_status === "rejected" ? "bg-red-100 text-red-500" : "bg-card-border text-text-muted"
            }`}>
              KYC · {user?.kyc_status ?? "draft"}
            </div>
          </div>
          <button onClick={signOut} data-testid="logout-btn"
            className="w-full flex items-center gap-2 px-4 py-2 rounded-card text-sm hover:bg-white mt-2">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden pb-20 md:pb-0">{children}</main>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-[#E5E2DC] z-50 flex">
        {[
          { href: "/merchant/orders", icon: ShoppingBag, label: "Orders" },
          { href: "/merchant/products", icon: Package, label: "Products" },
          { href: "/merchant/storefront", icon: Store, label: "Store" },
          { href: "/merchant/analytics", icon: BarChart3, label: "Analytics" },
        ].map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={`flex-1 flex flex-col items-center py-2 gap-0.5 relative ${active ? "text-[#E68910]" : "text-[#595959]"}`}>
              {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[#E68910]" />}
              <Icon size={20} />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          );
        })}
        <button
          onClick={toggleOnline}
          className={`flex-1 flex flex-col items-center py-2 gap-0.5 ${isOnline ? "text-[#4CAF50]" : "text-[#9CA3AF]"}`}
        >
          <div className={`w-10 h-6 rounded-full flex items-center px-0.5 transition-colors ${isOnline ? "bg-[#4CAF50]" : "bg-[#E5E2DC]"}`}>
            <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${isOnline ? "translate-x-4" : "translate-x-0"}`} />
          </div>
          <span className="text-[10px] font-medium">{isOnline ? "Live" : "Offline"}</span>
        </button>
      </nav>
    </div>
  );
}
