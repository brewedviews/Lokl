import { Children, type ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  link?: string;
  linkLabel?: string;
  testid?: string;
  children: ReactNode;
}

export function HCarousel({ title, subtitle, link, linkLabel = "See all", testid, children }: Props) {
  if (Children.count(children) === 0) return null;
  return (
    <section className="pt-8" data-testid={testid}>
      <div className="px-4 sm:px-6 lg:px-8 flex items-end justify-between gap-3 mb-3 max-w-7xl mx-auto">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight line-clamp-1">{title}</h2>
          {subtitle && <p className="text-xs sm:text-sm text-[#64748B] mt-0.5 line-clamp-1">{subtitle}</p>}
        </div>
        {/* link is a plain nav link, not a CTA/selected-state/savings figure
            — per redesign-plan 2.2/2.3, orange isn't the default answer
            here; navy carries it fine (was the deprecated brand-accent-alt). */}
        {link && (
          <a href={link} className="text-xs font-bold text-[#0A1F5C] shrink-0 underline-offset-4 hover:underline">{linkLabel} →</a>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-pl-4 sm:scroll-pl-6 lg:scroll-pl-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {Children.map(children, (c, i) => (
          <div key={i} className="snap-start shrink-0 w-[38vw] sm:w-[180px] md:w-[200px]">{c}</div>
        ))}
      </div>
    </section>
  );
}
