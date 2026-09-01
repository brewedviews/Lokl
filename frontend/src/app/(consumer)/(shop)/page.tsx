import { MarketplaceHomeClient } from "@/components/consumer/MarketplaceHomeClient";

// No page-level `metadata` export here on purpose — the homepage IS the
// site default, so it should render root layout's default title/OG exactly
// ("Lokl — Your Neighbourhood, online.") rather than a page title that
// then gets "%s | Lokl" template-appended into a redundant double title
// (this page used to set its own "Lokl — Discover Local Fashion in
// Bhilai", which rendered as "...Bhilai | Lokl" — fixed 2026-09).
// G7 — "/" is the gender-neutral Marketplace Home now, a genuinely
// separate section composition from any L1 shopping page (see
// MarketplaceHomeClient's own top comment). Before G7 this rendered
// L1PageClient hardcoded to l1Id="l1-women" mode="home" — i.e. Home was
// Women's shopping page wearing a "home" label; that's retired.
export default function HomePage() {
  return <MarketplaceHomeClient />;
}
