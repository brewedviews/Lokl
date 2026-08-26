/**
 * ComingSoonHowItWorks — G17, from docs/design/coming-soon-v2.html's
 * "How it works" section. Static 4-card grid, no data fetching.
 */
const STEPS = [
  { n: 1, title: "Browse real stores", body: "See actual products from shops in Bhilai — real prices, real stock, updated daily." },
  { n: 2, title: "Order in seconds", body: "Pick your size, tap order. No advance payment. Pay cash when it arrives." },
  { n: 3, title: "Delivered in 30 min", body: "A local rider picks it up from the store and brings it straight to your door." },
  { n: 4, title: "Or reserve and visit", body: "Rather see it first? Reserve your item, visit the store, try it, pay only if you like it." },
];

export function ComingSoonHowItWorks() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-8 py-14 sm:py-20" data-testid="coming-soon-how-it-works">
      <p className="text-[12px] font-bold text-brand-accent uppercase tracking-[0.15em] mb-2.5">How it works</p>
      <h2 className="font-display font-black text-[24px] sm:text-[38px] text-brand-primary leading-tight tracking-tight mb-2.5">
        Shopping local, made effortless
      </h2>
      <p className="text-[15px] text-[#595959] leading-relaxed max-w-md mb-12">
        No more driving around. Browse from home, get it at your door in 30 minutes.
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
