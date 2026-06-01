import { Toaster } from "sonner";
import { ConsumerHeader } from "@/components/consumer/ConsumerHeader";
import { StickyBottomNav } from "@/components/consumer/StickyBottomNav";

/**
 * Consumer route-group layout. Wraps every public-facing page with the
 * sticky header (sourced from Zustand stores) + mobile bottom nav, plus the
 * global Sonner toaster. The bottom nav clearance (`pb-24` equivalent) is
 * applied at the page level via the `bottom-nav-safe` utility so individual
 * pages can opt out for full-bleed scenarios.
 */
export default function ConsumerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Toaster position="top-center" richColors />
      <ConsumerHeader />
      {children}
      <StickyBottomNav />
    </>
  );
}
