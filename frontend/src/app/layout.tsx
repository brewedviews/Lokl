import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import Script from "next/script";
import { Providers } from "./providers";
import "./globals.css";

// DM Sans — PDP ribbon-tag bold uppercase text only (spec-mandated font for
// that one element); everything else keeps the existing Fontshare Satoshi.
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-dm-sans-raw",
  display: "swap",
});

// Brand tagline hierarchy (finalized 2026-09): the customer site's title
// default + OG/Twitter carry the tagline itself; individual pages prepend
// their own context via the "%s | Lokl" template rather than repeating it.
const SITE_URL = "https://www.shoplokl.in";
const TAGLINE = "Your Neighbourhood, online.";
const DEFAULT_TITLE = `Lokl — ${TAGLINE}`;
const DEFAULT_DESCRIPTION = "Discover and order from independent local stores near you in Bhilai — delivered in 45 minutes. Your neighbourhood shops, now online.";
const OG_IMAGE = "https://res.cloudinary.com/doojqkyff/image/upload/q_auto/f_auto/v1781682248/n1elwepz_ChatGPT_Image_May_16_2026_06_29_23_PM_qmzld0.png";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: "%s | Lokl",
  },
  description: DEFAULT_DESCRIPTION,
  keywords: ["Bhilai local shopping", "neighbourhood stores Bhilai", "45 minute delivery", "hyperlocal marketplace", "Lokl"],
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: SITE_URL,
    siteName: "Lokl",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: DEFAULT_TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [OG_IMAGE],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={dmSans.variable}>
      <head>
        {/* Fontshare — Clash Display (h1-h4) + Satoshi (body). Loaded via
            <link> not @import because the Tailwind v4 entry expands inline
            and CSS spec forbids @import after any rule. */}
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=clash-display@600,700,500&f[]=satoshi@400,500,700&display=swap"
        />
      </head>
      <body className="antialiased">
        <Providers>{children}</Providers>
        {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}', {
                  page_path: window.location.pathname,
                  currency: 'INR',
                });
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
