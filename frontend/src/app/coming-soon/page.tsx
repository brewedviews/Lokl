import type { Metadata } from "next";
import { ComingSoonClient } from "@/components/coming-soon/ComingSoonClient";

export const metadata: Metadata = {
  title: "Lokl — Your Neighbourhood, online.",
  description:
    "Lokl is coming soon to Bhilai — your neighbourhood's local stores, delivered fast, in one app. Join the waitlist to be first to shop, or register your store today.",
};

export default function ComingSoonPage() {
  return <ComingSoonClient />;
}
