"use client";

/**
 * Customer-account layout. Mirrors the legacy CustomerAccount.jsx behavior:
 * unauthenticated users see the OTP login inline (no redirect to a separate
 * /login page). Authenticated users see the actual account pages.
 *
 * Auth state is sourced from useCustomerAuthStore so cross-tab + cross-app
 * (legacy ↔ Next.js) login state flows automatically via the
 * `customer-auth:change` event listener already wired in the store.
 */
import { Toaster } from "sonner";
import { ConsumerHeader } from "@/components/consumer/ConsumerHeader";
import { StickyBottomNav } from "@/components/consumer/StickyBottomNav";
import { CustomerOtpLogin } from "@/components/consumer/CustomerOtpLogin";
import { useCustomerAuthStore } from "@/stores";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const isAuthed = useCustomerAuthStore((s) => s.isAuthenticated);

  return (
    <>
      <Toaster position="top-center" richColors />
      <ConsumerHeader />
      {isAuthed ? (
        children
      ) : (
        <main className="min-h-[60vh] flex justify-center px-4 sm:px-8 pt-10 pb-16">
          <div className="w-full max-w-md">
            <CustomerOtpLogin
              title="Sign in"
              subtitle="Enter your number to view orders, addresses, and returns."
            />
          </div>
        </main>
      )}
      <StickyBottomNav />
    </>
  );
}
