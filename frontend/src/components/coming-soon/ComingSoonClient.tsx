"use client";

/**
 * ComingSoonClient — G16. The public pre-launch landing page for
 * shoplokl.in / www.shoplokl.in (see middleware.ts's own doc comment for
 * the routing).
 *
 * G15 originally built this as a marketplace preview (real product/store
 * rails, Budget Bento, category browsing). G16 replaces that direction
 * entirely: this is a short, editorial brand/waitlist landing page with NO
 * marketplace browsing surface at all — no products, no stores, no
 * categories, no marketplace stats. The production design language
 * (typography, color tokens, hero treatment) still inspires the page; the
 * page itself is not a preview of the marketplace. Structure: header ->
 * hero -> intro -> three pillars -> merchant section -> waitlist -> closing
 * statement -> footer. The waitlist is the only mutation anywhere on the
 * page, via the existing, unmodified `/api/waitlist` endpoint.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, ShoppingBag, UserCheck, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { ComingSoonHeader } from "./ComingSoonHeader";
import { ComingSoonHero } from "./ComingSoonHero";

// ---------------------------------------------------------------------------
// Intro — short editorial statement, no card
// ---------------------------------------------------------------------------
function IntroSection() {
  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 text-center" data-testid="coming-soon-intro">
      <h2 className="font-display font-medium text-2xl sm:text-4xl tracking-tight text-[#0A1F5C] leading-tight">
        Local stores deserve to be online.
      </h2>
      <p className="text-sm sm:text-base text-[#64748B] mt-3 leading-relaxed">
        Lokl is building a digital marketplace for neighbourhood businesses — helping local stores reach more customers while making local shopping simpler for everyone.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Three pillars — brand-oriented, not feature-oriented
// ---------------------------------------------------------------------------
const PILLARS = [
  { icon: MapPin, title: "LOCAL", body: "Your neighbourhood stores, closer than ever." },
  { icon: ShoppingBag, title: "CONVENIENT", body: "Discover and shop locally from one place." },
  { icon: UserCheck, title: "PERSONAL", body: "A marketplace built around the businesses and communities you know." },
];

function PillarsSection() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12" data-testid="coming-soon-pillars">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {PILLARS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-white rounded-2xl border border-[#E5E2DC] p-6 text-center">
            <div className="w-11 h-11 rounded-full bg-[#E68910]/15 flex items-center justify-center mx-auto mb-3">
              <Icon size={20} className="text-[#E68910]" />
            </div>
            <div className="font-display font-bold text-sm tracking-wide text-[#0A1F5C]">{title}</div>
            <p className="text-[13px] text-[#64748B] mt-1.5 leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Merchant section — the only substantial secondary section, kept compact
// ---------------------------------------------------------------------------
const MERCHANT_CAPABILITIES = [
  "Digital storefront",
  "Product management",
  "Inventory management",
  "Orders",
  "Analytics",
  "Bulk Excel/CSV upload",
  "Returns",
  "Try & Buy",
];

function MerchantSection() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14" data-testid="coming-soon-merchant">
      <div className="bg-[#0A1F5C] rounded-2xl px-5 sm:px-8 py-8 sm:py-10">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#E68910] mb-2">Have a store in Bhilai?</p>
        <h2 className="font-display font-medium text-2xl sm:text-3xl tracking-tight text-white leading-tight mb-2">
          Take your store online with Lokl.
        </h2>
        <p className="text-white/75 text-sm sm:text-base max-w-xl leading-relaxed mb-6">
          Lokl gives local businesses the tools to create their storefront, manage products, receive orders and grow their business online.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-2 mb-7">
          {MERCHANT_CAPABILITIES.map((c) => (
            <span key={c} className="text-white/90 text-[13px] font-medium">
              {c}
            </span>
          ))}
        </div>
        <a
          href="https://merchant.shoplokl.in"
          data-testid="merchant-register-cta"
          className="inline-flex items-center gap-2 bg-[#E68910] text-white text-sm font-bold px-5 py-2.5 rounded-xl active:scale-95 transition"
        >
          Register your store
        </a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Waitlist — the main conversion section, existing backend unchanged
// ---------------------------------------------------------------------------
function WaitlistSection() {
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState("");

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
      await api.site.joinWaitlist({ phone: digits, type: "customer" });
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Something went wrong — please try again.");
    }
  };

  return (
    <section id="waitlist" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14" data-testid="coming-soon-waitlist">
      <div className="bg-[#F4F1E9] rounded-2xl px-5 sm:px-8 py-10 sm:py-12 max-w-xl mx-auto text-center">
        <h2 className="font-display font-medium text-2xl sm:text-3xl tracking-tight text-[#0A1F5C] leading-tight mb-2">
          Bhilai, we&apos;re getting ready.
        </h2>
        <p className="text-sm text-[#64748B] mb-6">
          Lokl is launching soon. Join the waitlist and we&apos;ll let you know when we&apos;re ready.
        </p>

        {status === "done" ? (
          <div data-testid="waitlist-success" className="flex flex-col items-center gap-2 py-4">
            <CheckCircle2 size={32} className="text-[#22C55E]" />
            <p className="font-semibold text-[#0A1F5C]">You&apos;re on the list!</p>
            <p className="text-sm text-[#64748B]">We&apos;ll text you when Lokl launches in Bhilai.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2" data-testid="waitlist-form">
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Your phone number"
              data-testid="waitlist-phone-input"
              className="flex-1 rounded-xl border border-[#E5E2DC] bg-white px-4 py-2.5 text-sm text-[#0A1F5C] outline-none focus:border-[#0A1F5C]/40"
            />
            <button
              type="submit"
              disabled={status === "submitting"}
              data-testid="waitlist-submit"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#E68910] text-white text-sm font-bold px-5 py-2.5 active:scale-95 transition disabled:opacity-60"
            >
              {status === "submitting" && <Loader2 size={14} className="animate-spin" />}
              Notify me
            </button>
          </form>
        )}
        {error && <p className="text-xs text-red-500 mt-2" data-testid="waitlist-error">{error}</p>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Closing statement — visual, not another feature section
// ---------------------------------------------------------------------------
function ClosingSection() {
  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-4 text-center" data-testid="coming-soon-closing">
      <h2 className="font-display font-medium text-2xl sm:text-4xl tracking-tight text-[#0A1F5C] leading-tight">
        The future of local shopping is local.
      </h2>
      <p className="text-sm sm:text-base text-[#64748B] mt-2">Lokl is coming soon.</p>
      <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
        <a
          href="#waitlist"
          data-testid="closing-waitlist-cta"
          className="inline-flex items-center rounded-full bg-brand-accent text-white text-sm font-bold px-5 py-2.5 active:scale-95 transition"
        >
          Join the waitlist
        </a>
        <a
          href="https://merchant.shoplokl.in"
          data-testid="closing-merchant-cta"
          className="inline-flex items-center rounded-full border border-[#0A1F5C]/25 text-[#0A1F5C] text-sm font-bold px-5 py-2.5 active:scale-95 transition"
        >
          Register your store
        </a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer — minimal, single row
// ---------------------------------------------------------------------------
function ComingSoonFooter() {
  return (
    <footer className="mt-10 border-t border-[#E5E2DC] bg-white" data-testid="coming-soon-footer">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <span className="font-display text-xl font-bold tracking-tight text-brand-primary">
          lokl<span className="text-brand-accent">.</span>
        </span>
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] font-medium text-[#0A1F5C]/70">
          <a href="https://merchant.shoplokl.in" className="hover:text-[#0A1F5C]">For Merchants</a>
          <a href="/about" className="hover:text-[#0A1F5C]">About</a>
          <a href="/contact" className="hover:text-[#0A1F5C]">Contact</a>
          <a href="/privacy" className="hover:text-[#0A1F5C]">Privacy</a>
          <a href="/terms" className="hover:text-[#0A1F5C]">Terms</a>
        </nav>
      </div>
    </footer>
  );
}

export function ComingSoonClient() {
  const loggedView = useRef(false);
  useEffect(() => {
    if (loggedView.current) return;
    loggedView.current = true;
    apiClient.post("/api/page-view", {}, { params: { page: "coming-soon" } }).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <ComingSoonHeader />
      <main className="flex-1">
        <ComingSoonHero />
        <IntroSection />
        <PillarsSection />
        <MerchantSection />
        <WaitlistSection />
        <ClosingSection />
      </main>
      <ComingSoonFooter />
    </div>
  );
}
