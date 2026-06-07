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
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Toaster } from "sonner";
import { Package, LogOut, Store, BarChart3, FileText, Rocket, Bell, Landmark } from "lucide-react";
import { useMerchantAuthStore } from "@/stores";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { api } from "@/lib/api";
import { OnlineToggle } from "@/components/merchant/OnlineToggle";

const PUBLIC = ["/merchant/login", "/merchant/register"];
const APPROVED_ONLY = [
  "/merchant/orders", "/merchant/storefront", "/merchant/bank",
  "/merchant/products", "/merchant/ai-studio", "/merchant/analytics",
];

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);

  const user = useMerchantAuthStore((s) => s.user);
  const token = useMerchantAuthStore((s) => s.token);
  const isAuthed = useMerchantAuthStore((s) => s.isAuthenticated);
  const setAuth = useMerchantAuthStore((s) => s.setAuth);
  const clearAuth = useMerchantAuthStore((s) => s.clearAuth);

  const isPublic = PUBLIC.includes(pathname);
  const isApproved = user?.kyc_status === "approved";
  const userKnown = !!user;

  // Step 1 — wait one render for Zustand persist to finish rehydrating.
  useEffect(() => { setHydrated(true); }, []);

  useHeartbeat("merchant", { mid: user?.id });

  // Step 2 — once hydrated, rehydrate the `user` object from /auth/me if we
  // only have a token (persisted state keeps token only to dodge the legacy
  // bf_token quota bug).
  useEffect(() => {
    if (!hydrated || isPublic || user || !token) return;
    let cancelled = false;
    api.auth.me().then((m) => {
      if (!cancelled && m) setAuth(token, m);
    }).catch(() => {
      if (!cancelled) {
        clearAuth();
        router.replace("/merchant/login");
      }
    });
    return () => { cancelled = true; };
  }, [hydrated, isPublic, user, token, setAuth, clearAuth, router]);

  // Step 3 — auth + approval guard. Only fires AFTER hydration so a hard
  // refresh on /merchant/products no longer bounces back to login.
  useEffect(() => {
    if (!hydrated || isPublic) return;
    if (!isAuthed) { router.replace("/merchant/login"); return; }
    if (userKnown && APPROVED_ONLY.includes(pathname) && !isApproved) {
      router.replace("/merchant/onboarding");
    }
  }, [hydrated, isAuthed, isApproved, pathname, isPublic, userKnown, router]);

  if (isPublic) {
    return (<><Toaster position="top-center" richColors />{children}</>);
  }
  if (!hydrated) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-brand-primary border-t-transparent animate-spin" />
      </div>
    );
  }
  // After hydration, if we genuinely have no token the redirect-to-login
  // effect is already queued — render nothing meanwhile.
  if (!isAuthed) return null;

  const links = isApproved
    ? [
        { to: "/merchant/orders",     label: "Order requests",  icon: Bell },
        { to: "/merchant/products",   label: "Products",        icon: Package },
        { to: "/merchant/analytics",  label: "Sales analytics", icon: BarChart3 },
        { to: "/merchant/storefront", label: "Storefront",      icon: Store },
        { to: "/merchant/bank",       label: "Bank details",    icon: Landmark },
      ]
    : [
        { to: "/merchant/onboarding", label: "Onboarding", icon: Rocket },
        { to: "/merchant/kyc",        label: "KYC details", icon: FileText },
      ];

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
            lokl<span className="text-brand-accent">.</span>
          </span>
        </Link>
        <nav className="flex-1 p-3 space-y-1">
          {links.map((l) => {
            const isActive = pathname.startsWith(l.to);
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
      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
