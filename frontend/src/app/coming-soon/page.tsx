import type { Metadata } from "next";
import { ComingSoonClient } from "@/components/coming-soon/ComingSoonClient";

export const metadata: Metadata = {
  title: "Lokl — Your neighbourhood, online.",
  description:
    "Lokl is coming soon to Bhilai — local stores, local delivery, one app. Join the waitlist to be first to shop, or register your store today.",
};

export default function ComingSoonPage() {
  return <ComingSoonClient />;
}
