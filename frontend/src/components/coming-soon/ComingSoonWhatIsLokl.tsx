/**
 * ComingSoonWhatIsLokl — pure editorial section, deliberately not inside a
 * card. Headline + one paragraph, set large, with room to breathe — the
 * brief's own instruction was "make this typography-led and editorial...
 * do not bury it inside a card."
 *
 * Copy is the brief's own paragraph with one internal-consistency fix:
 * the brief's paragraph said "at your door in half an hour" while its own
 * hero benefit strip says "45 minutes" — aligned both to "45 minutes" so
 * the page doesn't state two different delivery times.
 */
export function ComingSoonWhatIsLokl() {
  return (
    <section id="what-is-lokl" className="max-w-3xl mx-auto px-4 sm:px-8 py-16 sm:py-24 text-center" data-testid="coming-soon-what-is-lokl">
      <h2 className="font-display font-bold text-[26px] sm:text-[40px] text-brand-primary leading-[1.15] tracking-tight">
        Local shopping, minus the driving around.
      </h2>
      <p className="mt-5 text-[16px] sm:text-[18px] text-brand-primary/60 leading-[1.7] max-w-xl mx-auto">
        Lokl is a shopping app built only for Bhilai. It connects you to clothing and footwear stores that are already in your neighbourhood — so you can browse what they actually have in stock, order from your phone, and get it at your door in about 45 minutes.
      </p>
    </section>
  );
}
