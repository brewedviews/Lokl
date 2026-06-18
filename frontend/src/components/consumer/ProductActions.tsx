"use client";

/** Size picker + add-to-bag + buy-now + share + notify-me + schedule interactions. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, ShoppingBag, Share2, Bell, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useCartStore } from "@/stores";
import { apiClient } from "@/lib/api-client";
import type { Product } from "@/types";

export function ProductActions({
  product,
  storeCanOrder = true,
  storeBadge,
  storeOpensAtLabel,
  storeName,
  storeId,
}: {
  product: Product;
  storeCanOrder?: boolean;
  storeBadge?: string;
  storeOpensAtLabel?: string | null;
  storeName?: string;
  storeId?: string;
}) {
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const [size, setSize] = useState<string | null>(product.sizes?.[0] || null);

  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyPhone, setNotifyPhone] = useState("");
  const [notifySubmitted, setNotifySubmitted] = useState(false);
  const [notifyLoading, setNotifyLoading] = useState(false);

  const badge = storeBadge ?? product.store_badge ?? "LIVE";
  const opensAt = storeOpensAtLabel ?? product.store_opens_at_label ?? null;
  const sName = storeName ?? product.store_name ?? "this store";
  const sId = storeId ?? product.store_id ?? "";

  const isOffline = badge === "Store Offline";
  const isClosed = badge === "Closed";
  const isAway = badge === "Away";

  const handleAdd = (): boolean => {
    if (isClosed) { toast.error("This store is currently closed"); return false; }
    if (!storeCanOrder) { toast.error("This store is currently unavailable"); return false; }
    if (product.sizes?.length && !size) { toast.error("Please pick a size"); return false; }
    const r = addItem(product, size ?? "");
    if (!r.success && r.conflict) {
      toast.error(`Your bag already has items from ${r.conflict.existing_store_names.join(" & ")}. Lokl allows up to ${r.conflict.max_stores} stores per order.`);
      return false;
    }
    return true;
  };

  const handleNotifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = notifyPhone.replace(/\D/g, "");
    if (digits.length < 10) { toast.error("Enter a valid 10-digit phone number"); return; }
    setNotifyLoading(true);
    try {
      await apiClient.post("/api/notify-me", {
        phone: digits,
        store_id: sId,
        product_id: product.id,
      });
      setNotifySubmitted(true);
    } catch {
      toast.error("Could not save. Please try again.");
    } finally {
      setNotifyLoading(false);
    }
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
    <>
      {product.sizes && product.sizes.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2.5">
            <h4 className="text-sm font-semibold text-[#0A1F5C]">Select size</h4>
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
        {isOffline ? (
          <>
            <div className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full bg-slate-100 text-slate-400 text-sm font-bold cursor-not-allowed whitespace-nowrap" data-testid="store-offline-label">
              Store Offline
            </div>
            <button
              onClick={() => setNotifyOpen((v) => !v)}
              data-testid="notify-me-btn"
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full bg-[#1A2B4C] text-white text-sm font-bold hover:bg-[#0F1F3D] transition whitespace-nowrap"
            >
              <Bell size={16} /> Notify Me
            </button>
          </>
        ) : isClosed ? (
          <div className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full bg-slate-100 text-slate-400 text-sm font-bold cursor-not-allowed whitespace-nowrap" data-testid="store-closed-label">
            <ShoppingBag size={16} /> Store closed
          </div>
        ) : storeCanOrder ? (
          <>
            <button onClick={() => { if (handleAdd()) toast.success("Added to bag"); }} data-testid="add-to-bag"
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full border-2 border-[#0A1F5C] text-[#0A1F5C] text-sm font-bold hover:bg-[#0A1F5C] hover:text-white transition whitespace-nowrap">
              <ShoppingBag size={16} /> Add to bag
            </button>
            <button onClick={() => { if (handleAdd()) router.push("/checkout"); }} data-testid="buy-now"
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full bg-[#F59E0B] text-white text-sm font-bold hover:bg-[#cc7a0a] transition whitespace-nowrap">
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

      {isAway && (
        <div className="mt-3 px-4 py-2 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold text-center">
          Store is away · Delivery may take longer
        </div>
      )}

      {isClosed && opensAt && (
        <p className="text-[11px] text-[#64748B] mt-2">Available from {opensAt.replace(/^Opens\s+(at\s+)?/i, "")}</p>
      )}

      {isOffline && notifyOpen && (
        <div className="mt-3 p-4 bg-[#F0F4FF] rounded-2xl">
          {notifySubmitted ? (
            <div className="flex items-center gap-2 text-[#4F7363]">
              <CheckCircle2 size={16} />
              <p className="text-sm font-semibold">You&apos;ll be notified on WhatsApp!</p>
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold text-[#1A2B4C] mb-2">Get notified when store is back</p>
              <form onSubmit={handleNotifySubmit} className="flex gap-2">
                <input
                  type="tel"
                  value={notifyPhone}
                  onChange={(e) => setNotifyPhone(e.target.value)}
                  placeholder="Your WhatsApp number"
                  className="flex-1 px-3 py-2 rounded-xl border border-[#E5E2DC] text-sm outline-none focus:border-[#1A2B4C]"
                />
                <button
                  type="submit"
                  disabled={notifyLoading}
                  className="px-4 py-2 bg-[#1A2B4C] text-white rounded-xl text-sm font-semibold disabled:opacity-50"
                >
                  {notifyLoading ? "…" : "Notify Me"}
                </button>
              </form>
              <p className="text-xs text-[#595959] mt-2">We&apos;ll WhatsApp you when {sName} is back online</p>
            </>
          )}
        </div>
      )}

      {isOffline && (
        <p className="text-xs text-[#94A3B8] mt-2">
          <a href="#similar-products" className="hover:text-[#1A2B4C] transition">See similar products ↓</a>
        </p>
      )}
    </>
  );
}
