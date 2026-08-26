"use client";

/**
 * ComingSoonClient — G15. The public pre-launch marketplace experience for
 * shoplokl.in / www.shoplokl.in, replacing the old static coming-soon.html
 * (see middleware.ts's own doc comment for the routing change).
 *
 * Architecture per the brief: header -> hero -> categories -> marketplace
 * preview (products/stores/budget bento) -> why Lokl -> merchant section ->
 * flywheel -> waitlist -> launch status -> footer, reusing production
 * components/tokens wherever they're safely read-only (SellerCard,
 * BudgetBentoSection, TrustStickers-style visual language) and small new
 * siblings where the production component assumes live/transactional state
 * (header, hero, category nav, product cards) — see each component's own
 * doc comment for why. Nothing here can add to cart, wishlist, checkout, or
 * navigate to a real PDP/PLP; the waitlist form is the only mutation.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Zap, UserCheck, Loader2, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { ComingSoonHeader } from "./ComingSoonHeader";
import { ComingSoonHero } from "./ComingSoonHero";
import { ComingSoonCategoryChips } from "./ComingSoonCategoryChips";
import { ProductPreviewCard } from "./ProductPreviewCard";
import { SellerCard } from "@/components/consumer/SellerCard";
import { BudgetBentoSection } from "@/components/consumer/sections/BudgetBentoSection";
import type { ProductCard as ProductCardType, Store } from "@/types";

// ---------------------------------------------------------------------------
// Marketplace preview — real products + real stores, read-only
// ---------------------------------------------------------------------------
function MarketplacePreview() {
  const { data: products = [], isPending: productsPending } = useQuery({
    queryKey: ["coming-soon-products"],
    queryFn: async () => {
      const r = await apiClient.get<{ products: ProductCardType[] } | ProductCardType[]>("/api/products", { params: { sort: "discount", limit: 8 } });
      return Array.isArray(r.data) ? r.data : (r.data?.products || []);
    },
  });

  const { data: stores = [], isPending: storesPending } = useQuery({
    queryKey: ["coming-soon-stores"],
    queryFn: () => api.stores.list({ limit: 8 }),
  });

  return (
    <div id="preview">
      {!productsPending && products.length > 0 && (
        <section className="pt-8" data-testid="coming-soon-products-preview">
          <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto mb-4">
            <h2 className="font-display font-medium text-xl sm:text-2xl tracking-tight text-[#0A1F5C] leading-tight">
              From your neighbourhood, not a warehouse.
            </h2>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-pl-4 sm:scroll-pl-6 lg:scroll-pl-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
            {products.slice(0, 8).map((p) => (
              <div key={p.id} className="snap-start shrink-0 w-[38vw] sm:w-[180px] md:w-[200px]">
                <ProductPreviewCard p={p} />
              </div>
            ))}
          </div>
        </section>
      )}

      {!storesPending && stores.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10" data-testid="coming-soon-stores-preview">
          <h2 className="font-display font-medium text-xl sm:text-2xl tracking-tight text-[#0A1F5C] leading-tight mb-1">
            Your favourite stores, coming online.
          </h2>
          <p className="text-xs sm:text-sm text-[#64748B] mb-4">
            Local stores from across Bhilai will soon be available on Lokl.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(stores as Store[]).slice(0, 8).map((s) => (
              <SellerCard key={s.id} s={s} variant="discovery" previewMode fitToContainer source="coming_soon_stores" href="#preview" />
            ))}
          </div>
        </section>
      )}

      <BudgetBentoSection interactive={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Why Lokl — three pillars, TrustStickers' navy/orange/cream value-prop DNA
// ---------------------------------------------------------------------------
const PILLARS = [
  { icon: MapPin, title: "LOCAL", body: "Every store on Lokl is a real shop in Bhilai — not a warehouse three states away." },
  { icon: Zap, title: "FAST", body: "Orders come from nearby stores, so delivery times stay short and local." },
  { icon: UserCheck, title: "PERSONAL", body: "Try at your doorstep, easy returns set by the store, real people behind every order." },
];

function WhyLoklSection() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12" data-testid="coming-soon-why-lokl">
      <h2 className="font-display font-medium text-xl sm:text-2xl tracking-tight text-[#0A1F5C] leading-tight mb-5 text-center">
        Why Lokl?
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {PILLARS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-white rounded-2xl border border-[#E5E2DC] p-5 text-center">
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
// Merchant section — a major section, real capabilities only
// ---------------------------------------------------------------------------
const MERCHANT_CAPABILITIES = [
  "Add products one by one, or bulk-upload your whole catalog from an Excel/CSV file",
  "Manage inventory, orders and returns from one dashboard",
  "Set your own return window and Try & Buy eligibility per product",
  "Control when your store is online and taking orders",
  "Track sales with built-in analytics",
  "Get paid straight to your bank account",
];

function MerchantSection() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12" data-testid="coming-soon-merchant">
      <div className="bg-[#0A1F5C] rounded-2xl px-5 sm:px-8 py-8 sm:py-10">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#E68910] mb-2">For merchants</p>
        <h2 className="font-display font-medium text-2xl sm:text-3xl tracking-tight text-white leading-tight mb-2">
          Own a store in Bhilai?
        </h2>
        <p className="text-white/75 text-sm sm:text-base max-w-xl leading-relaxed mb-6">
          Put your store on Lokl and reach shoppers in your own neighbourhood — free to start, no storefront needed.
        </p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 mb-7">
          {MERCHANT_CAPABILITIES.map((c) => (
            <li key={c} className="flex items-start gap-2 text-white/90 text-[13px] leading-snug">
              <CheckCircle2 size={15} className="text-[#E68910] shrink-0 mt-0.5" />
              {c}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="https://merchant.shoplokl.in"
            data-testid="merchant-register-cta"
            className="inline-flex items-center gap-2 bg-[#E68910] text-white text-sm font-bold px-5 py-2.5 rounded-xl active:scale-95 transition"
          >
            Register your store
          </a>
          <a
            href="/merchant/login"
            data-testid="merchant-login-cta"
            className="text-white/70 text-sm font-semibold hover:text-white hover:underline"
          >
            Already registered? Sign in
          </a>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Flywheel — simple 4-step visual loop
// ---------------------------------------------------------------------------
const FLYWHEEL_STEPS = [
  "Customers discover local stores nearby",
  "Stores reach more nearby customers",
  "More local shopping happens",
  "More businesses join Lokl",
];

function FlywheelSection() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12" data-testid="coming-soon-flywheel">
      <h2 className="font-display font-medium text-xl sm:text-2xl tracking-tight text-[#0A1F5C] leading-tight mb-5 text-center">
        The more Bhilai joins, the better it gets.
      </h2>
      <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-2">
        {FLYWHEEL_STEPS.map((step, i) => (
          <div key={step} className="flex items-center gap-3 sm:gap-2 w-full sm:w-auto sm:flex-1">
            <div className="flex-1 bg-white border border-[#E5E2DC] rounded-xl px-4 py-3 text-center text-[13px] font-medium text-[#0A1F5C] leading-snug">
              {step}
            </div>
            {i < FLYWHEEL_STEPS.length - 1 && (
              <span className="text-[#E68910] text-lg font-bold shrink-0 rotate-90 sm:rotate-0">&rarr;</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Launch status — honest, real numbers only, never fabricated
// ---------------------------------------------------------------------------
function LaunchStatusSection() {
  const { data: stats } = useQuery({
    queryKey: ["coming-soon-stats"],
    queryFn: () => api.site.homeStatsReal(),
    staleTime: 60_000,
  });

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12" data-testid="coming-soon-launch-status">
      <div className="bg-[#F4F1E9] rounded-2xl px-5 sm:px-8 py-7 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-[#E68910]" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-[#0A1F5C]">Coming soon &middot; Bhilai</span>
        </div>
        <h2 className="font-display font-medium text-xl sm:text-2xl tracking-tight text-[#0A1F5C] leading-tight">
          Lokl is getting ready for Bhilai.
        </h2>
        {stats && stats.verified_stores > 0 && (
          <p className="text-sm text-[#64748B] mt-2">
            {stats.verified_stores} local stores already on Lokl, with more joining every week.
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Waitlist — the primary conversion mechanism, existing backend unchanged
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
    <section id="waitlist" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12" data-testid="coming-soon-waitlist">
      <div className="bg-white border border-[#E5E2DC] rounded-2xl px-5 sm:px-8 py-8 sm:py-10 max-w-xl mx-auto text-center">
        <h2 className="font-display font-medium text-2xl sm:text-3xl tracking-tight text-[#0A1F5C] leading-tight mb-2">
          Be first to shop Lokl.
        </h2>
        <p className="text-sm text-[#64748B] mb-6">
          Join the waitlist and we&apos;ll let you know the moment Lokl goes live in your neighbourhood.
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
              className="flex-1 rounded-xl border border-[#E5E2DC] px-4 py-2.5 text-sm text-[#0A1F5C] outline-none focus:border-[#0A1F5C]/40"
            />
            <button
              type="submit"
              disabled={status === "submitting"}
              data-testid="waitlist-submit"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#E68910] text-white text-sm font-bold px-5 py-2.5 active:scale-95 transition disabled:opacity-60"
            >
              {status === "submitting" && <Loader2 size={14} className="animate-spin" />}
              Join the waitlist
            </button>
          </form>
        )}
        {error && <p className="text-xs text-red-500 mt-2" data-testid="waitlist-error">{error}</p>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------
function ComingSoonFooter() {
  return (
    <footer className="mt-14 border-t border-[#E5E2DC] bg-white" data-testid="coming-soon-footer">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid grid-cols-2 sm:grid-cols-4 gap-8">
        <div className="col-span-2 sm:col-span-1">
          <span className="font-display text-xl font-bold tracking-tight text-brand-primary">
            lokl<span className="text-brand-accent">.</span>
          </span>
          <p className="text-xs text-[#64748B] mt-2">Bhilai&apos;s own neighbourhood shopping app.</p>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#0A1F5C]/50 mb-2">Customer</div>
          <ul className="space-y-1.5 text-[13px]">
            <li><a href="#waitlist" className="text-[#0A1F5C]/70 hover:text-[#0A1F5C]">Join waitlist</a></li>
            <li><a href="/contact" className="text-[#0A1F5C]/70 hover:text-[#0A1F5C]">Support</a></li>
          </ul>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#0A1F5C]/50 mb-2">Merchant</div>
          <ul className="space-y-1.5 text-[13px]">
            <li><a href="https://merchant.shoplokl.in" className="text-[#0A1F5C]/70 hover:text-[#0A1F5C]">Register your store</a></li>
            <li><a href="/merchant/login" className="text-[#0A1F5C]/70 hover:text-[#0A1F5C]">Merchant login</a></li>
          </ul>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#0A1F5C]/50 mb-2">Contact</div>
          <ul className="space-y-1.5 text-[13px]">
            <li><a href="mailto:hello@shoplokl.in" className="text-[#0A1F5C]/70 hover:text-[#0A1F5C]">hello@shoplokl.in</a></li>
          </ul>
        </div>
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
        <ComingSoonCategoryChips />
        <MarketplacePreview />
        <WhyLoklSection />
        <MerchantSection />
        <FlywheelSection />
        <WaitlistSection />
        <LaunchStatusSection />
      </main>
      <ComingSoonFooter />
    </div>
  );
}
