import type { Metadata } from "next";
import Script from "next/script";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Lokl — Fashion from stores next door · Bhilai",
    template: "%s | Lokl Bhilai",
  },
  description: "Order fashion from your favourite Bhilai stores. Delivered in 30 minutes. Browse kurtas, jeans, sneakers, ethnic wear and more from local stores near you.",
  keywords: ["Bhilai fashion", "local stores Bhilai", "30 minute delivery", "kurta", "jeans", "ethnic wear", "Lokl"],
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "https://www.shoplokl.in",
    siteName: "Lokl",
    title: "Lokl — Fashion from stores next door · Bhilai",
    description: "Order fashion from your favourite Bhilai stores. Delivered in 30 minutes.",
    images: [
      {
        url: "https://res.cloudinary.com/doojqkyff/image/upload/q_auto/f_auto/v1781682248/n1elwepz_ChatGPT_Image_May_16_2026_06_29_23_PM_qmzld0.png",
        width: 1200,
        height: 630,
        alt: "Lokl — Fashion from stores next door in Bhilai",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lokl — Fashion from stores next door · Bhilai",
    description: "Order fashion from your favourite Bhilai stores. Delivered in 30 minutes.",
    images: ["https://res.cloudinary.com/doojqkyff/image/upload/q_auto/f_auto/v1781682248/n1elwepz_ChatGPT_Image_May_16_2026_06_29_23_PM_qmzld0.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
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
