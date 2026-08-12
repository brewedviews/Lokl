"use client";

/**
 * Rider OTP login — phone → 6-digit OTP → JWT. Modeled directly on
 * CustomerOtpLogin.tsx (same two-phase phone/otp flow), pointed at
 * /api/auth/rider/request-otp + /verify-otp instead.
 *
 * Riders are admin-provisioned, not self-registered (see rider_request_otp
 * in server.py) — the backend deliberately returns the SAME generic
 * response whether or not the phone is a registered/active rider, so this
 * component never tries to distinguish "unregistered" from "registered" at
 * the request-otp step. The distinction only surfaces naturally at verify
 * time (no OTP was ever actually sent for an unregistered phone, so any
 * code entered fails with the backend's own "OTP not found or expired"
 * message) — exactly the graceful, non-enumerating behavior the backend
 * was built for.
 */
import { useState } from "react";
import { Phone, ShieldCheck, ArrowRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import { useRiderAuthStore } from "@/stores";
import type { CanonicalPhone } from "@/types";

interface Props {
  onSuccess?: (phone: CanonicalPhone, token: string) => void;
}

export function RiderOtpLogin({ onSuccess }: Props) {
  const [phase, setPhase] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const setAuth = useRiderAuthStore((s) => s.setAuth);

  const startCooldown = () => {
    setCooldown(30);
    const t = window.setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { window.clearInterval(t); return 0; }
        return c - 1;
      });
    }, 1000);
  };

  const sendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!/^[0-9]{10}$/.test(phone)) return toast.error("Enter a valid 10-digit mobile number");
    setBusy(true);
    try {
      await api.rider.requestOtp({ phone });
      setPhase("otp");
      toast.success("If this number is registered, an OTP has been sent");
      startCooldown();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally { setBusy(false); }
  };

  const verifyOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!/^[0-9]{6}$/.test(otp)) return toast.error("Enter the 6-digit OTP");
    setBusy(true);
    try {
      const r = await api.rider.verifyOtp({ phone, otp });
      setAuth(r.token, r.phone, r.rider);
      toast.success(`Welcome, ${r.rider?.name || "rider"}`);
      onSuccess?.(r.phone, r.token);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-card-surface border border-card-border rounded-card-lg p-6 shadow-sm" data-testid="rider-otp-login">
      {phase === "phone" ? (
        <form onSubmit={sendOtp} className="space-y-3" data-testid="rider-otp-phone-form">
          <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">Mobile number</div>
          <div className="flex items-center gap-3">
            <Phone size={18} className="text-brand-accent" />
            <input
              data-testid="rider-otp-phone-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="10-digit mobile" inputMode="numeric" autoFocus
              className="flex-1 px-3 py-3 text-base rounded-card border border-card-border outline-none text-brand-primary focus:border-brand-accent"
            />
          </div>
          <button type="submit" disabled={busy || phone.length !== 10} data-testid="rider-otp-send-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-full bg-brand-primary text-white text-base font-bold hover:bg-brand-primary/90 transition disabled:opacity-50">
            {busy ? "Sending…" : <>Send OTP <ArrowRight size={16} /></>}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="space-y-3" data-testid="rider-otp-verify-form">
          <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
            6-digit code · sent to +91 {phone}
          </div>
          <div className="flex items-center gap-3">
            <ShieldCheck size={18} className="text-brand-accent" />
            <input
              data-testid="rider-otp-code-input"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••" inputMode="numeric" autoFocus
              className="flex-1 px-3 py-3 text-base rounded-card border border-card-border outline-none text-brand-primary tracking-[0.4em] text-center font-semibold focus:border-brand-accent"
            />
          </div>
          <button type="submit" disabled={busy || otp.length !== 6} data-testid="rider-otp-verify-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-full bg-brand-primary text-white text-base font-bold hover:bg-brand-primary/90 transition disabled:opacity-50">
            {busy ? "Verifying…" : "Verify & Sign in"}
          </button>
          <div className="flex items-center justify-between text-xs mt-2">
            <button type="button" onClick={() => { setPhase("phone"); setOtp(""); }} data-testid="rider-otp-change-phone" className="text-text-muted hover:text-brand-primary">
              Change number
            </button>
            <button type="button" disabled={cooldown > 0 || busy} onClick={() => sendOtp()} data-testid="rider-otp-resend"
              className="text-brand-accent hover:underline disabled:text-slate-400 disabled:no-underline inline-flex items-center gap-1">
              <RefreshCw size={12} />
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
