"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Heart, Trash2, Package } from "lucide-react";
import { toast } from "sonner";
import { useWishlistStore } from "@/stores";
import { DiscoveryRails } from "@/components/consumer/DiscoveryRails";
import { Footer } from "@/components/consumer/Footer";

export default function WishlistPage() {
  const products = useWishlistStore((s) => s.products);
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  const items = hydrated ? products : [];

  const remove = (id: string) => {
    const p = products.find((x) => x.id === id);
    if (p) {
      toggleWishlist(p);
      toast.success("Removed from wishlist");
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
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
                <div key={p.id} className="relative bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden hover:shadow-md transition" data-testid={`wishlist-card-${p.id}`}>
                  <Link href={`/product/${p.id}`} className="block">
                    {p.image ? (
                      <div className="relative w-full aspect-[4/5] bg-slate-100">
                        <Image src={p.image} alt={p.name} fill sizes="(max-width: 640px) 50vw, 280px" className="object-cover" />
                      </div>
                    ) : (
                      <div className="w-full aspect-[4/5] bg-[#FDFBF7] grid place-items-center"><Package size={28} className="text-[#94A3B8]" /></div>
                    )}
                    <div className="p-2.5">
                      {p.store_name && <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] line-clamp-1">{p.store_name}</div>}
                      <div className="text-[12px] font-semibold text-[#0A1F5C] line-clamp-1 mt-0.5">{p.name}</div>
                      <div className="flex items-baseline gap-1.5 mt-1">
                        <span className="text-sm font-bold text-[#0A1F5C]">₹{Number(p.price || 0).toLocaleString()}</span>
                        {p.mrp && p.mrp > p.price && <span className="text-[11px] text-[#94A3B8] line-through">₹{Number(p.mrp).toLocaleString()}</span>}
                      </div>
                    </div>
                  </Link>
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
