import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence the monorepo workspace-root warning — this directory IS the root
  // for Next; the legacy /app/yarn.lock is for the CRA app sibling.
  turbopack: {
    root: __dirname,
  },

  async redirects() {
    return [
      { source: "/:path*", has: [{ type: "host", value: "shoplokl.in" }], destination: "/coming-soon.html", permanent: false },
      { source: "/:path*", has: [{ type: "host", value: "www.shoplokl.in" }], destination: "/coming-soon.html", permanent: false },
    ];
  },

  // Rewrite /api/* to the FastAPI backend. Lets the frontend speak in
  // relative URLs while keeping CORS simple and the prod CDN cache happy.
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
};

export default nextConfig;
