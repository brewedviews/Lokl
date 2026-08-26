/**
 * ComingSoonHowItWorks — Discover -> Browse -> Order -> Receive as a
 * connected journey (a line running through icon-nodes), not 4 boxed
 * numbered cards. Horizontal on desktop/tablet, a vertical sequence with
 * a connecting line on mobile.
 */
import { MapPin, Search, ShoppingBag, Home } from "lucide-react";

const STEPS = [
  { icon: MapPin, title: "Discover", body: "Find stores around your neighbourhood." },
  { icon: Search, title: "Browse", body: "See what they actually have in stock." },
  { icon: ShoppingBag, title: "Order", body: "Choose your product and order from your phone." },
  { icon: Home, title: "Receive", body: "A local rider brings it to your door." },
];

export function ComingSoonHowItWorks() {
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-8 py-14 sm:py-20" data-testid="coming-soon-how-it-works">
      <div className="text-center mb-12 sm:mb-16">
        <p className="text-[12px] font-bold text-brand-accent uppercase tracking-[0.15em] mb-2.5">How Lokl works</p>
        <h2 className="font-display font-bold text-[24px] sm:text-[34px] text-brand-primary leading-tight tracking-tight">
          From your neighbourhood to your door.
        </h2>
      </div>

      {/* mobile: vertical sequence with a connecting line */}
      <div className="flex flex-col sm:hidden">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <div key={title} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className="w-11 h-11 rounded-full bg-brand-primary flex items-center justify-center shrink-0">
                <Icon size={18} className="text-white" />
              </div>
              {i < STEPS.length - 1 && <div className="w-px flex-1 bg-card-border my-1" />}
            </div>
            <div className={i < STEPS.length - 1 ? "pb-8" : ""}>
              <div className="font-bold text-brand-primary text-[15px] mb-1 pt-2">{title}</div>
              <p className="text-[13px] text-brand-primary/55 leading-relaxed">{body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* desktop/tablet: horizontal journey with a connecting line */}
      <div className="hidden sm:grid grid-cols-4 gap-4 relative">
        <div className="absolute left-0 right-0 top-[22px] h-px bg-card-border" style={{ marginInline: "12.5%" }} />
        {STEPS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex flex-col items-center text-center relative">
            <div className="w-11 h-11 rounded-full bg-brand-primary flex items-center justify-center mb-4 relative z-10 ring-8 ring-brand-bg">
              <Icon size={18} className="text-white" />
            </div>
            <div className="font-bold text-brand-primary text-[15px] mb-1.5">{title}</div>
            <p className="text-[13px] text-brand-primary/55 leading-relaxed max-w-[180px]">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
