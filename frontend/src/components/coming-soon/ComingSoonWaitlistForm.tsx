"use client";

/**
 * ComingSoonWaitlistForm — G17, the embedded form card from
 * docs/design/coming-soon-v2.html's hero. Customer/merchant tab toggle;
 * merchant tab reveals store name + category, both already accepted by
 * the existing, unmodified `POST /api/waitlist` (`WaitlistEntry.store_name`/
 * `.category` in backend/server.py). `activeTab` is a controlled prop (not
 * local state) so MerchantSection's "List my store for free" CTA can flip
 * this card to the merchant tab from elsewhere on the page.
 *
 * Category list mirrors merchant/kyc/page.tsx's own BUSINESS_CATEGORIES —
 * duplicated rather than imported so this file stays self-contained; keep
 * the two in sync if that list changes.
 */
import { useState } from "react";
import { api } from "@/lib/api";

const CATEGORIES = [
  "Women's Fashion",
  "Men's Fashion",
  "Ethnic Wear",
  "Footwear",
  "Lingerie & Innerwear",
  "Kids",
  "Accessories",
  "Beauty",
  "Sports",
  "Multi-category",
];

type Tab = "customer" | "merchant";

export function ComingSoonWaitlistForm({ activeTab, onTabChange }: { activeTab: Tab; onTabChange: (t: Tab) => void }) {
  const [phone, setPhone] = useState("");
  const [storeName, setStoreName] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const isMerchant = activeTab === "merchant";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting" || status === "done") return;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setError("Enter a valid 10-digit phone number");
      return;
    }
    setError("");
    setStatus("submitting");
    try {
      await api.site.joinWaitlist({
        phone: digits,
        type: activeTab,
        ...(isMerchant ? { store_name: storeName.trim() || undefined, category: category || undefined } : {}),
      });
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Something went wrong — please try again.");
    }
  };

  return (
    <div data-testid="coming-soon-waitlist-form" className="bg-white rounded-3xl p-7 sm:p-8 shadow-[0_24px_64px_rgba(0,0,0,0.2)]">
      {status === "done" ? (
        <div data-testid="waitlist-success" className="text-center py-3">
          <div className="w-12 h-12 rounded-full bg-[#E8F5E9] flex items-center justify-center mx-auto mb-3.5">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="#2E7D32" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="font-bold text-[17px] text-brand-primary mb-1.5">
            {isMerchant ? "We'll be in touch" : "You're on the list"}
          </p>
          <p className="text-[13px] text-[#888] leading-relaxed">
            {isMerchant
              ? "Our team will WhatsApp you within 24 hours to set up your store on Lokl."
              : "We'll WhatsApp you the moment Lokl goes live in Bhilai."}
          </p>
        </div>
      ) : (
        <>
          <div className="font-bold text-lg text-brand-primary mb-1">Get early access</div>
          <p className="text-[13px] text-[#888] mb-5 leading-snug">Join the waitlist and be first to shop when Lokl goes live.</p>

          <div className="flex gap-1.5 bg-[#F5F0E8] rounded-full p-1 mb-5">
            <button
              type="button"
              onClick={() => onTabChange("customer")}
              data-testid="tab-customer"
              className={`flex-1 py-2 px-3 rounded-full text-[13px] font-semibold transition ${!isMerchant ? "bg-brand-primary text-white shadow-[0_2px_8px_rgba(10,31,92,0.25)]" : "text-[#888]"}`}
            >
              I want to shop
            </button>
            <button
              type="button"
              onClick={() => onTabChange("merchant")}
              data-testid="tab-merchant"
              className={`flex-1 py-2 px-3 rounded-full text-[13px] font-semibold transition ${isMerchant ? "bg-brand-primary text-white shadow-[0_2px_8px_rgba(10,31,92,0.25)]" : "text-[#888]"}`}
            >
              I have a store
            </button>
          </div>

          <form onSubmit={submit} data-testid="waitlist-form">
            <div className="mb-3.5">
              <label className="block text-[12px] font-bold text-brand-primary mb-1.5 uppercase tracking-wide">WhatsApp number</label>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98765 43210"
                data-testid="waitlist-phone-input"
                className="w-full px-4 py-3 rounded-xl border-[1.5px] border-[#E5E2DC] text-sm text-brand-primary bg-[#FDFBF7] outline-none focus:border-brand-accent focus:bg-white transition"
              />
            </div>

            {isMerchant && (
              <>
                <div className="mb-3.5">
                  <label className="block text-[12px] font-bold text-brand-primary mb-1.5 uppercase tracking-wide">Store name</label>
                  <input
                    type="text"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="Priya Fashion, Sector 6"
                    data-testid="waitlist-store-name-input"
                    className="w-full px-4 py-3 rounded-xl border-[1.5px] border-[#E5E2DC] text-sm text-brand-primary bg-[#FDFBF7] outline-none focus:border-brand-accent focus:bg-white transition"
                  />
                </div>
                <div className="mb-3.5">
                  <label className="block text-[12px] font-bold text-brand-primary mb-1.5 uppercase tracking-wide">What do you sell?</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    data-testid="waitlist-category-select"
                    className="w-full px-4 py-3 rounded-xl border-[1.5px] border-[#E5E2DC] text-sm text-brand-primary bg-[#FDFBF7] outline-none focus:border-brand-accent focus:bg-white transition"
                  >
                    <option value="">Select a category</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={status === "submitting"}
              data-testid="waitlist-submit"
              className="w-full py-3.5 mt-1.5 rounded-full bg-brand-accent text-white text-[15px] font-extrabold active:scale-[0.985] transition disabled:opacity-60"
            >
              {status === "submitting" ? "Joining..." : isMerchant ? "List my store for free" : "Join the waitlist"}
            </button>
            <p className="text-[12px] text-[#aaa] text-center mt-3 leading-relaxed">
              We&apos;ll WhatsApp you when Lokl goes live in your area. No spam.
            </p>
            {error && <p className="text-xs text-red-500 mt-2 text-center" data-testid="waitlist-error">{error}</p>}
          </form>
        </>
      )}
    </div>
  );
}
