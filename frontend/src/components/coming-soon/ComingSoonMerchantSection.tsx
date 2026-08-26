/**
 * ComingSoonMerchantSection — "FOR MERCHANTS". Promoted out of
 * ComingSoonClient.tsx into its own file per the brief's suggested
 * component list.
 *
 * Capability grid and stat cards are restricted to what's actually shipped
 * and verified against the real product before writing this copy:
 *   - "₹0 free to start, 10 products" — real Free plan
 *     (frontend/src/app/merchant/subscription/page.tsx's PLANS).
 *   - "0% commission" — verified true: no commission-on-sale logic exists
 *     anywhere in backend/server.py. Merchants pay an optional flat
 *     subscription for extra product slots/features, which is a different
 *     thing from a per-order cut.
 *   - Dropped the reference's "30 min setup" claim (unverified) — replaced
 *     with a non-numeric "Guided setup" stat.
 *   - The capability list (storefront, inventory, orders, pricing,
 *     returns/Try&Buy settings, analytics, bulk Excel/CSV upload, KYC
 *     onboarding, bank/payouts) mirrors merchant features already shipped
 *     in G6–G14, not aspirational ones.
 *
 * Primary CTA links directly to merchant.shoplokl.in (not a scroll-to,
 * per this brief). Secondary "Already registered? Sign in" -> /merchant/login,
 * confirmed a real route.
 */
const CAPABILITIES = [
  "Digital storefront", "Inventory management", "Order management",
  "Pricing control", "Returns & Try & Buy settings", "Sales analytics",
  "Bulk Excel/CSV upload", "KYC onboarding", "Bank & payouts",
];

const STATS = [
  { big: "₹0", title: "Free to start", body: "List up to 10 products at no cost. No subscription needed to begin." },
  { big: "0%", title: "Zero commission", body: "We don't take a cut. What the customer pays is what you receive." },
  { big: "+", title: "More footfall", body: "Every order can bring a new regular customer to your store." },
  { big: "✓", title: "Guided setup", body: "Our team helps you get listed — WhatsApp us your products." },
];

export function ComingSoonMerchantSection() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-8 py-14 sm:py-20" data-testid="coming-soon-merchant">
      <div className="bg-brand-primary rounded-[28px] px-6 sm:px-12 py-10 sm:py-14">
        <p className="text-[12px] font-bold text-brand-accent uppercase tracking-[0.15em] mb-2.5">For merchants</p>
        <h2 className="font-display font-black text-[24px] sm:text-[38px] text-white leading-tight tracking-tight mb-2.5">
          Your store. Online. For Bhilai.
        </h2>
        <p className="text-[15px] text-white/55 leading-relaxed max-w-lg mb-8">
          Shoppers already walk past your store without knowing what&apos;s on your shelves. Lokl gives your store a digital front door — inventory, orders, pricing and payouts, all in one place.
        </p>

        <div className="flex flex-wrap gap-x-6 gap-y-2 mb-8">
          {CAPABILITIES.map((c) => (
            <span key={c} className="text-white/90 text-[13px] font-medium">{c}</span>
          ))}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-9">
          {STATS.map((s) => (
            <div key={s.title} className="bg-white/[0.07] border border-white/10 rounded-2xl p-5">
              <div className="font-display font-black text-[26px] text-brand-accent tracking-tight mb-1.5">{s.big}</div>
              <h4 className="text-white font-bold text-sm mb-1">{s.title}</h4>
              <p className="text-white/45 text-xs leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <a
            href="https://merchant.shoplokl.in"
            data-testid="merchant-register-cta"
            className="inline-flex items-center gap-2 bg-brand-accent text-white font-extrabold text-[15px] px-7 py-3.5 rounded-full active:scale-95 transition"
          >
            Register your store
          </a>
          <a
            href="/merchant/login"
            data-testid="merchant-signin-cta"
            className="text-white/70 text-sm font-semibold hover:text-white hover:underline"
          >
            Already registered? Sign in
          </a>
        </div>
      </div>
    </section>
  );
}
