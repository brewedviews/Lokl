import type { Metadata } from "next";
import { PriceChip } from "@/components/design-system/PriceChip";
import { ProductCutoutCard } from "@/components/design-system/ProductCutoutCard";
import { StoreCard } from "@/components/design-system/StoreCard";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Layer 1 design-system review page. Scratch route, not linked from any
 * nav — for isolated visual review of the foundation tokens + 3 core
 * components before homepage sections are built on top of them.
 */

const DEMO_PRODUCTS = [
  { id: "demo-1", name: "Organic Bananas, 1 dozen", price: 79, mrp: 99,
    image: "https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=600&q=80" },
  { id: "demo-2", name: "Wireless Over-Ear Headphones", price: 2499, mrp: 3999,
    image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80" },
  { id: "demo-3", name: "Cotton Kurta — Navy", price: 899, mrp: null,
    image: "https://images.unsplash.com/photo-1622470953794-aa9c70b0fb9d?w=600&q=80" },
  { id: "demo-4", name: "Matte Lipstick Duo", price: 449, mrp: 599,
    image: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&q=80" },
];

const DEMO_STORES = [
  { id: "demo-store-1", name: "Bunto General Store", distanceKm: 0.9, isOpen: true,
    storefrontImage: "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=800&q=80" },
  { id: "demo-store-2", name: "Sharma Electronics", distanceKm: 2.1, isOpen: false,
    opensAtLabel: "10:00 AM", storefrontImage: null },
];

function Swatch({ label, hex, textOn = "text-white" }: { label: string; hex: string; textOn?: string }) {
  return (
    <div className="space-y-1.5">
      <div
        className={`h-16 rounded-card flex items-end p-2 ${textOn} text-meta font-medium`}
        style={{ backgroundColor: hex }}
      >
        {hex}
      </div>
      <p className="text-meta text-brand-primary/60">{label}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-section-header font-medium text-brand-primary">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <div className="min-h-screen bg-surface-page">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-16">
        <header className="space-y-2">
          <h1 className="text-display font-medium text-brand-primary">Lokl Design System</h1>
          <p className="text-product-name font-normal text-brand-primary/60">
            Layer 1 — Foundation tokens + PriceChip, ProductCutoutCard, StoreCard.
            Internal review only, not linked from app navigation.
          </p>
        </header>

        {/* === TOKENS === */}
        <Section title="Surfaces (3 only)">
          <div className="grid grid-cols-3 gap-4 max-w-lg">
            <Swatch label="--surface-page" hex="#FDFBF7" textOn="text-brand-primary" />
            <Swatch label="--surface-card" hex="#FFFFFF" textOn="text-brand-primary" />
            <Swatch label="--surface-tint" hex="#F4F1E9" textOn="text-brand-primary" />
          </div>
        </Section>

        <Section title="Shadows (whisper only, 2 levels)">
          <div className="grid grid-cols-2 gap-6 max-w-md">
            <div className="h-20 rounded-card bg-surface-card shadow-1 flex items-center justify-center text-meta text-brand-primary/60">
              --shadow-1
            </div>
            <div className="h-20 rounded-card bg-surface-card shadow-2 flex items-center justify-center text-meta text-brand-primary/60">
              --shadow-2
            </div>
          </div>
        </Section>

        <Section title="Radius (3 only)">
          <div className="flex items-end gap-6">
            <div className="space-y-1.5">
              <div className="w-24 h-16 rounded-card bg-surface-tint" />
              <p className="text-meta text-brand-primary/60">--radius-card (16px)</p>
            </div>
            <div className="space-y-1.5">
              <div className="w-24 h-10 rounded-pill bg-surface-tint" />
              <p className="text-meta text-brand-primary/60">--radius-pill (999px)</p>
            </div>
            <div className="space-y-1.5">
              <div className="w-16 h-16 rounded-full bg-surface-tint" />
              <p className="text-meta text-brand-primary/60">disc (50% / rounded-full)</p>
            </div>
          </div>
        </Section>

        <Section title="Type scale (5 sizes, weights 400/500 only)">
          <div className="space-y-3">
            <p className="text-display font-medium text-brand-primary">Display — ~28px, medium</p>
            <p className="text-section-header font-medium text-brand-primary">Section header — ~18px, medium</p>
            <p className="text-product-name font-normal text-brand-primary">Product name — ~14px, regular</p>
            <p className="text-meta font-normal text-brand-primary/60">Meta — ~12px, muted</p>
            <p className="text-price-chip font-medium text-brand-primary">Price-chip size — ~13px, medium</p>
          </div>
        </Section>

        <Section title="Spacing scale">
          <p className="text-product-name text-brand-primary/70">
            4 / 8 / 12 / 16 / 24 / 32 — Tailwind&apos;s default numeric scale (p-1…p-8),
            not re-declared as new tokens. Tight within a component: 8–12px. Loose between sections: 32px.
          </p>
        </Section>

        {/* === PRICECHIP === */}
        <Section title="PriceChip">
          <div className="space-y-4 bg-surface-card rounded-card shadow-1 p-6">
            <div className="flex flex-wrap items-center gap-6">
              <PriceChip price={499} />
              <PriceChip price={499} mrp={799} />
              <PriceChip price={499} mrp={799} showDiscount />
            </div>
            <p className="text-meta text-brand-primary/50">
              Default: price + strikethrough mrp only. showDiscount is opt-in per placement, off by default.
            </p>
          </div>
        </Section>

        {/* === PRODUCTCUTOUTCARD === */}
        <Section title="ProductCutoutCard — any category, fallback path (no cut-out URL wired yet)">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {DEMO_PRODUCTS.map((p) => (
              <ProductCutoutCard key={p.id} {...p} />
            ))}
          </div>
          <div className="max-w-[180px]">
            <p className="text-meta text-brand-primary/50 mb-2">No image at all (graceful empty state):</p>
            <ProductCutoutCard id="demo-empty" name="Sample Product" price={299} mrp={null} image={null} />
          </div>
        </Section>

        {/* === STORECARD === */}
        <Section title="StoreCard">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            {DEMO_STORES.map((s) => (
              <StoreCard key={s.id} {...s} />
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
