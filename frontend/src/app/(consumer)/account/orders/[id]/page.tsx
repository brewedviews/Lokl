/* eslint-disable @typescript-eslint/no-empty-function */

// v3
"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useCustomerAuthStore } from "@/stores";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import OrderTrackingPage from "@/app/(consumer)/orders/[id]/page";

// Auth gate for order tracking. Shows OTP login if not authenticated,
// then renders the full OrderTrackingPage inline once auth is confirmed.
// The [id] param name matches so useParams() inside OrderTrackingPage resolves correctly.

export default function AccountOrderPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const isAuthenticated = useCustomerAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) {
    return <OrderAuthGate orderId={orderId} />;
  }

  return <OrderTrackingPage />;
}

function OrderAuthGate({ orderId }: { orderId: string }) {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setAuth = useCustomerAuthStore((s) => s.setAuth);

  const sendOtp = async () => {
    if (phone.length < 10) { setError("Enter a valid 10-digit number"); return; }
    setBusy(true); setError("");
    try {
      await apiClient.post("/api/auth/customer/request-otp", { phone });
      setStep("otp");
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (otp.length < 6) { setError("Enter the 6-digit OTP"); return; }
    setBusy(true); setError("");
    try {
      const r = await apiClient.post<{ token: string; phone: string }>(
        "/api/auth/customer/verify-otp",
        { phone, otp },
      );
      setAuth(r.data.token, r.data.phone, null);
      // isAuthenticated becomes true → component re-renders → shows OrderTrackingPage
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">📦</div>
          <h2 className="font-bold text-[#1A2B4C] text-xl">View your order</h2>
          <p className="text-[#595959] text-sm mt-1">
            Sign in with the mobile number used to place order{" "}
            <span className="font-mono font-semibold text-[#1A2B4C]">{orderId}</span>
          </p>
        </div>

        {step === "phone" ? (
          <div className="space-y-3">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="Your WhatsApp number"
              className="w-full px-4 py-3.5 rounded-2xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-[#1A2B4C] text-base"
            />
            {error && <p className="text-red-500 text-xs">{error}</p>}
            <button
              onClick={sendOtp}
              disabled={busy}
              className="w-full py-3.5 bg-[#E68910] text-white rounded-2xl font-bold text-base disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send OTP →"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[#595959] text-center">OTP sent to +91 {phone}</p>
            <input
              type="tel"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit OTP"
              className="w-full px-4 py-3.5 rounded-2xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-center text-2xl font-mono tracking-widest text-[#1A2B4C]"
            />
            {error && <p className="text-red-500 text-xs text-center">{error}</p>}
            <button
              onClick={verifyOtp}
              disabled={busy}
              className="w-full py-3.5 bg-[#1A2B4C] text-white rounded-2xl font-bold text-base disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Verify & View Order"}
            </button>
            <button
              onClick={() => { setStep("phone"); setError(""); }}
              className="w-full text-center text-sm text-[#9CA3AF]"
            >
              ← Change number
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
