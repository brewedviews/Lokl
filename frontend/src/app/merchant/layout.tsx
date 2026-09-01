import type { Metadata } from "next";
import { MerchantLayoutClient } from "./MerchantLayoutClient";

// Merchant portal brand tagline hierarchy (finalized 2026-09), independent
// of the customer site's — this layout is a server component specifically
// so it CAN export metadata (the previous client-only layout.tsx couldn't;
// see MerchantLayoutClient's doc comment). Every /merchant/* page inherits
// this title template unless it sets its own.
const SITE_URL = "https://merchant.shoplokl.in";
const TAGLINE = "Your store, now online.";
const DEFAULT_TITLE = `Lokl.shop — ${TAGLINE}`;
const DEFAULT_DESCRIPTION = "Bring your Bhilai store online — get discovered by nearby customers, take orders, and deliver in 45 minutes. Free to list, zero commission.";

export const metadata: Metadata = {
  title: {
    // `absolute` mirrors the admin layout's fix — without it, a /merchant/*
    // route with no title of its own (falling back to `default`) would
    // additionally pick up the root layout's "%s | Lokl" template on top,
    // e.g. "Lokl.shop — Your store, now online. | Lokl". In practice every
    // authenticated dashboard route currently gets its title overwritten
    // client-side (see MerchantLayoutClient's document.title effect), so
    // this is a defensive correctness fix rather than a currently-visible bug.
    default: DEFAULT_TITLE,
    absolute: DEFAULT_TITLE,
    template: "%s | Lokl.shop",
  },
  description: DEFAULT_DESCRIPTION,
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: SITE_URL,
    siteName: "Lokl.shop",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
};

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return <MerchantLayoutClient>{children}</MerchantLayoutClient>;
}
