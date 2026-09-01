"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, ShoppingBag, Bike, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import { useMerchantAuthStore } from "@/stores";
import { MerchantOtpLogin } from "@/components/merchant/MerchantOtpLogin";

// Mobile-first: the split-screen panel with headline + stats below is
// `hidden md:flex`, so on a phone (most Bhilai shop owners' actual device)
// a first-time visitor saw NOTHING but a bare form. These four are the same
// value prop, just also rendered above the form on small screens.
const BENEFITS = [
  { icon: Search, text: "Get found by customers searching nearby — not just walk-ins" },
  { icon: LayoutGrid, text: "Put your products online in minutes, no website needed" },
  { icon: ShoppingBag, text: "Manage orders and stock from your phone, one place" },
  { icon: Bike, text: "We handle delivery — 45 minutes, across Bhilai" },
] as const;

/** Shared form for /merchant/login and /merchant/register. */
export function MerchantAuthForm({ mode }: { mode: "login" | "register" }) {
  const isLogin = mode === "login";
  const router = useRouter();
  const setAuth = useMerchantAuthStore((s) => s.setAuth);
  const [form, setForm] = useState({ store_name: "", owner_name: "", phone: "" });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!isLogin && !termsAccepted) {
      toast.error("Please accept the Merchant Terms & Agreement to continue");
      return;
    }
    setBusy(true);
    try {
      const r = await api.auth.register({
        store_name: form.store_name, owner_name: form.owner_name, phone: form.phone,
        terms_accepted: termsAccepted,
      });
      setAuth(r.token, r.merchant);
      toast.success("Store account created — let's get you verified");
      try {
        const { route } = await api.merchant.nextRoute();
        router.replace(route || "/merchant/onboarding");
      } catch {
        router.replace("/merchant/onboarding");
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex">
      <div className="hidden md:flex md:w-1/2 bg-[#1A2B4C] text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="bf-noise absolute inset-0 opacity-40" />
        <div data-testid="merchant-auth-logo" className="relative flex items-center gap-2">
          <span className="font-display text-3xl font-bold text-white">lokl<span className="text-[#E68910]">.</span><span className="text-white">shop</span></span>
        </div>
        <div className="relative">
          <h1 className="font-display text-5xl font-bold leading-tight">You have the shop. <br /><span className="text-[#E68910]">Now be findable online.</span></h1>
          <p className="mt-5 text-white/70 max-w-md">Customers near you are already searching. Lokl brings your store online — no website to build, no delivery fleet to hire.</p>
          <div className="mt-8 grid grid-cols-3 gap-4 text-sm">
            <div><div className="font-display text-3xl font-bold text-[#E68910]">₹0</div><div className="text-white/60">to start</div></div>
            <div><div className="font-display text-3xl font-bold text-[#E68910]">0%</div><div className="text-white/60">commission</div></div>
            <div><div className="font-display text-3xl font-bold text-[#E68910]">45 min</div><div className="text-white/60">delivery</div></div>
          </div>
          <ul className="mt-8 space-y-3 max-w-sm">
            {BENEFITS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5 text-sm text-white/80">
                <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon size={12} className="text-[#E68910]" />
                </span>
                <span className="pt-0.5">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">Lokl.shop — built for Bhilai&apos;s stores</p>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md">
          <div className="md:hidden inline-flex items-center gap-2 mb-8">
            <span className="font-display text-2xl font-bold text-[#1A2B4C]">lokl<span className="text-[#E68910]">.</span></span>
          </div>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-[#1A2B4C]">{isLogin ? "Welcome back" : "Your shop, findable online"}</h2>
          <p className="text-[#595959] mt-2">{isLogin ? "Sign in to your Lokl.shop merchant account" : "You already have the shop and the customers nearby. Lokl gets you found and ordered from online — free, in minutes."}</p>

          {!isLogin && (
            <ul className="mt-5 space-y-2.5 md:hidden" data-testid="merchant-mobile-benefits">
              {BENEFITS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-2.5 text-sm text-[#1A2B4C]">
                  <span className="w-7 h-7 rounded-full bg-[#E68910]/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon size={14} className="text-[#E68910]" />
                  </span>
                  <span className="pt-1">{text}</span>
                </li>
              ))}
            </ul>
          )}

          {isLogin ? (
            <div className="mt-6"><MerchantOtpLogin /></div>
          ) : (
            <form onSubmit={submit} className="w-full" data-testid="register-form">
              <div className="mt-6 space-y-3">
                <input data-testid="store-name-input" required value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} placeholder="Store name (e.g. Bunto Store)" className="w-full px-5 py-3.5 rounded-2xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
                <input data-testid="owner-name-input" required value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} placeholder="Your name" className="w-full px-5 py-3.5 rounded-2xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
                <input data-testid="phone-input" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone number (10 digits)" inputMode="tel" pattern="^[0-9 +\-]{10,15}$" className="w-full px-5 py-3.5 rounded-2xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              </div>
              <p className="text-xs text-[#595959] mt-1">Bank details can be added later from your dashboard.</p>
              <label className="flex items-start gap-2.5 mt-4 cursor-pointer select-none">
                <input
                  type="checkbox"
                  data-testid="merchant-terms-checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-[#E5E2DC] text-[#1A2B4C] focus:ring-[#1A2B4C] shrink-0"
                />
                <span className="text-xs text-[#595959]">
                  I&apos;ve read and agree to the{" "}
                  <Link href="/merchant/terms" target="_blank" className="text-[#1A2B4C] font-semibold hover:underline">
                    Merchant Terms &amp; Agreement
                  </Link>, including my responsibility for what I list.
                </span>
              </label>
              <button data-testid="submit-auth-btn" type="submit" disabled={busy || !termsAccepted} className="w-full mt-4 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-[#1A2B4C] text-white font-semibold hover:bg-[#101D36] disabled:opacity-50 transition">
                {busy ? "Working…" : "Create my store"} <ArrowRight size={16} />
              </button>
            </form>
          )}

          <p className="text-sm text-[#595959] mt-6 text-center">
            {isLogin
              ? <>New here? <Link href="/merchant/register" className="text-[#E68910] font-semibold">Open a store</Link></>
              : <>Have a store? <Link href="/merchant/login" className="text-[#E68910] font-semibold">Sign in</Link></>}
          </p>
        </div>
      </div>
    </div>
  );
}
