"use client";

/** Size picker + add-to-bag + buy-now + share interactions. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, ShoppingBag, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useCartStore } from "@/stores";
import type { Product } from "@/types";

export function ProductActions({ product, storeCanOrder = true }: { product: Product; storeCanOrder?: boolean }) {
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const [size, setSize] = useState<string | null>(product.sizes?.[0] || null);

  const handleAdd = (): boolean => {
    if (!storeCanOrder) { toast.error("This store is currently unavailable"); return false; }
    if (product.sizes?.length && !size) { toast.error("Please pick a size"); return false; }
    const r = addItem(product, size ?? "");
    if (!r.success && r.conflict) {
      toast.error(`Your bag already has items from ${r.conflict.existing_store_names.join(" & ")}. Lokl allows up to ${r.conflict.max_stores} stores per order.`);
      return false;
    }
    return true;
  };

  const handleShare = async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const shareData = {
      title: product.name,
      text: `Check out ${product.name} for ₹${Number(product.price).toLocaleString()} on Lokl — local fashion in Bhilai`,
      url,
    };
    // Native share sheet on iOS / Android / supporting browsers. We silently
    // ignore user-cancellation (NotAllowedError / AbortError). Anything else
    // falls through to clipboard copy.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try { await navigator.share(shareData); return; }
      catch (err) {
        const e = err as { name?: string };
        if (e?.name === "AbortError" || e?.name === "NotAllowedError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied!");
    } catch {
      toast.error("Could not copy link");
    }
  };

  return (
    <>
      {product.sizes && product.sizes.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2.5">
            <h4 className="text-sm font-semibold text-[#0A1F5C]">Select size</h4>
            <span className="text-[11px] font-bold text-[#F59E0B]">Try-at-doorstep available</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {product.sizes.map((s) => (
              <button key={s} onClick={() => setSize(s)} data-testid={`size-${s}`}
                className={`min-w-11 px-3.5 py-2 rounded-full text-sm font-semibold border transition ${size === s ? "bg-[#0A1F5C] text-white border-[#0A1F5C]" : "bg-white border-slate-200 hover:border-[#0A1F5C]"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex gap-2">
        {storeCanOrder ? (
          <>
            <button onClick={() => { if (handleAdd()) toast.success("Added to bag"); }} data-testid="add-to-bag" className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full border-2 border-[#0A1F5C] text-[#0A1F5C] text-sm font-bold hover:bg-[#0A1F5C] hover:text-white transition whitespace-nowrap">
              <ShoppingBag size={16} /> Add to bag
            </button>
            <button onClick={() => { if (handleAdd()) router.push("/checkout"); }} data-testid="buy-now" className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full bg-[#F59E0B] text-white text-sm font-bold hover:bg-[#cc7a0a] transition whitespace-nowrap">
              Buy now
            </button>
          </>
        ) : (
          <div className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full bg-slate-100 text-slate-400 text-sm font-bold cursor-not-allowed whitespace-nowrap" data-testid="store-unavailable-btn">
            Store Unavailable
          </div>
        )}
        <button aria-label="Wishlist" data-testid="wishlist-btn" className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:border-[#0A1F5C] transition shrink-0">
          <Heart size={16} />
        </button>
        <button aria-label="Share" data-testid="share-btn" onClick={handleShare} className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:border-[#0A1F5C] transition shrink-0">
          <Share2 size={16} />
        </button>
      </div>
    </>
  );
}
