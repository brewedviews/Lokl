import { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://www.shoplokl.in";
  const now = new Date();
  return [
    { url: base, lastModified: now, changeFrequency: "daily" as const, priority: 1.0 },
    { url: `${base}/products`, lastModified: now, changeFrequency: "daily" as const, priority: 0.9 },
    { url: `${base}/categories`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.8 },
    { url: `${base}/c/women`, lastModified: now, changeFrequency: "daily" as const, priority: 0.8 },
    { url: `${base}/c/men`, lastModified: now, changeFrequency: "daily" as const, priority: 0.8 },
    { url: `${base}/c/ethnic`, lastModified: now, changeFrequency: "daily" as const, priority: 0.8 },
    { url: `${base}/c/footwear`, lastModified: now, changeFrequency: "daily" as const, priority: 0.7 },
    { url: `${base}/c/kids`, lastModified: now, changeFrequency: "daily" as const, priority: 0.7 },
    { url: `${base}/c/accessories`, lastModified: now, changeFrequency: "daily" as const, priority: 0.7 },
    { url: `${base}/c/beauty`, lastModified: now, changeFrequency: "daily" as const, priority: 0.7 },
    { url: `${base}/c/sports`, lastModified: now, changeFrequency: "daily" as const, priority: 0.7 },
    { url: `${base}/c/lingerie`, lastModified: now, changeFrequency: "daily" as const, priority: 0.6 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.3 },
  ];
}
