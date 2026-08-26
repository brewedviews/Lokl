/**
 * ComingSoonWhyLokl — customer positioning + differentiation. The five
 * product facts are represented with the same doodle-icon family used in
 * the hero benefit strip (ComingSoonIcons) — but laid out as a loose,
 * asymmetric editorial row rather than five identical cards: no
 * borders/backgrounds per item, varied icon+label alignment, so it reads
 * as a visual brand story rather than a checklist repeated from the hero.
 */
import { IconStorefront, IconTimer, IconTryBuy, IconWallet, IconReturn } from "./ComingSoonIcons";

const POINTS = [
  { Icon: IconStorefront, title: "Local stores", body: "Stores you already know" },
  { Icon: IconTimer, title: "Fast delivery", body: "Around 45 minutes" },
  { Icon: IconTryBuy, title: "Try & Buy", body: "Try before you decide" },
  { Icon: IconWallet, title: "Pay at delivery", body: "Cash or UPI" },
  { Icon: IconReturn, title: "24-hour returns", body: "On eligible items" },
];

export function ComingSoonWhyLokl() {
  return (
    <section id="why-lokl" className="max-w-4xl mx-auto px-5 sm:px-8 py-14 sm:py-20" data-testid="coming-soon-why-lokl">
      <div className="text-center mb-12 sm:mb-14">
        <h2 className="font-display font-bold text-[26px] sm:text-[38px] text-brand-primary leading-[1.2] tracking-tight">
          The stores you already know.
          <span className="block text-brand-accent">Now on your phone.</span>
        </h2>
        <p className="mt-4 text-[15px] sm:text-base text-brand-primary/55 leading-relaxed max-w-lg mx-auto">
          Lokl brings the clothing and footwear stores already in your neighbourhood online — instead of making you travel across Bhilai looking for what they have.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-9">
        {POINTS.map(({ Icon, title, body }, i) => (
          <div
            key={title}
            className={`flex flex-col items-center text-center gap-2.5 ${i === POINTS.length - 1 ? "col-span-2 sm:col-span-1" : ""} ${i % 2 === 1 ? "sm:mt-6" : ""}`}
          >
            <Icon />
            <div>
              <div className="font-bold text-brand-primary text-[13.5px] leading-tight">{title}</div>
              <div className="text-[11px] text-brand-primary/45 mt-0.5">{body}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
