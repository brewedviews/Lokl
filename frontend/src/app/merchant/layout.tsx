"use client";

/**
 * MerchantLayout — sidebar nav + per-route auth/onboarding-state guard.
 *
 * Guards:
 *   • Public routes                       : /merchant/login, /merchant/register
 *   • Protected, always reachable         : onboarding, kyc, dashboard (unlinked, see below)
 *   • KYC_GATE_ONLY (KYC approved)        : storefront (creating/editing the shop)
 *   • SHOP_GATE (shop already exists)     : orders, products, analytics, bank, integrations, subscription
 *
 * Both gates read the SAME live GET /merchant/onboarding-status the
 * onboarding hub polls — never a locally-cached snapshot. This used to read
 * `user.kyc_status` off the Zustand store, which is set once at login/
 * registration and never refreshed after approval; that mismatch is what
 * caused an approved merchant clicking "Continue with Set up your shop" to
 * bounce straight back to /merchant/onboarding. `_merchant_next_route()` and
 * `_merchant_onboarding_status()` on the backend read the same underlying
 * data, so this layout, the hub, and login/signup redirects can never
 * disagree about where a merchant belongs.
 *
 * Dashboard is deliberately out of the active merchant journey: not in
 * either gate list, never linked from nav, never a redirect target — see
 * app/merchant/dashboard/page.tsx's own history for why. Its route still
 * technically works if visited directly; nothing else depends on removing
 * that.
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
import { Package, LogOut, Store, BarChart3, Rocket, Bell, Landmark, ShoppingBag, Crown, Boxes } from "lucide-react";
import { useMerchantAuthStore } from "@/stores";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { api } from "@/lib/api";
import { OnlineToggle } from "@/components/merchant/OnlineToggle";
import type { Order } from "@/types";
import type { OnboardingStatusResponse } from "@/lib/api/merchant";

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

// '/' is included because merchant.shoplokl.in's bare root is rewritten by
// middleware.ts to /merchant/register — but rewrites are invisible to the
// client, so usePathname() below still reports '/' after hydration. Safe to
// treat as public here specifically: this layout only ever wraps pages
// physically under app/merchant/*, so pathname === '/' inside THIS file can
// only mean the subdomain-rewritten register page is rendering, never a real
// consumer route (the actual '/' consumer homepage lives under the sibling
// app/(consumer)/ tree and is never wrapped by this layout at all).
const PUBLIC = ["/merchant/login", "/merchant/register", "/"];
// Two-tier route gating, sourced from the SAME live /merchant/onboarding-
// status the onboarding hub itself polls — not a locally-cached snapshot.
// This is the fix for the "Set up your shop -> bounces back to onboarding"
// bug: the old guard read `user.kyc_status`, a Zustand value set once at
// login/registration and never refreshed after approval, so it could
// contradict the hub's own (correct, live) view of the merchant's state.
//
//   KYC_GATE_ONLY  — needs KYC approved, but NOT a shop yet (this is
//                    literally the page used to create one).
//   SHOP_GATE      — needs a shop to already exist. Gated on shop
//                    existence, not product count — a merchant with 0
//                    products still needs to reach /merchant/products.
// /merchant/dashboard is intentionally in neither list — it's out of the
// active merchant journey (never linked, never a redirect target) but not
// newly locked down either; see the layout's nav arrays below.
const KYC_GATE_ONLY = ["/merchant/storefront"];
const SHOP_GATE = [
  "/merchant/orders", "/merchant/bank", "/merchant/products",
  "/merchant/analytics", "/merchant/subscription", "/merchant/integrations",
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
  // Live, authoritative onboarding state — see KYC_GATE_ONLY/SHOP_GATE
  // comment above for why this replaces the old `user.kyc_status` read.
  const [obStatus, setObStatus] = useState<OnboardingStatusResponse | null>(null);
  // Which pathname `obStatus` was actually fetched for. A save that just
  // unlocked a new route (e.g. storefront save creating the shop, then
  // router.replace("/merchant/products")) changes `pathname` before the
  // fresh refetch below resolves — if the guard judged the new route by
  // `obStatus` fetched for the OLD route, it would see "no shop yet" and
  // bounce straight back to onboarding, immediately after the merchant did
  // the exact thing that was supposed to unlock it. `awaitingFreshConfirmation`
  // below exists specifically to close that window.
  const [obStatusFor, setObStatusFor] = useState<string | null>(null);
  const kycApproved = obStatus?.verify_business.status === "completed";
  const shopExists = obStatus?.setup_shop.status === "completed";
  const staleSaysBlocked = !!obStatus && (
    (KYC_GATE_ONLY.includes(pathname) && !kycApproved) ||
    (SHOP_GATE.includes(pathname) && !shopExists)
  );
  // Only wait for a fresh, this-exact-route confirmation when the data we
  // have would otherwise redirect the merchant away — an already-unlocked
  // route (the overwhelming majority of navigations) never waits at all.
  const awaitingFreshConfirmation = staleSaysBlocked && obStatusFor !== pathname;
  // Fallback only for the sidebar's KYC badge before the first fetch
  // resolves — never used for gating.
  const isApproved = user?.kyc_status === "approved";
  const kycBadge = obStatus
    ? {
        completed: { label: "approved", tone: "approved" },
        in_review: { label: "submitted", tone: "submitted" },
        needs_changes: { label: "action needed", tone: "needs_changes" },
        not_started: { label: "draft", tone: "draft" },
      }[obStatus.verify_business.status] ?? { label: "draft", tone: "draft" }
    : { label: user?.kyc_status ?? "draft", tone: isApproved ? "approved" : "draft" };

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
    if (!shopExists) return;
    // Routed through apiClient (not raw fetch) so an expired access token is
    // silently refreshed-and-retried instead of leaving `isOnline` stuck on
    // its optimistic `true` default when this call fails (G12 P0 fix — the
    // frontend/reality desync that made the store *look* offline/online
    // independent of the real server-side value).
    api.merchant.storeState()
      .then((d) => { if (d.online !== undefined) setIsOnline(d.online); })
      .catch(() => {});
  }, [shopExists]);

  // Single authoritative fetch of live merchant state — on mount and again
  // on every route change, so a guard evaluated right after a CTA
  // navigation (e.g. onboarding -> storefront) never uses data from before
  // the merchant's KYC/shop state changed. Deliberately does NOT clear
  // obStatus while refetching (no spinner-per-navigation) — the previous
  // value is correct far more often than not, and the fetch below still
  // corrects it in the background.
  useEffect(() => {
    if (!hydrated || isPublic || !isAuthed) return;
    let cancelled = false;
    const forPathname = pathname;
    api.merchant.onboardingStatus().then((s) => {
      if (cancelled) return;
      setObStatus(s);
      setObStatusFor(forPathname);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [hydrated, isPublic, isAuthed, pathname]);

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
      // Routed through apiClient — a raw fetch here silently 401ed forever
      // once the access token expired (empty catch swallowed it), starving
      // the merchant of new-order alerts until something else forced a
      // reload. apiClient's interceptor refreshes-and-retries transparently.
      try {
        // `my_state` isn't on the shared Order type (it's a per-merchant
        // flattening the backend adds only on this listing endpoint) — same
        // cast orders/page.tsx already uses for the identical response shape.
        const orders = await api.merchant.listOrders() as Array<Order & { my_state?: string }>;
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
  //
  // Both gates read `obStatus` (the live /merchant/onboarding-status
  // response), never the cached `user` object — see KYC_GATE_ONLY/SHOP_GATE
  // above for why. Never redirects while `awaitingFreshConfirmation` is
  // true — that's the exact window right after a save that may have JUST
  // unlocked this route (see its own comment above).
  useEffect(() => {
    if (!hydrated || isPublic) return;
    if (!isAuthed) { router.replace("/merchant/login"); return; }
    if (!obStatus || awaitingFreshConfirmation) return;
    if (staleSaysBlocked) {
      router.replace("/merchant/onboarding");
    }
  }, [hydrated, isAuthed, isPublic, obStatus, staleSaysBlocked, awaitingFreshConfirmation, router]);

  if (isPublic) {
    return (<><Toaster position="top-center" richColors />{children}</>);
  }
  if (!hydrated || checking || (isAuthed && (!obStatus || awaitingFreshConfirmation))) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#E68910] border-t-transparent animate-spin" />
      </div>
    );
  }
  // After hydration, if we genuinely have no token the redirect-to-login
  // effect is already queued — render nothing meanwhile.
  if (!isAuthed) return null;

  // Minimal onboarding shell until shop setup is complete — no Dashboard,
  // no separate "KYC details" destination (verifying business is part of
  // the onboarding journey, not a distinct app section). Full operational
  // nav unlocks the moment a shop exists, regardless of product count.
  const links: Array<{ to: string; label: string; icon: React.ComponentType<{ size?: number }>; disabled?: boolean }> = shopExists
    ? [
        { to: "/merchant/orders",       label: "Order requests",  icon: Bell },
        { to: "/merchant/products",     label: "Products",        icon: Package },
        { to: "/merchant/analytics",    label: "Sales analytics", icon: BarChart3 },
        { to: "/merchant/storefront",   label: "Shop settings",   icon: Store },
        { to: "/merchant/integrations", label: "Integrations",    icon: Boxes },
        { to: "/merchant/bank",         label: "Bank details",    icon: Landmark },
        { to: "/merchant/subscription", label: "Subscription",    icon: Crown, disabled: true },
      ]
    : [
        { to: "/merchant/onboarding", label: "Onboarding", icon: Rocket },
      ];

  const toggleOnline = async () => {
    const next = !isOnline;
    setIsOnline(next);
    try {
      await api.merchant.setOnline(next);
    } catch {
      setIsOnline(!next);
    }
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
          {shopExists && (
            <div className="mb-2">
              <OnlineToggle />
            </div>
          )}
          <div className="px-3 py-2">
            <div className="text-[10px] text-text-muted uppercase">Signed in</div>
            <div className="font-semibold text-sm text-brand-primary truncate">{user?.store_name}</div>
            <div className="text-[10px] text-text-muted truncate">{user?.email}</div>
            <div className={`mt-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
              kycBadge.tone === "approved" ? "bg-green-100 text-green-700" :
              kycBadge.tone === "submitted" ? "bg-brand-accent/15 text-brand-accent" :
              kycBadge.tone === "needs_changes" ? "bg-red-100 text-red-500" : "bg-card-border text-text-muted"
            }`}>
              KYC · {kycBadge.label}
            </div>
          </div>
          <button onClick={signOut} data-testid="logout-btn"
            className="w-full flex items-center gap-2 px-4 py-2 rounded-card text-sm hover:bg-white mt-2">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden pb-20 md:pb-0">{children}</main>
      {/* Mirrors the desktop sidebar's minimal-vs-full split — no operational
          tab bar until a shop exists, so mobile never shows a materially
          different (and contradictory) nav than desktop during onboarding. */}
      {shopExists && (
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
      )}
    </div>
  );
}
