import { ImageResponse } from "next/og";
import { serverFetch } from "@/lib/server-fetch";
import type { Brand } from "@/types";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Lokl brand preview";

const BRAND_BG = "#FDFBF7";
const BRAND_PRIMARY = "#0A1F5C";
const BRAND_ACCENT = "#E68910";
const TEXT_MUTED = "#64748B";

interface BrandResp { brand?: Brand }

export default async function BrandOG(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const data = await serverFetch<BrandResp>(`/api/brands/${slug}`);
  const brand = data?.brand;
  // Denormalized field on the brand doc itself — no need for a second
  // products fetch just to count them for a generated preview image.
  const productCount = brand?.product_count ?? 0;

  if (!brand) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: BRAND_BG, fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 72, fontWeight: 700, color: BRAND_PRIMARY, display: "flex" }}>
          lokl<span style={{ color: BRAND_ACCENT }}>.</span>
        </div>
      </div>,
      { ...size },
    );
  }

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: BRAND_PRIMARY, fontFamily: "sans-serif", padding: "80px", color: "white", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 48, fontWeight: 700, color: "white", display: "flex" }}>
          lokl<span style={{ color: BRAND_ACCENT }}>.</span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: BRAND_ACCENT, letterSpacing: "0.28em", textTransform: "uppercase", display: "flex", marginTop: 8 }}>BRAND</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 24 }}>
        <div style={{ fontSize: 84, fontWeight: 800, color: "white", lineHeight: 1.06, display: "flex", maxWidth: 1000 }}>
          {brand.name.length > 36 ? brand.name.slice(0, 34) + "…" : brand.name}
        </div>
        {brand.description && (
          <div style={{ fontSize: 32, color: "rgba(255,255,255,0.85)", display: "flex", maxWidth: 1000 }}>
            {brand.description.length > 80 ? brand.description.slice(0, 78) + "…" : brand.description}
          </div>
        )}
        <div style={{ fontSize: 22, color: BRAND_ACCENT, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", display: "flex" }}>
          {productCount} product{productCount === 1 ? "" : "s"} available
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 60, right: 80, fontSize: 18, color: TEXT_MUTED, display: "flex" }}>
        Shop now on lokl.in
      </div>
    </div>,
    { ...size },
  );
}
