"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";

interface Props {
  badge: string;
  storeId: string;
  storeName: string;
  nextOpenLabel?: string | null;
}

export function StoreNotifyBanner({ badge, storeId, storeName, nextOpenLabel }: Props) {
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  if (badge === "Closed") {
    return (
      <div className="mb-6 bg-[#F8F6F1] rounded-2xl p-4 border border-[#E5E2DC]">
        <p className="text-sm text-[#595959]">
          <span className="font-semibold text-[#1A2B4C]">{nextOpenLabel || "Closed"}</span>
        </p>
      </div>
    );
  }

  if (badge !== "Store Offline") return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return;
    setLoading(true);
    try {
      await apiClient.post("/api/notify-me", { phone: digits, store_id: storeId });
      setSubmitted(true);
    } catch {
      // silent — user sees no change, can retry
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="mb-6 bg-[#F0F4FF] rounded-2xl p-4 flex items-center gap-2 text-[#4F7363]">
        <CheckCircle2 size={16} />
        <p className="text-sm font-semibold">You&apos;ll be notified on WhatsApp when {storeName} is back!</p>
      </div>
    );
  }

  return (
    <div className="mb-6 bg-[#F0F4FF] rounded-2xl p-4 border border-indigo-100">
      <p className="text-sm font-semibold text-[#1A2B4C] mb-1">This store is currently offline</p>
      <p className="text-xs text-[#595959] mb-3">Get notified when {storeName} is back:</p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Your WhatsApp number"
          className="flex-1 px-3 py-2 rounded-xl border border-[#E5E2DC] text-sm outline-none focus:border-[#1A2B4C]"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-[#1A2B4C] text-white rounded-xl text-sm font-semibold disabled:opacity-50"
        >
          {loading ? "…" : "Notify Me"}
        </button>
      </form>
    </div>
  );
}
