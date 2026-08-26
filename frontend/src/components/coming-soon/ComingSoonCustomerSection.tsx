/**
 * ComingSoonCustomerSection — "FOR CUSTOMERS". Four capability cards, all
 * describing real, already-shipped product behavior — no invented
 * features. Try & Buy is described as the actual doorstep mechanic
 * (`try_at_doorstep` in backend/server.py: the rider brings it, the
 * customer decides at their own door), not the reference HTML's
 * inaccurate "reserve it and visit the store" framing.
 */
import { MapPin, LayoutGrid, PackageCheck, Wallet } from "lucide-react";

const CAPABILITIES = [
  { icon: MapPin, title: "Discover local stores", body: "See the real shops already around you in Bhilai, all in one place." },
  { icon: LayoutGrid, title: "Real stock, multiple categories", body: "Fashion, footwear and more — actual products from actual stores, not a catalogue photo." },
  { icon: PackageCheck, title: "Try & Buy", body: "Order it, try it at your door, and pay only if you keep it — where the store supports it." },
  { icon: Wallet, title: "Pay your way", body: "Cash on delivery or pay online. Returns follow each store's own return window." },
];

export function ComingSoonCustomerSection() {
  return (
    <section id="what-is-lokl" className="max-w-6xl mx-auto px-4 sm:px-8 py-14 sm:py-20" data-testid="coming-soon-customer">
      <p className="text-[12px] font-bold text-brand-accent uppercase tracking-[0.15em] mb-2.5">For customers</p>
      <h2 className="font-display font-black text-[24px] sm:text-[38px] text-brand-primary leading-tight tracking-tight mb-2.5">
        Fast. Local. Reliable.
      </h2>
      <p className="text-[15px] text-[#595959] leading-relaxed max-w-md mb-12">
        Lokl connects you to the clothing and footwear stores already in your neighbourhood — so you can browse what they actually have, order from your phone, and get it from a store nearby.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {CAPABILITIES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-white border border-card-border rounded-2xl p-6">
            <div className="w-10 h-10 rounded-[10px] bg-brand-accent/15 flex items-center justify-center mb-4">
              <Icon size={18} className="text-brand-accent" />
            </div>
            <div className="font-bold text-brand-primary text-base mb-1.5 tracking-tight">{title}</div>
            <p className="text-[13px] text-[#595959] leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
