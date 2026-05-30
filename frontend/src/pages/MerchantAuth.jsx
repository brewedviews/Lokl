import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import api from "../lib/api";
import { toast } from "sonner";

export default function MerchantAuth({ mode = "login" }) {
  const isLogin = mode === "login";
  const { login, register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ email: "", password: "", store_name: "", owner_name: "", phone: "" });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (isLogin) await login(form.email, form.password);
      else await register(form);
      toast.success(isLogin ? "Welcome back!" : "Store account created — let's get you verified");
      // Smart landing — approved merchants skip onboarding entirely.
      try {
        const { data } = await api.get("/merchant/next-route");
        nav(data?.route || "/merchant/onboarding");
      } catch {
        nav("/merchant/onboarding");
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Auth failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex">
      <div className="hidden md:flex md:w-1/2 bg-[#1A2B4C] text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="bf-noise absolute inset-0 opacity-40" />
        <div data-testid="merchant-auth-logo" className="relative flex items-center gap-2">
          <span className="display text-3xl font-bold">lokl<span className="text-[#E68910]">.</span></span>
        </div>
        <div className="relative">
          <h1 className="display text-5xl font-bold leading-tight">Your store. <br /><span className="text-[#E68910]">AI-powered.</span></h1>
          <p className="mt-5 text-white/70 max-w-md">Snap product photos with your phone. Our AI builds magazine-quality catalogs in seconds. Sell to thousands nearby.</p>
          <div className="mt-10 grid grid-cols-3 gap-4 text-sm">
            <div><div className="display text-3xl font-bold text-[#E68910]">3 min</div><div className="text-white/60">to launch</div></div>
            <div><div className="display text-3xl font-bold text-[#E68910]">0₹</div><div className="text-white/60">to start</div></div>
            <div><div className="display text-3xl font-bold text-[#E68910]">∞</div><div className="text-white/60">AI shots</div></div>
          </div>
        </div>
        <p className="relative text-xs text-white/40">Trusted by 2,400+ stores across Bharat</p>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 md:p-12">
        <form onSubmit={submit} className="w-full max-w-md" data-testid={isLogin ? "login-form" : "register-form"}>
          <div className="md:hidden inline-flex items-center gap-2 mb-8">
            <span className="display text-2xl font-bold text-[#1A2B4C]">lokl<span className="text-[#E68910]">.</span></span>
          </div>
          <h2 className="display text-3xl md:text-4xl font-bold text-[#1A2B4C]">{isLogin ? "Welcome back" : "Open your store"}</h2>
          <p className="text-[#595959] mt-2">{isLogin ? "Sign in to your merchant dashboard" : "Launch your AI-powered storefront in minutes"}</p>

          <div className="mt-8 space-y-3">
            {!isLogin && (
              <>
                <input data-testid="store-name-input" required value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} placeholder="Store name (e.g. Bunto Store)" className="w-full px-5 py-3.5 rounded-2xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
                <input data-testid="owner-name-input" required value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} placeholder="Your name" className="w-full px-5 py-3.5 rounded-2xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
                <input data-testid="phone-input" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone number (10 digits)" inputMode="tel" pattern="^[0-9 +\-]{10,15}$" className="w-full px-5 py-3.5 rounded-2xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              </>
            )}
            <input data-testid="email-input" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" className="w-full px-5 py-3.5 rounded-2xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
            <input data-testid="password-input" required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Password" className="w-full px-5 py-3.5 rounded-2xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
          </div>

          <button data-testid="submit-auth-btn" type="submit" disabled={busy} className="w-full mt-6 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-[#1A2B4C] text-white font-semibold hover:bg-[#101D36] disabled:opacity-50 transition">
            {busy ? "Working…" : (isLogin ? "Sign in" : "Create my store")} <ArrowRight size={16} />
          </button>

          <p className="text-sm text-[#595959] mt-6 text-center">
            {isLogin ? (<>New here? <Link to="/merchant/register" className="text-[#E68910] font-semibold">Open a store</Link></>)
                     : (<>Have a store? <Link to="/merchant/login" className="text-[#E68910] font-semibold">Sign in</Link></>)}
          </p>
        </form>
      </div>
    </div>
  );
}
