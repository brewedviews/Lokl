import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Trash2, Package } from "lucide-react";
import { toast } from "sonner";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import OffersStrip from "../components/consumer/v2/OffersStrip";
import HCarousel from "../components/consumer/v2/HCarousel";
import ProductCardV2 from "../components/consumer/v2/ProductCardV2";
import { getWishlist, removeFromWishlist } from "../lib/wishlist";
import api from "../lib/api";

// Dedicated wishlist route — replaces the previous /account?tab=wishlist link.
// • If the user has saved products → render the same product-card grid we use
//   on Home/Store (compact via store_name handled inside the card component).
// • If empty → friendly empty state followed by the same discovery rails the
//   Category Hub uses (Offers / Trending / Selling fast / Recently added),
//   minus the L1 category tiles. Helps the user keep shopping.
export default function WishlistPage() {
  const [items, setItems] = useState(getWishlist());
  const [offers, setOffers] = useState([]);
  const [trending, setTrending] = useState([]);
  const [sellingFast, setSellingFast] = useState([]);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    const sync = () => setItems(getWishlist());
    window.addEventListener("wishlist:change", sync);
    return () => window.removeEventListener("wishlist:change", sync);
  }, []);

  // Only fetch the discovery rails when the wishlist is empty.
  useEffect(() => {
    if (items.length > 0) return;
    Promise.all([
      api.get("/offers").then((r) => setOffers(r.data || [])).catch(() => {}),
      api.get("/feed/popular-in-city?limit=10").then((r) => setTrending(r.data || [])).catch(() => {}),
      api.get("/feed/selling-fast?limit=10").then((r) => setSellingFast(r.data || [])).catch(() => {}),
      api.get("/feed/new-arrivals?limit=10").then((r) => setRecent(r.data || [])).catch(() => {}),
    ]);
  }, [items.length]);

  const remove = (id) => {
    removeFromWishlist(id);
    toast.success("Removed from wishlist");
  };

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
                  <ProductCardV2 p={p} compact />
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
            {/* Empty state — friendly message */}
            <section className="max-w-7xl mx-auto px-4 sm:px-8 pt-6" data-testid="wishlist-empty">
              <div className="bg-white border border-dashed border-[#E5E2DC] rounded-3xl p-6 sm:p-8 text-center">
                <Package size={28} className="text-[#94A3B8] mx-auto mb-2" />
                <div className="text-base sm:text-lg font-display font-bold text-[#0A1F5C]">No product added in your wishlist</div>
                <p className="text-xs sm:text-sm text-[#64748B] mt-1 max-w-md mx-auto">
                  Tap the heart on any product to save it for later. Below are some picks you might love.
                </p>
              </div>
            </section>

            {/* Same flow as Category Hub minus the L1 tiles */}
            {offers.length > 0 && <OffersStrip offers={offers} />}
            {trending.length > 0 && (
              <HCarousel title="Trending now" subtitle="Most ordered products nearby this week" testid="wishlist-trending" link="/products?sort=trending" linkLabel="See all">
                {trending.map((p) => <ProductCardV2 key={p.id} p={p} />)}
              </HCarousel>
            )}
            {sellingFast.length > 0 && (
              <HCarousel title="Selling fast" subtitle="Don't miss out — limited stock" testid="wishlist-selling-fast" link="/products?sort=trending">
                {sellingFast.map((p) => <ProductCardV2 key={p.id} p={p} />)}
              </HCarousel>
            )}
            {recent.length > 0 && (
              <HCarousel title="Recently added" subtitle="Fresh drops from Bhilai stores" testid="wishlist-recent" link="/products?sort=new" linkLabel="See all">
                {recent.map((p) => <ProductCardV2 key={p.id} p={p} />)}
              </HCarousel>
            )}
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
