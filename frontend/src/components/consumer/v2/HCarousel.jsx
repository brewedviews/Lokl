import React, { useRef } from "react";

/** Horizontal scroll-snap carousel with section title + optional "See all" link. */
export default function HCarousel({ title, subtitle, link, linkLabel = "See all", testid, children }) {
  const ref = useRef(null);
  if (React.Children.count(children) === 0) return null;
  return (
    <section className="pt-8" data-testid={testid}>
      <div className="px-4 sm:px-8 flex items-end justify-between gap-3 mb-3 max-w-7xl mx-auto">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight line-clamp-1">{title}</h2>
          {subtitle && <p className="text-xs sm:text-sm text-[#64748B] mt-0.5 line-clamp-1">{subtitle}</p>}
        </div>
        {link && (
          <a href={link} className="text-xs font-bold text-[#F59E0B] shrink-0 underline-offset-4 hover:underline">{linkLabel} →</a>
        )}
      </div>
      <div ref={ref} className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-pl-4 sm:scroll-pl-8 px-4 sm:px-8 max-w-7xl mx-auto">
        {React.Children.map(children, (c, i) => (
          <div key={i} className="snap-start shrink-0 w-[42vw] sm:w-[200px] md:w-[220px]">{c}</div>
        ))}
      </div>
    </section>
  );
}
