import React, { useEffect, useState } from "react";
import { Heart, Trash2, Package } from "lucide-react";
import { toast } from "sonner";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import ProductCardV2 from "../components/consumer/v2/ProductCardV2";
import DiscoveryRails from "../components/consumer/DiscoveryRails";
import { getWishlist, removeFromWishlist } from "../lib/wishlist";

// Dedicated wishlist route. If empty → friendly card + shared DiscoveryRails
// (same flow used by the empty-cart page).
export default function WishlistPage() {
  const [items, setItems] = useState(getWishlist());

  useEffect(() => {
    const sync = () => setItems(getWishlist());
    window.addEventListener("wishlist:change", sync);
    return () => window.removeEventListener("wishlist:change", sync);
  }, []);

  const remove = (id) => { removeFromWishlist(id); toast.success("Removed from wishlist"); };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <ConsumerHeader />
      <main className="flex-1">
        <section className="max-w-7xl mx-auto px-4 sm:px-8 pt-8" data-testid="wishlist-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#E68910]/10 grid place-items-center">
              <Heart size={20} className="text-[#E68910]" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] leading-tight">Your wishlist</h1>
              <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
                {items.length === 0 ? "Save products with the heart icon for later." : `${items.length} saved product${items.length === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>
        </section>

        {items.length > 0 ? (
          <section className="max-w-7xl mx-auto px-4 sm:px-8 pt-6" data-testid="wishlist-grid">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
              {items.map((p) => (
                <div key={p.id} className="relative" data-testid={`wishlist-card-${p.id}`}>
                  <ProductCardV2 p={p} />
                  <button
                    onClick={() => remove(p.id)}
                    data-testid={`wishlist-remove-${p.id}`}
                    aria-label="Remove from wishlist"
                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/95 text-rose-500 hover:bg-rose-50 grid place-items-center shadow-sm border border-[#E5E2DC] z-10"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <>
            <section className="max-w-7xl mx-auto px-4 sm:px-8 pt-6" data-testid="wishlist-empty">
              <div className="bg-white border border-dashed border-[#E5E2DC] rounded-3xl p-6 sm:p-8 text-center">
                <Package size={28} className="text-[#94A3B8] mx-auto mb-2" />
                <div className="text-base sm:text-lg font-display font-bold text-[#0A1F5C]">No product added in your wishlist</div>
                <p className="text-xs sm:text-sm text-[#64748B] mt-1 max-w-md mx-auto">
                  Tap the heart on any product to save it for later. Below are some picks you might love.
                </p>
              </div>
            </section>
            <DiscoveryRails testidPrefix="wishlist" />
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
