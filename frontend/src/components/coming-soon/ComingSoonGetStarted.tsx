"use client";

/**
 * ComingSoonGetStarted — the "get started" section from
 * docs/design/lokl-coming-soon-redesign.html: two permanently-visible
 * cards (customer, merchant), not a single tabbed form — matches the
 * reference's actual `start-grid` structure rather than G17's embedded
 * tabbed card.
 *
 * Both cards post to the existing, unmodified `/api/waitlist` via
 * `api.site.joinWaitlist()`. The merchant card is deliberately phone-only
 * (no store name/category) per this brief's explicit "don't add
 * unnecessary friction" instruction, then redirects to
 * merchant.shoplokl.in after a brief inline confirmation — the customer
 * card never redirects and shows a permanent inline success state instead.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

function SuccessCheck({ tone }: { tone: "customer" | "merchant" }) {
  return (
    <div className={`w-11 h-11 rounded-full flex items-center justify-center mx-auto mb-3.5 ${tone === "customer" ? "bg-[#E8F5E9]" : "bg-white/15"}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M5 13l4 4L19 7" stroke={tone === "customer" ? "#2E7D32" : "#fff"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function CustomerCard() {
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting" || status === "done") return;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setError("Enter a valid 10-digit phone number"); return; }
    setError("");
    setStatus("submitting");
    try {
      await api.site.joinWaitlist({ phone: digits, type: "customer" });
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Something went wrong — please try again.");
    }
  };

  return (
    <div className="bg-white border border-card-border border-t-4 border-t-brand-accent rounded-3xl p-7 sm:p-9" data-testid="get-started-customer">
      <span className="inline-block text-[11px] font-black uppercase tracking-wide text-brand-accent bg-brand-accent/10 rounded-full px-3 py-1 mb-4">For customers</span>
      <div className="font-bold text-lg text-brand-primary mb-1.5 tracking-tight">Join the waitlist</div>
      <p className="text-[13px] text-[#595959] mb-6 leading-snug">Be first to shop when Lokl goes live in Bhilai.</p>

      {status === "done" ? (
        <div data-testid="waitlist-success" className="text-center py-2">
          <SuccessCheck tone="customer" />
          <p className="font-bold text-[16px] text-brand-primary mb-1.5">You&apos;re on the list.</p>
          <p className="text-[13px] text-[#595959] leading-relaxed">We&apos;ll let you know when Lokl goes live in Bhilai.</p>
        </div>
      ) : (
        <form onSubmit={submit} data-testid="waitlist-form">
          <label className="block text-[11.5px] font-bold text-brand-primary mb-1.5 uppercase tracking-wide">WhatsApp number</label>
          <input
            type="tel"
            inputMode="numeric"
            maxLength={10}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98765 43210"
            data-testid="waitlist-phone-input"
            className="w-full px-4 py-3 rounded-xl border-[1.5px] border-card-border bg-brand-bg text-sm text-brand-primary outline-none focus:border-brand-accent focus:bg-white transition mb-3.5"
          />
          <button
            type="submit"
            disabled={status === "submitting"}
            data-testid="waitlist-submit"
            className="w-full py-3.5 rounded-full bg-brand-accent text-white text-[14.5px] font-extrabold active:scale-[0.985] transition disabled:opacity-70 inline-flex items-center justify-center gap-1.5"
          >
            {status === "submitting" && <Loader2 size={14} className="animate-spin" />}
            Join the waitlist
          </button>
          <p className="text-[11.5px] text-[#9a9a9a] text-center mt-3 leading-relaxed">We&apos;ll WhatsApp you when Lokl goes live. No spam.</p>
          {error && <p className="text-xs text-red-500 mt-2 text-center" data-testid="waitlist-error">{error}</p>}
        </form>
      )}
    </div>
  );
}

function MerchantCard() {
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting" || status === "done") return;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setError("Enter a valid 10-digit phone number"); return; }
    setError("");
    setStatus("submitting");
    try {
      await api.site.joinWaitlist({ phone: digits, type: "merchant" });
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Something went wrong — please try again.");
      return;
    }
    // Merchant flow captures the phone in our own waitlist, then hands off
    // to the real merchant onboarding app — the brief's explicit
    // instruction that merchants should not sit on this page afterward.
    window.setTimeout(() => {
      window.location.href = "https://merchant.shoplokl.in?ref=coming_soon";
    }, 900);
  };

  return (
    <div className="bg-brand-primary border-t-4 border-t-brand-accent rounded-3xl p-7 sm:p-9" data-testid="get-started-merchant">
      <span className="inline-block text-[11px] font-black uppercase tracking-wide text-brand-accent bg-white/10 rounded-full px-3 py-1 mb-4">For store owners</span>
      <div className="font-bold text-lg text-white mb-1.5 tracking-tight">Register your store</div>
      <p className="text-[13px] text-white/55 mb-6 leading-snug">Enter your number and we&apos;ll take you to store sign-up.</p>

      {status === "done" ? (
        <div data-testid="merchant-waitlist-success" className="text-center py-2">
          <SuccessCheck tone="merchant" />
          <p className="font-bold text-[16px] text-white mb-1.5">Taking you to sign-up…</p>
          <p className="text-[13px] text-white/55 leading-relaxed">Redirecting you to merchant.shoplokl.in to finish setting up your store.</p>
        </div>
      ) : (
        <form onSubmit={submit} data-testid="merchant-waitlist-form">
          <label className="block text-[11.5px] font-bold text-white/70 mb-1.5 uppercase tracking-wide">WhatsApp number</label>
          <input
            type="tel"
            inputMode="numeric"
            maxLength={10}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98765 43210"
            data-testid="merchant-phone-input"
            className="w-full px-4 py-3 rounded-xl border-[1.5px] border-white/15 bg-white/[0.06] text-sm text-white placeholder-white/35 outline-none focus:border-brand-accent focus:bg-white/10 transition mb-3.5"
          />
          <button
            type="submit"
            disabled={status === "submitting"}
            data-testid="merchant-submit"
            className="w-full py-3.5 rounded-full bg-brand-accent text-white text-[14.5px] font-extrabold active:scale-[0.985] transition disabled:opacity-70 inline-flex items-center justify-center gap-1.5"
          >
            {status === "submitting" && <Loader2 size={14} className="animate-spin" />}
            Register my store
          </button>
          {error && <p className="text-xs text-red-300 mt-2 text-center" data-testid="merchant-waitlist-error">{error}</p>}
        </form>
      )}
    </div>
  );
}

export function ComingSoonGetStarted() {
  return (
    <section id="get-started" className="max-w-6xl mx-auto px-4 sm:px-8 py-14 sm:py-20" data-testid="coming-soon-get-started">
      <p className="text-[12px] font-bold text-brand-accent uppercase tracking-[0.15em] mb-2.5">Get started</p>
      <h2 className="font-display font-black text-[24px] sm:text-[38px] text-brand-primary leading-tight tracking-tight mb-2.5">
        Two ways in. Pick yours.
      </h2>
      <p className="text-[15px] text-[#595959] leading-relaxed max-w-md mb-10">
        Whether you&apos;re here to shop or to sell, it takes less than a minute to get on the list.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <CustomerCard />
        <MerchantCard />
      </div>
    </section>
  );
}
