/**
 * ComingSoonHowItWorks — 4-step structure kept from
 * docs/design/lokl-coming-soon-redesign.html, copy rewritten to drop the
 * unverified "delivered in 30/45 min" claim (no platform-wide guaranteed
 * delivery time exists — see the plan's claim-verification notes).
 */
const STEPS = [
  { n: 1, title: "Discover local stores", body: "See the shops already around you in Bhilai, all in one place." },
  { n: 2, title: "Find what you need", body: "Browse real products and real stock — fashion, footwear and more." },
  { n: 3, title: "Order from your neighbourhood", body: "Place your order in a couple of taps, right from your phone." },
  { n: 4, title: "Get it delivered, or visit the store", body: "Have it brought to your door, or reserve it and visit — whichever the store supports." },
];

export function ComingSoonHowItWorks() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-8 py-14 sm:py-20" data-testid="coming-soon-how-it-works">
      <p className="text-[12px] font-bold text-brand-accent uppercase tracking-[0.15em] mb-2.5">How Lokl works</p>
      <h2 className="font-display font-black text-[24px] sm:text-[38px] text-brand-primary leading-tight tracking-tight mb-2.5">
        Local shopping, minus the driving around.
      </h2>
      <p className="text-[15px] text-[#595959] leading-relaxed max-w-md mb-12">
        Lokl connects you to stores that are already in your neighbourhood, so you never have to guess what they have in stock.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {STEPS.map((s) => (
          <div key={s.n} className="bg-white border border-card-border rounded-2xl p-7">
            <div className="w-9 h-9 rounded-[10px] bg-brand-primary text-white flex items-center justify-center font-black text-[15px] mb-4">
              {s.n}
            </div>
            <div className="font-bold text-brand-primary text-base mb-2 tracking-tight">{s.title}</div>
            <p className="text-[13px] text-[#595959] leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
