import { Toaster } from "sonner";
import { ConsumerHeader } from "@/components/consumer/ConsumerHeader";
import { StickyBottomNav } from "@/components/consumer/StickyBottomNav";
import { LocationBanner } from "@/components/consumer/LocationBanner";
import { SearchOverlayHost } from "@/components/consumer/SearchOverlayHost";

/**
 * Consumer route-group layout. Wraps every public-facing page with the
 * sticky header (sourced from Zustand stores) + mobile bottom nav, plus the
 * global Sonner toaster. The bottom nav clearance (`pb-24` equivalent) is
 * applied at the page level via the `bottom-nav-safe` utility so individual
 * pages can opt out for full-bleed scenarios.
 *
 * Iter-45 — `LocationBanner` mounts directly under the header; it's a no-op
 * for shoppers in the Bhilai footprint and surfaces a soft warning otherwise.
 */
export default function ConsumerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Toaster position="top-center" richColors />
      <ConsumerHeader />
      <LocationBanner />
      {children}
      <StickyBottomNav />
      <SearchOverlayHost />
    </>
  );
}
