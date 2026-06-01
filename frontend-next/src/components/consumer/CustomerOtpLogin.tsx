"use client";

/**
 * Customer OTP login — phone → 6-digit OTP → JWT. On success:
 *   1. Stash token + phone in the Zustand store (which mirrors `bf_customer_token`
 *      + `bf_customer_phone` to localStorage for legacy compat).
 *   2. **Wishlist merge** — if a guest wishlist exists under
 *      `bf_wishlist_guest`, merge it into the new per-phone bucket and clear
 *      the guest one. Toast "Added N saved items to your wishlist".
 *   3. Dispatch `customer-auth:change` (Zustand setAuth already does this)
 *      so other tabs sync.
 *
 * The merge runs BEFORE setAuth so the ConsumerHeader badge reflects the
 * unified count on the first re-render after sign-in.
 */
import { useState } from "react";
import { Phone, ShieldCheck, ArrowRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import { useCustomerAuthStore } from "@/stores";
import { useWishlistStore } from "@/stores";
import type { CanonicalPhone, ProductCard } from "@/types";

interface Props {
  title?: string;
  subtitle?: string;
  onSuccess?: (phone: CanonicalPhone, token: string) => void;
}

function mergeGuestWishlist(canonicalPhone: CanonicalPhone): number {
  if (typeof window === "undefined") return 0;
  const guestKey = "bf_wishlist_guest";
  const phoneKey = `bf_wishlist_${canonicalPhone}`;
  try {
    const guestRaw = localStorage.getItem(guestKey);
    if (!guestRaw) return 0;
    const guest = JSON.parse(guestRaw) as ProductCard[];
    if (!Array.isArray(guest) || guest.length === 0) return 0;

    const phoneRaw = localStorage.getItem(phoneKey);
    const existing = phoneRaw ? (JSON.parse(phoneRaw) as ProductCard[]) : [];
    const existingIds = new Set(existing.map((p) => p.id));
    const newcomers = guest.filter((p) => !existingIds.has(p.id));
    if (newcomers.length === 0) {
      localStorage.removeItem(guestKey);
      return 0;
    }

    const merged = [...newcomers, ...existing];
    localStorage.setItem(phoneKey, JSON.stringify(merged));
    localStorage.removeItem(guestKey);
    // Re-hydrate the Zustand wishlist store under the new bucket key.
    useWishlistStore.getState().setPhone(canonicalPhone);
    return newcomers.length;
  } catch {
    return 0;
  }
}

export function CustomerOtpLogin({ title, subtitle, onSuccess }: Props) {
  const [phase, setPhase] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const setAuth = useCustomerAuthStore((s) => s.setAuth);

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
      await api.auth.requestCustomerOtp({ phone });
      setPhase("otp");
      toast.success("OTP sent via WhatsApp");
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
      const r = await api.auth.verifyCustomerOtp({ phone, otp });
      // 1. Merge guest wishlist into the new per-phone bucket FIRST so the
      //    badge count is correct on first render after setAuth.
      const merged = mergeGuestWishlist(r.phone);
      // 2. Set auth (dispatches customer-auth:change).
      setAuth(r.token, r.phone);
      // 3. UX feedback.
      toast.success("Signed in");
      if (merged > 0) {
        toast.message(`Added ${merged} saved item${merged === 1 ? "" : "s"} to your wishlist`);
      }
      onSuccess?.(r.phone, r.token);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-card-surface border border-card-border rounded-card-lg p-6 shadow-sm" data-testid="customer-otp-login">
      {title && <h2 className="font-display text-xl text-brand-primary tracking-tight">{title}</h2>}
      {subtitle && <p className="text-sm text-text-muted mt-1">{subtitle}</p>}

      {phase === "phone" ? (
        <form onSubmit={sendOtp} className="mt-5 space-y-3" data-testid="otp-phone-form">
          <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">Mobile number</div>
          <div className="flex items-center gap-3">
            <Phone size={16} className="text-brand-accent" />
            <input
              data-testid="otp-phone-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="10-digit mobile" inputMode="numeric" autoFocus
              className="flex-1 px-3 py-2.5 rounded-card border border-card-border outline-none text-brand-primary focus:border-brand-accent"
            />
          </div>
          <button type="submit" disabled={busy || phone.length !== 10} data-testid="otp-send-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-brand-primary text-white text-sm font-semibold hover:bg-brand-primary/90 transition disabled:opacity-50">
            {busy ? "Sending…" : <>Send OTP <ArrowRight size={14} /></>}
          </button>
          <p className="text-[11px] text-text-muted mt-2">
            We&apos;ll send a 6-digit code to your WhatsApp. By continuing you agree to our T&amp;Cs.
          </p>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="mt-5 space-y-3" data-testid="otp-verify-form">
          <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
            6-digit code · sent to +91 {phone}
          </div>
          <div className="flex items-center gap-3">
            <ShieldCheck size={16} className="text-brand-accent" />
            <input
              data-testid="otp-code-input"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••" inputMode="numeric" autoFocus
              className="flex-1 px-3 py-2.5 rounded-card border border-card-border outline-none text-brand-primary tracking-[0.4em] text-center font-semibold focus:border-brand-accent"
            />
          </div>
          <button type="submit" disabled={busy || otp.length !== 6} data-testid="otp-verify-btn"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-brand-primary text-white text-sm font-semibold hover:bg-brand-primary/90 transition disabled:opacity-50">
            {busy ? "Verifying…" : "Verify & Sign in"}
          </button>
          <div className="flex items-center justify-between text-xs mt-2">
            <button type="button" onClick={() => { setPhase("phone"); setOtp(""); }} data-testid="otp-change-phone" className="text-text-muted hover:text-brand-primary">
              Change number
            </button>
            <button type="button" disabled={cooldown > 0 || busy} onClick={() => sendOtp()} data-testid="otp-resend"
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
