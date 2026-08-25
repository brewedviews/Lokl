"use client";

import { useEffect, useState } from "react";
import { Heart, Package } from "lucide-react";
import { useWishlistStore } from "@/stores";
import { ProductCard } from "@/components/consumer/ProductCard";
import { DiscoveryRails } from "@/components/consumer/DiscoveryRails";

export default function WishlistPage() {
  const products = useWishlistStore((s) => s.products);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  const items = hydrated ? products : [];

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <main className="flex-1">
        <section className="max-w-7xl mx-auto px-4 sm:px-8 pt-8" data-testid="wishlist-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#E68910]/10 grid place-items-center">
              <Heart size={20} className="text-[#E68910]" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-display font-medium text-[#0A1F5C] leading-tight">Your wishlist</h1>
              <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
                {items.length === 0 ? "Save products with the heart icon for later." : `${items.length} saved product${items.length === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>
        </section>

        {items.length > 0 ? (
          <section className="max-w-7xl mx-auto px-4 sm:px-8 pt-6" data-testid="wishlist-grid">
            {/* G13 §13 — grid breakpoints matched to /products' own PLP grid
                exactly (grid-cols-2 md:grid-cols-4), so Wishlist reads as a
                filtered product listing rather than a visually distinct
                experience. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
              {items.map((p) => (
                <div key={p.id} data-testid={`wishlist-card-${p.id}`}>
                  <ProductCard p={p} size="default" />
                </div>
              ))}
            </div>
          </section>
        ) : (
          <>
            <section className="max-w-7xl mx-auto px-4 sm:px-8 pt-6" data-testid="wishlist-empty">
              <div className="bg-white border border-dashed border-[#E5E2DC] rounded-3xl p-6 sm:p-8 text-center">
                <Package size={28} className="text-[#94A3B8] mx-auto mb-2" />
                <div className="text-base sm:text-lg font-display font-medium text-[#0A1F5C]">No product added in your wishlist</div>
                <p className="text-xs sm:text-sm text-[#64748B] mt-1 max-w-md mx-auto">
                  Tap the heart on any product to save it for later. Below are some picks you might love.
                </p>
              </div>
            </section>
            <DiscoveryRails testidPrefix="wishlist" />
          </>
        )}
      </main>
    </div>
  );
}
