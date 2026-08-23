import type { Metadata } from "next";
import { L1PageClient } from "@/components/consumer/L1PageClient";

export const metadata: Metadata = {
  title: "Lokl — Discover Local Fashion in Bhilai",
  description:
    "Shop from trusted Bhilai stores. Hand-picked fashion delivered in 45 minutes. Try-at-doorstep, easy returns.",
};

// Women is Home's explicit default L1 — a fixed choice, not derived from
// anything dynamic (see L1PageClient's own doc comment on why Home
// unconditionally passes l1-women). mode="home" suppresses the L2 filter
// grid + inline "Browse all" product grid that /c/[slug] renders — Home
// never had that block before Phase E's unification and still doesn't.
export default function HomePage() {
  return <L1PageClient l1Id="l1-women" mode="home" />;
}
