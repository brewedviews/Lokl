/**
 * ComingSoonMerchantSection — replaced the previous stat-card grid
 * (₹0/0%/+/✓ blocks) with a plain checklist, per this brief's explicit
 * "don't make this look like a pricing table" instruction. Checklist copy
 * is the brief's own literal wording. "Free for first month — Try and
 * decide" is verified against the real Free plan's own tagline ("Try Lokl
 * for 30 days" in frontend/src/app/merchant/subscription/page.tsx) — an
 * actual 30-day framing, not invented. "Keep 100% of what you earn" is
 * verified true: no commission-on-sale logic exists anywhere in
 * backend/server.py.
 *
 * Capability list mirrors merchant features already shipped in G6-G14
 * (catalogue/inventory, orders, pricing, Try & Buy, returns, analytics,
 * bulk XLSX/CSV import, store management) — presented as a compact plain
 * list, not an 8-card grid.
 */
const CHECKLIST = [
  "Get discovered by shoppers near your store",
  "Listed in minutes — our team sets it up with you",
  "Keep 100% of what you earn — always",
  "Free for first month — Try and decide",
];

const CAPABILITIES = [
  "Product catalogue & inventory", "Orders management", "Pricing & offers",
  "Try & Buy", "Returns management", "Analytics",
  "Bulk XLSX/CSV upload", "Store management",
];

export function ComingSoonMerchantSection() {
  return (
    <section id="merchants" className="max-w-4xl mx-auto px-4 sm:px-8 py-14 sm:py-20" data-testid="coming-soon-merchant">
      <div className="text-center mb-9">
        <p className="text-[12px] font-bold text-brand-accent uppercase tracking-[0.15em] mb-2.5">For merchants</p>
        <h2 className="font-display font-bold text-[24px] sm:text-[38px] text-brand-primary leading-tight tracking-tight mb-3">
          Your store. All of Bhilai. Zero commission.
        </h2>
        <p className="text-[15px] text-brand-primary/60 leading-relaxed max-w-lg mx-auto">
          Shoppers already walk past your store without knowing what&apos;s on your shelves. Lokl puts your products in front of people nearby who are ready to buy — without giving up a cut of every sale.
        </p>
      </div>

      <ul className="max-w-md mx-auto space-y-3 mb-10">
        {CHECKLIST.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-[14px] text-brand-primary font-medium">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="11" fill="#0A1F5C" />
              <path d="M7 12.5l3 3 7-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {item}
          </li>
        ))}
      </ul>

      <div className="border-t border-card-border pt-8 text-center">
        <p className="text-[11px] font-bold text-brand-primary/40 uppercase tracking-[0.15em] mb-4">What you get</p>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2.5 max-w-xl mx-auto mb-9">
          {CAPABILITIES.map((c) => (
            <span key={c} className="text-[13px] font-medium text-brand-primary/70">{c}</span>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
          <a
            href="https://merchant.shoplokl.in"
            data-testid="merchant-register-cta"
            className="inline-flex items-center gap-2 bg-brand-accent text-white font-bold text-[15px] px-7 py-3.5 rounded-full active:scale-95 transition"
          >
            Register your store
          </a>
          <a
            href="/merchant/login"
            data-testid="merchant-signin-cta"
            className="text-brand-primary/60 text-sm font-semibold hover:text-brand-primary hover:underline"
          >
            Already registered? Sign in
          </a>
        </div>
      </div>
    </section>
  );
}
