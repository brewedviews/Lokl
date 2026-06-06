import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

// SEO defaults — Session D's metadata-per-page work will override these.
export const metadata: Metadata = {
  title: {
    default: "Lokl — Discover Local Fashion in Bhilai",
    template: "%s | Lokl",
  },
  description:
    "Shop from local fashion stores near you in Bhilai. Discover unique clothing, " +
    "accessories and more from neighbourhood boutiques.",
  keywords: [
    "local fashion", "bhilai shopping", "local stores bhilai",
    "fashion near me", "lokl",
  ],
  openGraph: {
    type: "website",
    locale: "en_IN",
    siteName: "Lokl",
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
      </body>
    </html>
  );
}
