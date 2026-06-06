import { ImageResponse } from "next/og";
import { serverFetch } from "@/lib/server-fetch";
import type { Product } from "@/types";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Lokl product preview";

const BRAND_BG = "#FDFBF7";
const BRAND_PRIMARY = "#0A1F5C";
const BRAND_ACCENT = "#F59E0B";
const TEXT_MUTED = "#64748B";

interface PDPResp { product?: Product }

export default async function ProductOG(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await serverFetch<PDPResp>(`/api/products/${id}`);
  const product = data?.product;

  if (!product) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: BRAND_BG, fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 72, fontWeight: 700, color: BRAND_PRIMARY, display: "flex" }}>
          lokl<span style={{ color: BRAND_ACCENT }}>.</span>
        </div>
      </div>,
      { ...size },
    );
  }

  const discount = product.mrp && product.price < product.mrp
    ? Math.round((1 - product.price / product.mrp) * 100) : 0;

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: BRAND_BG, fontFamily: "sans-serif", position: "relative" }}>
      <div style={{ position: "absolute", top: 0, right: 0, width: "55%", height: "100%", backgroundColor: BRAND_PRIMARY, transform: "skewX(-8deg) translateX(60px)", display: "flex" }} />
      <div style={{ position: "absolute", top: 70, left: 70, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 56, fontWeight: 700, color: BRAND_PRIMARY, letterSpacing: "-0.02em", display: "flex" }}>
          lokl<span style={{ color: BRAND_ACCENT }}>.</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: BRAND_ACCENT, letterSpacing: "0.25em", textTransform: "uppercase", display: "flex", marginTop: 12 }}>BHILAI</div>
      </div>

      <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "180px 80px 80px 80px", gap: 20, maxWidth: 1000 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: BRAND_ACCENT, letterSpacing: "0.22em", textTransform: "uppercase", display: "flex" }}>
          {product.store_name || "Local store"}
        </div>
        <div style={{ fontSize: 64, fontWeight: 800, color: BRAND_PRIMARY, lineHeight: 1.08, display: "flex", maxWidth: 900 }}>
          {product.name.length > 70 ? product.name.slice(0, 68) + "…" : product.name}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
          <div style={{ fontSize: 56, color: BRAND_PRIMARY, fontWeight: 800, display: "flex" }}>
            ₹{Number(product.price).toLocaleString("en-IN")}
          </div>
          {product.mrp && product.mrp > product.price && (
            <div style={{ fontSize: 28, color: TEXT_MUTED, textDecoration: "line-through", display: "flex" }}>
              ₹{Number(product.mrp).toLocaleString("en-IN")}
            </div>
          )}
          {discount > 0 && (
            <div style={{ fontSize: 24, color: "#10B981", fontWeight: 700, display: "flex" }}>
              {discount}% off
            </div>
          )}
        </div>
        <div style={{ fontSize: 22, color: TEXT_MUTED, display: "flex", marginTop: 8 }}>
          Delivered in {product.store_eta_min ?? 45} minutes · Try-at-doorstep
        </div>
      </div>
    </div>,
    { ...size },
  );
}
