"use client";

/**
 * Merchant phone-OTP login (iter-29 Item 1).
 *
 * Two-phase form: phone → 6-digit OTP → JWT. On success we call
 * `setAuth(token, merchant)` with the exact same response shape as email
 * login, so downstream code (next-route resolver, dashboard rehydrate, etc.)
 * works identically regardless of which tab the merchant used.
 *
 * Resend countdown: 60 seconds, per the spec. Returns 404 on phone-not-found
 * are surfaced verbatim ("Please register first.") so the user has a clear
 * next step.
 */
import { useState } from "react";
import { Phone, ShieldCheck, ArrowRight, RefreshCw, ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import { useMerchantAuthStore } from "@/stores";

export function MerchantOtpLogin() {
  const router = useRouter();
  const setAuth = useMerchantAuthStore((s) => s.setAuth);
  const [phase, setPhase] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const startCooldown = (secs = 60) => {
    setCooldown(secs);
    const t = window.setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          window.clearInterval(t);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const sendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!/^[0-9]{10}$/.test(phone)) {
      toast.error("Enter a valid 10-digit mobile number");
      return;
    }
    setBusy(true);
    try {
      await api.auth.requestMerchantOtp(phone);
      setPhase("otp");
      toast.success("OTP sent via WhatsApp/SMS");
      startCooldown(60);
    } catch (err) {
      // 404 from backend ("No merchant account found. Please register first.")
      // bubbles up through getErrorMessage and shows the exact wording the
      // backend dictated — so a user mistyping a friend's phone isn't told
      // "OTP sent" only to get stuck later.
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!/^[0-9]{6}$/.test(otp)) {
      toast.error("Enter the 6-digit OTP");
      return;
    }
    setBusy(true);
    try {
      const r = await api.auth.verifyMerchantOtp(phone, otp);
      setAuth(r.token, r.merchant);
      toast.success("Welcome back!");
      // Route by KYC state, identical to the email-login flow.
      try {
        const { path } = await api.merchant.nextRoute();
        router.replace(path || "/merchant/onboarding");
      } catch {
        router.replace("/merchant/onboarding");
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full" data-testid="merchant-otp-login">
      {phase === "phone" ? (
        <form onSubmit={sendOtp} className="space-y-3" data-testid="merchant-otp-phone-form">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#595959] font-medium">
            Registered mobile number
          </div>
          <div className="flex items-center gap-3">
            <Phone size={16} className="text-[#E68910]" />
            <input
              data-testid="merchant-otp-phone-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="Enter your registered phone number"
              inputMode="numeric"
              maxLength={10}
              autoFocus
              className="flex-1 px-3 py-2.5 rounded-2xl border border-[#E5E2DC] outline-none text-[#1A2B4C] focus:border-[#E68910]"
            />
          </div>
          <button
            type="submit"
            disabled={busy || phone.length !== 10}
            data-testid="merchant-otp-send-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-[#1A2B4C] text-white text-sm font-semibold hover:bg-[#101D36] transition disabled:opacity-50"
          >
            {busy ? "Sending…" : <>Send OTP <ArrowRight size={14} /></>}
          </button>
          <p className="text-[11px] text-[#595959] mt-2">
            We&apos;ll send a 6-digit code to your WhatsApp or SMS. Only registered merchants can sign in here.
          </p>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="space-y-3" data-testid="merchant-otp-verify-form">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#595959] font-medium">
            6-digit code · sent to +91 {phone}
          </div>
          <div className="flex items-center gap-3">
            <ShieldCheck size={16} className="text-[#E68910]" />
            <input
              data-testid="merchant-otp-code-input"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              className="flex-1 px-3 py-2.5 rounded-2xl border border-[#E5E2DC] outline-none text-[#1A2B4C] tracking-[0.4em] text-center font-semibold focus:border-[#E68910]"
            />
          </div>
          <button
            type="submit"
            disabled={busy || otp.length !== 6}
            data-testid="merchant-otp-verify-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-[#1A2B4C] text-white text-sm font-semibold hover:bg-[#101D36] transition disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify & Login"}
          </button>
          <div className="flex items-center justify-between text-xs mt-2">
            <button
              type="button"
              onClick={() => { setPhase("phone"); setOtp(""); }}
              data-testid="merchant-otp-back"
              className="inline-flex items-center gap-1 text-[#595959] hover:text-[#1A2B4C]"
            >
              <ChevronLeft size={12} /> Change number
            </button>
            <button
              type="button"
              disabled={cooldown > 0 || busy}
              onClick={() => sendOtp()}
              data-testid="merchant-otp-resend"
              className="inline-flex items-center gap-1 text-[#E68910] hover:underline disabled:text-slate-400 disabled:no-underline"
            >
              <RefreshCw size={12} />
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
