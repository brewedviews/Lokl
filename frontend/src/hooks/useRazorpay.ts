"use client";

/**
 * Lazy-loads the Razorpay Checkout script once per page and exposes a
 * typed `openCheckout(...)` helper. The script tag is removed only on
 * full page unmount because the checkout SDK installs handlers on
 * `window` and re-loading mid-session causes the modal to flicker.
 */
import { useEffect, useState } from "react";

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  image?: string;
  handler: (response: RazorpayResponse) => void;
  prefill: { name?: string; contact: string; email?: string };
  theme: { color: string };
  modal: {
    ondismiss: () => void;
    escape: boolean;
  };
  notes?: Record<string, string>;
}

export interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
  close: () => void;
}

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export function useRazorpay() {
  const [loaded, setLoaded] = useState<boolean>(() =>
    typeof window !== "undefined" && !!window.Razorpay,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.Razorpay) {
      setLoaded(true);
      return;
    }
    // Reuse an existing script tag if any other component already injected it.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => setLoaded(true), { once: true });
      if (window.Razorpay) setLoaded(true);
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => setLoaded(true);
    s.onerror = () => {
      // eslint-disable-next-line no-console
      console.error("[Razorpay] checkout.js failed to load");
    };
    document.body.appendChild(s);
    // We intentionally do not remove the script in cleanup — the SDK keeps
    // singletons on window and mid-session removal causes the modal to
    // flicker on remount. A full navigation unloads the page anyway.
  }, []);

  const openCheckout = (options: RazorpayOptions): void => {
    if (typeof window === "undefined" || !window.Razorpay) {
      throw new Error("Razorpay not loaded");
    }
    const rzp = new window.Razorpay(options);
    rzp.open();
  };

  return { loaded, openCheckout };
}
