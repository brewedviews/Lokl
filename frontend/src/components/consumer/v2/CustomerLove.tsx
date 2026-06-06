import Image from "next/image";
import { Star } from "lucide-react";

interface Testimonial {
  id: string;
  name: string;
  city: string;
  rating?: number;
  quote?: string;
  message?: string;
  avatar?: string;
}

export function CustomerLove({ items }: { items: Testimonial[] }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="mt-8 pt-8 pb-10 bg-gradient-to-b from-[#152D6E] to-[#0A1F5C] text-white" data-testid="customer-love">
      <div className="px-4 sm:px-8 mb-4 max-w-7xl mx-auto">
        <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight">Loved by Bhilai shoppers</h2>
        <p className="text-xs sm:text-sm opacity-80 mt-0.5">Real reviews from real customers.</p>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-pl-4 sm:scroll-pl-8 px-4 sm:px-8 max-w-7xl mx-auto">
        {items.map((t) => (
          <article key={t.id} className="snap-start shrink-0 w-[74vw] sm:w-[290px] bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/10">
            <div className="flex items-center gap-1 text-[#F59E0B] mb-2">
              {Array.from({ length: t.rating || 5 }).map((_, i) => (
                <Star key={i} size={12} fill="currentColor" />
              ))}
            </div>
            <p className="text-sm leading-snug">&ldquo;{t.quote || t.message}&rdquo;</p>
            <div className="flex items-center gap-2 mt-3">
              {t.avatar ? (
                <Image src={t.avatar} alt={t.name} width={28} height={28} loading="lazy" className="w-7 h-7 rounded-full object-cover" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-white/20" />
              )}
              <div>
                <div className="text-[12px] font-bold">{t.name}</div>
                <div className="text-[10px] opacity-70">{t.city}</div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
