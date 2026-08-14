"use client";

/**
 * ProductTopActions — wishlist + share, relocated out of the mid-page CTA
 * row (see ProductActions) into a slim bar at the very top of the PDP
 * content, matching the standard e-commerce header pattern (icon-only,
 * no border/circle chrome, 44x44 tap targets). This is per-product state
 * (a specific product's wishlist toggle + share link), which the shared,
 * route-agnostic ConsumerHeader has no way to know about — so it lives
 * here, at the top of the page content, rather than inside that global
 * header.
 */
import { useEffect, useState } from "react";
import { Heart, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useWishlistStore } from "@/stores";
import type { Product } from "@/types";

export function ProductTopActions({ product }: { product: Product }) {
  const isWishlisted = useWishlistStore((s) => s.isWishlisted(product.id));
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  const [wished, setWished] = useState(false);
  useEffect(() => { setWished(isWishlisted); }, [isWishlisted]);

  const handleWishlist = () => {
    const next = toggleWishlist(product);
    const justAdded = next.some((x) => x.id === product.id);
    setWished(justAdded);
    toast.success(justAdded ? "Saved to wishlist" : "Removed from wishlist");
  };

  const handleShare = async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const shareData = {
      title: product.name,
      text: `Check out ${product.name} for ₹${Number(product.price).toLocaleString()} on Lokl — local fashion in Bhilai`,
      url,
    };
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
    <div className="flex items-center justify-end gap-0.5 px-4 md:px-0 pt-2 md:pt-0" data-testid="pdp-top-actions">
      <button
        type="button"
        aria-label="Wishlist"
        aria-pressed={wished}
        data-testid="wishlist-btn"
        onClick={handleWishlist}
        className={`w-11 h-11 flex items-center justify-center transition ${wished ? "text-orange-500" : "text-ink-navy"}`}
      >
        <Heart size={20} fill={wished ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        aria-label="Share"
        data-testid="share-btn"
        onClick={handleShare}
        className="w-11 h-11 flex items-center justify-center text-ink-navy"
      >
        <Share2 size={20} />
      </button>
    </div>
  );
}
