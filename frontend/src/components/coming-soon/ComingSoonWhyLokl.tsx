/**
 * ComingSoonWhyLokl — G17, from docs/design/coming-soon-v2.html's "Why
 * Lokl" section. Three cards, deliberately asymmetric coloring (navy /
 * orange / white-outline) matching the reference, not a uniform grid.
 */
const CARDS = [
  { emoji: "🏪", tone: "navy" as const, title: "Real local stores", body: "Every product comes from a store physically in Bhilai. You're supporting shops you already know." },
  { emoji: "⚡", tone: "orange" as const, title: "30 minute delivery", body: "When the store is nearby, delivery is fast. No waiting days for something already in your city." },
  { emoji: "💸", tone: "white" as const, title: "Pay at the door", body: "No advance payment, no card details needed. Order online, pay cash when it arrives." },
];

export function ComingSoonWhyLokl() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-8 py-14 sm:py-20" data-testid="coming-soon-why-lokl">
      <p className="text-[12px] font-bold text-brand-accent uppercase tracking-[0.15em] mb-2.5">Why Lokl</p>
      <h2 className="font-display font-black text-[24px] sm:text-[38px] text-brand-primary leading-tight tracking-tight mb-2.5">
        Built for Bhilai.<br />Not borrowed from Delhi.
      </h2>
      <p className="text-[15px] text-[#595959] leading-relaxed max-w-md mb-12">
        Other apps ship from warehouses hours away. We bring it from the store down the road.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {CARDS.map((c) => (
          <div
            key={c.title}
            className={`rounded-[18px] p-6 ${
              c.tone === "navy" ? "bg-brand-primary text-white"
              : c.tone === "orange" ? "bg-brand-accent text-white"
              : "bg-white border border-card-border text-brand-primary"
            }`}
          >
            <div className="text-[28px] mb-2.5 leading-none">{c.emoji}</div>
            <div className={`font-bold text-[15px] mb-1.5 tracking-tight ${c.tone === "white" ? "text-brand-primary" : "text-white"}`}>{c.title}</div>
            <p className={`text-[13px] leading-relaxed ${c.tone === "white" ? "text-[#595959]" : "text-white/65"}`}>{c.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
