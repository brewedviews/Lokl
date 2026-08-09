"use client";

/**
 * Customer-account layout. Mirrors the legacy CustomerAccount.jsx behavior:
 * unauthenticated users see the OTP login inline (no redirect to a separate
 * /login page). Authenticated users see the actual account pages.
 *
 * Iter-26 — Hydration-wait pattern. Zustand-persist is async in the App
 * Router; on a hard refresh `isAuthenticated` starts `false` for a tick.
 * Showing the login screen for ~16 ms feels like a flicker, so we render
 * a spinner until the persist callback fires.
 *
 * NOTE — `/account` is the one consumer-facing page outside the `(consumer)`
 * route group (see app/(consumer)/layout.tsx's comment for the systemic
 * bottom-nav-clearance fix); this layout renders its own ConsumerHeader +
 * StickyBottomNav rather than inheriting them, so it needs its own
 * `bottom-nav-safe` on `{children}` too — the page itself must NOT add its
 * own copy (would double the padding).
 */
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { ConsumerHeader } from "@/components/consumer/ConsumerHeader";
import { StickyBottomNav } from "@/components/consumer/StickyBottomNav";
import { ActiveOrderPill } from "@/components/consumer/ActiveOrderPill";
import { CustomerOtpLogin } from "@/components/consumer/CustomerOtpLogin";
import { useCustomerAuthStore } from "@/stores";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const isAuthed = useCustomerAuthStore((s) => s.isAuthenticated);

  useEffect(() => { setHydrated(true); }, []);

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-brand-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Toaster position="top-center" richColors />
      <ConsumerHeader />
      {isAuthed ? (
        <div className="bottom-nav-safe">{children}</div>
      ) : (
        <main className="min-h-[60vh] flex justify-center px-4 sm:px-8 pt-10 pb-16 bottom-nav-safe">
          <div className="w-full max-w-md">
            <CustomerOtpLogin
              title="Sign in"
              subtitle="Enter your number to view orders, addresses, and returns."
            />
          </div>
        </main>
      )}
      <ActiveOrderPill />
      <StickyBottomNav />
    </>
  );
}
