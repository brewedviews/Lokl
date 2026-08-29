import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence the monorepo workspace-root warning — this directory IS the root
  // for Next; the legacy /app/yarn.lock is for the CRA app sibling.
  turbopack: {
    root: __dirname,
  },

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001"}/api/:path*`,
      },
    ];
  },

  // next/image whitelist. Storage host comes from env so staging/prod can
  // override without code changes.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      // `*.emergentagent.com` below covers the preview host AND the production
      // `*.emergent.host`-served frontend's images proxy — no env-specific entry needed.
      { protocol: "https", hostname: "customer-assets.emergentagent.com" },
      { protocol: "https", hostname: "*.emergentagent.com" },
      { protocol: "https", hostname: "*.emergent.host" },
      { protocol: "https", hostname: "*.amazonaws.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "images.pexels.com" },
      { protocol: "https", hostname: "cdn.lokl.in" },
      { protocol: "https", hostname: "res.cloudinary.com" },
      ...(process.env.NEXT_PUBLIC_STORAGE_HOST
        ? [{ protocol: "https" as const, hostname: process.env.NEXT_PUBLIC_STORAGE_HOST }]
        : []),
    ],
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },

  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,

  // standalone output is used by the production Docker image (Task 12).
  output: "standalone",

  // Security fix (audit Medium finding): the frontend previously shipped
  // zero custom security headers of its own, relying entirely on
  // whatever the hosting platform injects by default. This is a
  // pragmatic, Next.js-compatible baseline — NOT a strict/nonce-based
  // CSP, which would need real testing against hydration/inline scripts
  // and is a bigger lift than this security pass calls for. Backend API
  // responses already have their own SecurityHeadersMiddleware
  // (unchanged, untouched here) — this only covers documents served by
  // Next.js itself.
  //
  // Allowances, and why each is needed:
  //   script-src 'unsafe-inline' 'unsafe-eval' — Next.js's own hydration
  //     bootstrap and the inline Google Analytics snippet in layout.tsx
  //     both need this; tightening to a nonce-based CSP is real future
  //     work, not a drop-in change.
  //   script-src https://checkout.razorpay.com https://cdn.razorpay.com —
  //     the Razorpay Checkout script (useRazorpay.ts) plus the secondary
  //     risk-detection bundle it loads itself once the modal opens
  //     (found via a live console-error check, not assumed).
  //   script-src https://www.googletagmanager.com — GA's gtag.js.
  //   style-src 'unsafe-inline' — Tailwind/CSS-in-JS inline styles.
  //   style-src https://api.fontshare.com — Clash Display/Satoshi are
  //     loaded via a Fontshare stylesheet link in layout.tsx (next/font
  //     only self-hosts DM Sans; confirmed the other two are NOT
  //     build-time-bundled via a live console-error check, not assumed).
  //   font-src https://cdn.fontshare.com — the actual font files
  //     Fontshare's stylesheet references.
  //   img-src https: data: — Cloudinary, Unsplash, and the other remote
  //     image hosts already allow-listed under `images.remotePatterns`
  //     above; a broad https: here avoids keeping two host lists in sync.
  //   connect-src https://api.razorpay.com https://lumberjack.razorpay.com
  //     — Razorpay Checkout's own network calls during payment.
  //   connect-src https://*.sentry.io — error reporting (SentryBoot.tsx),
  //     dynamically imported but still needs to reach its ingest endpoint.
  //   connect-src https://www.google-analytics.com — GA pageview/event
  //     beacons.
  //   frame-src https://checkout.razorpay.com https://api.razorpay.com —
  //     the Razorpay Checkout modal itself runs in an iframe.
  //   connect-src 'self' — the app's own /api/* calls proxy through the
  //     Next.js rewrite above (relative baseURL, see api-client.ts's own
  //     comment on why — same-origin, not a separate allowance).
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://cdn.razorpay.com https://www.googletagmanager.com",
      "style-src 'self' 'unsafe-inline' https://api.fontshare.com",
      "img-src 'self' data: https:",
      "font-src 'self' data: https://cdn.fontshare.com",
      "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://*.sentry.io https://www.google-analytics.com https://www.googletagmanager.com",
      "frame-src https://checkout.razorpay.com https://api.razorpay.com",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
