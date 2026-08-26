/**
 * ComingSoonWhyLokl — customer positioning + differentiation, merged into
 * one section rather than stacked as two (the brief's own architecture
 * list treats "Why Lokl" as one section; its separate "customer
 * positioning" copy reads as this section's lead-in, not a sixth section
 * repeating the same 4-5 benefits already in the hero strip). Plain
 * compact list, not colored cards — the hero strip already carries the
 * icon treatment; this section is about differentiation, not a repeat of
 * the same facts.
 */
const POINTS = ["Local stores", "Fast delivery", "Try & Buy", "Pay at delivery", "24-hour returns"];

export function ComingSoonWhyLokl() {
  return (
    <section id="why-lokl" className="max-w-3xl mx-auto px-4 sm:px-8 py-14 sm:py-20 text-center" data-testid="coming-soon-why-lokl">
      <h2 className="font-display font-bold text-[24px] sm:text-[36px] text-brand-primary leading-[1.2] tracking-tight">
        The stores you already know.
        <span className="block text-brand-accent">Now on your phone.</span>
      </h2>
      <p className="mt-5 text-[15px] sm:text-base text-brand-primary/60 leading-relaxed max-w-lg mx-auto">
        Lokl is focused on bringing the clothing and footwear stores already in your neighbourhood online — instead of making you travel across Bhilai looking for what they have.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-3 mt-8">
        {POINTS.map((p, i) => (
          <span key={p} className="flex items-center gap-3">
            <span className="text-[13px] sm:text-sm font-semibold text-brand-primary">{p}</span>
            {i < POINTS.length - 1 && <span className="w-1 h-1 rounded-full bg-card-border" />}
          </span>
        ))}
      </div>
    </section>
  );
}
