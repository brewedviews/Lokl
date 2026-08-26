/**
 * ComingSoonWhyLokl — LOCAL / CONVENIENT / PERSONAL, per the brief's
 * literal copy. Kept the reference's asymmetric navy/orange/white card
 * coloring, swapped emoji for lucide-react line icons (reads more premium,
 * matches the reference's own soft-badge `.why-icon` treatment).
 */
import { MapPin, Layers, Users } from "lucide-react";

const CARDS = [
  { icon: MapPin, tone: "navy" as const, title: "LOCAL", body: "Real neighbourhood stores, not distant warehouses." },
  { icon: Layers, tone: "orange" as const, title: "CONVENIENT", body: "Discover products from local stores without travelling store-to-store." },
  { icon: Users, tone: "white" as const, title: "PERSONAL", body: "A shopping experience built around the stores and merchants around you." },
];

export function ComingSoonWhyLokl() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-8 py-14 sm:py-20" data-testid="coming-soon-why-lokl">
      <p className="text-[12px] font-bold text-brand-accent uppercase tracking-[0.15em] mb-2.5">Why Lokl</p>
      <h2 className="font-display font-black text-[24px] sm:text-[38px] text-brand-primary leading-tight tracking-tight mb-2.5">
        Built for Bhilai, not shipped from a warehouse.
      </h2>
      <p className="text-[15px] text-[#595959] leading-relaxed max-w-md mb-12">
        Other apps ship from warehouses hours away. Lokl brings it from the store down the road.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {CARDS.map(({ icon: Icon, tone, title, body }) => (
          <div
            key={title}
            className={`rounded-[18px] p-6 ${
              tone === "navy" ? "bg-brand-primary text-white"
              : tone === "orange" ? "bg-brand-accent text-white"
              : "bg-white border border-card-border text-brand-primary"
            }`}
          >
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${tone === "white" ? "bg-brand-accent/15" : "bg-white/15"}`}>
              <Icon size={20} className={tone === "white" ? "text-brand-accent" : "text-white"} />
            </div>
            <div className={`font-display font-bold text-sm tracking-wide mb-1.5 ${tone === "white" ? "text-brand-primary" : "text-white"}`}>{title}</div>
            <p className={`text-[13px] leading-relaxed ${tone === "white" ? "text-[#595959]" : "text-white/65"}`}>{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
