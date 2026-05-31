import React, { useState } from "react";
import { Phone, ShieldCheck, ArrowRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import api, { setCustomerSession } from "@/lib/api";

/**
 * Two-step OTP login for customers (phone → 6-digit code → JWT).
 *
 * Props:
 *   - title:    string heading shown above the form (optional)
 *   - subtitle: string supporting copy (optional)
 *   - onSuccess(phone, token): called after a successful verify-otp
 *
 * The component stores the token + phone via setCustomerSession() and then
 * delegates next-step UX (close modal / redirect) to the caller.
 */
export default function CustomerOtpLogin({ title, subtitle, onSuccess }) {
  const [phase, setPhase] = useState("phone");           // 'phone' | 'otp'
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  const sendOtp = async (e) => {
    e?.preventDefault();
    if (!/^[0-9]{10}$/.test(phone)) {
      return toast.error("Enter a valid 10-digit mobile number");
    }
    setBusy(true);
    try {
      await api.post("/auth/customer/request-otp", { phone });
      setPhase("otp");
      toast.success("OTP sent via WhatsApp");
      startResendCountdown();
    } catch (err) {
      const msg = err?.response?.data?.detail || "Could not send OTP — try again";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const startResendCountdown = () => {
    setResendCountdown(30);
    const tick = setInterval(() => {
      setResendCountdown((c) => {
        if (c <= 1) { clearInterval(tick); return 0; }
        return c - 1;
      });
    }, 1000);
  };

  const verifyOtp = async (e) => {
    e?.preventDefault();
    if (!/^[0-9]{6}$/.test(otp)) return toast.error("Enter the 6-digit OTP");
    setBusy(true);
    try {
      const { data } = await api.post("/auth/customer/verify-otp", { phone, otp });
      setCustomerSession(data.token, data.phone);
      toast.success("Signed in");
      onSuccess?.(data.phone, data.token);
    } catch (err) {
      const msg = err?.response?.data?.detail || "Invalid OTP";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-[#E5E2DC] rounded-3xl p-6 shadow-sm" data-testid="customer-otp-login">
      {title && <h2 className="text-xl font-display font-bold text-[#0A1F5C] tracking-tight">{title}</h2>}
      {subtitle && <p className="text-sm text-[#64748B] mt-1">{subtitle}</p>}

      {phase === "phone" ? (
        <form onSubmit={sendOtp} className="mt-5 space-y-3" data-testid="otp-phone-form">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#64748B]">Mobile number</div>
          <div className="flex items-center gap-3">
            <Phone size={16} className="text-[#E68910]" />
            <input
              data-testid="otp-phone-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="10-digit mobile"
              inputMode="numeric"
              autoFocus
              className="flex-1 px-3 py-2.5 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C] focus:border-[#E68910]"
            />
          </div>
          <button
            type="submit"
            disabled={busy || phone.length !== 10}
            data-testid="otp-send-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#0A1F5C] text-white text-sm font-semibold hover:bg-[#08174A] transition disabled:opacity-50"
          >
            {busy ? "Sending…" : <>Send OTP <ArrowRight size={14} /></>}
          </button>
          <p className="text-[11px] text-[#64748B] mt-2">
            We'll send a 6-digit code to your WhatsApp. By continuing you agree to our T&amp;Cs.
          </p>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="mt-5 space-y-3" data-testid="otp-verify-form">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#64748B]">
            6-digit code · sent to +91 {phone}
          </div>
          <div className="flex items-center gap-3">
            <ShieldCheck size={16} className="text-[#E68910]" />
            <input
              data-testid="otp-code-input"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              inputMode="numeric"
              autoFocus
              className="flex-1 px-3 py-2.5 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C] tracking-[0.4em] text-center font-semibold focus:border-[#E68910]"
            />
          </div>
          <button
            type="submit"
            disabled={busy || otp.length !== 6}
            data-testid="otp-verify-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#0A1F5C] text-white text-sm font-semibold hover:bg-[#08174A] transition disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify & Sign in"}
          </button>
          <div className="flex items-center justify-between text-xs mt-2">
            <button
              type="button"
              onClick={() => { setPhase("phone"); setOtp(""); }}
              data-testid="otp-change-phone"
              className="text-[#64748B] hover:text-[#0A1F5C]"
            >
              Change number
            </button>
            <button
              type="button"
              disabled={resendCountdown > 0 || busy}
              onClick={sendOtp}
              data-testid="otp-resend"
              className="text-[#E68910] hover:underline disabled:text-[#94A3B8] disabled:no-underline inline-flex items-center gap-1"
            >
              <RefreshCw size={12} />
              {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : "Resend OTP"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
