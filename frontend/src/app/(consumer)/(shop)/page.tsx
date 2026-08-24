import type { Metadata } from "next";
import { MarketplaceHomeClient } from "@/components/consumer/MarketplaceHomeClient";

export const metadata: Metadata = {
  title: "Lokl — Discover Local Fashion in Bhilai",
  description:
    "Shop from trusted Bhilai stores. Hand-picked fashion delivered in 45 minutes. Try-at-doorstep, easy returns.",
};

// G7 — "/" is the gender-neutral Marketplace Home now, a genuinely
// separate section composition from any L1 shopping page (see
// MarketplaceHomeClient's own top comment). Before G7 this rendered
// L1PageClient hardcoded to l1Id="l1-women" mode="home" — i.e. Home was
// Women's shopping page wearing a "home" label; that's retired.
export default function HomePage() {
  return <MarketplaceHomeClient />;
}
