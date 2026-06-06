import type { Metadata } from "next";
import { HomeClient } from "@/components/consumer/HomeClient";

export const metadata: Metadata = {
  title: "Lokl — Discover Local Fashion in Bhilai",
  description:
    "Shop from trusted Bhilai stores. Hand-picked fashion delivered in 30–45 minutes. Try-at-doorstep, easy returns.",
};

export default function HomePage() {
  return <HomeClient />;
}
