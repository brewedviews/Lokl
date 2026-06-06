"use client";

/**
 * MerchantLayout — sidebar nav + per-route auth/approval guard.
 * Ported from legacy `components/merchant/MerchantLayout.jsx`.
 *
 * Guards (legacy App.js parity):
 *   • Public routes        : /merchant/login, /merchant/register
 *   • Protected (auth req.) : onboarding, kyc, dashboard
 *   • ApprovedOnly (kyc=="approved"): orders, storefront, bank, products, ai-studio, analytics
 *
 * Pre-approval routes:        sidebar shows Onboarding + KYC links only.
 * Approved routes:            sidebar shows Orders / Products / Analytics / Storefront / Bank + Online toggle.
 */
import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Toaster } from "sonner";
import { Package, LogOut, Store, BarChart3, FileText, Rocket, Bell, Landmark } from "lucide-react";
import { useMerchantAuthStore } from "@/stores";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { api } from "@/lib/api";

const PUBLIC = ["/merchant/login", "/merchant/register"];
const APPROVED_ONLY = [
  "/merchant/orders", "/merchant/storefront", "/merchant/bank",
  "/merchant/products", "/merchant/ai-studio", "/merchant/analytics",
];

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useMerchantAuthStore((s) => s.user);
  const isAuthed = useMerchantAuthStore((s) => s.isAuthenticated);
  const clearAuth = useMerchantAuthStore((s) => s.clearAuth);

  const isPublic = PUBLIC.includes(pathname);
  const isApproved = user?.kyc_status === "approved";

  useHeartbeat("merchant", { mid: user?.id });

  useEffect(() => {
    if (isPublic) return;
    if (!isAuthed) { router.replace("/merchant/login"); return; }
    if (APPROVED_ONLY.includes(pathname) && !isApproved) {
      router.replace("/merchant/onboarding");
    }
  }, [isAuthed, isApproved, pathname, isPublic, router]);

  if (isPublic) {
    return (<><Toaster position="top-center" richColors />{children}</>);
  }
  if (!isAuthed) return null; // router.replace in flight

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
