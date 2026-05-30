import React from "react";
import { Mail, MapPin, Phone, Instagram, Twitter, Facebook } from "lucide-react";

// Slim, single-row footer. ~3x shorter than the previous block.
// Brand · contact pills · social icons · copyright — all in one strip on desktop,
// gracefully wrapping on mobile (no announcement bar, no oversized headings).
//
// Spacing contract: every consumer page gets a consistent 32px gap between its
// last content and the footer. Pass `topGap={false}` when the previous section
// already blends into the footer (e.g. the gradient CustomerLove on Home).
export default function Footer({ topGap = true }) {
  const year = new Date().getFullYear();
  return (
    <footer
      data-testid="footer"
      className={`bg-[#0A1F5C] text-white pb-20 md:pb-0 ${topGap ? "mt-8" : ""}`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        {/* Brand */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-lg font-display font-bold leading-none">
            lokl<span className="text-[#F59E0B]">.</span>
          </span>
          <span className="hidden sm:inline text-[11px] opacity-70 truncate">
            Fashion from your city's best stores.
          </span>
        </div>

        {/* Contact pills */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] opacity-85" data-testid="footer-contact">
          <span className="inline-flex items-center gap-1.5"><MapPin size={12} className="text-[#F59E0B]" /> Bhilai · Durg · Raipur</span>
          <a href="mailto:hello@lokl.in" className="inline-flex items-center gap-1.5 hover:text-[#F59E0B] transition" data-testid="footer-email"><Mail size={12} className="text-[#F59E0B]" /> hello@lokl.in</a>
          <a href="tel:+917000070000" className="inline-flex items-center gap-1.5 hover:text-[#F59E0B] transition" data-testid="footer-phone"><Phone size={12} className="text-[#F59E0B]" /> +91 70000 70000</a>
        </div>

        {/* Social */}
        <div className="flex items-center gap-2" data-testid="footer-social">
          <a href="#" aria-label="Instagram" className="w-7 h-7 rounded-full bg-white/10 hover:bg-[#F59E0B] grid place-items-center transition"><Instagram size={13} /></a>
          <a href="#" aria-label="Twitter"   className="w-7 h-7 rounded-full bg-white/10 hover:bg-[#F59E0B] grid place-items-center transition"><Twitter size={13} /></a>
          <a href="#" aria-label="Facebook"  className="w-7 h-7 rounded-full bg-white/10 hover:bg-[#F59E0B] grid place-items-center transition"><Facebook size={13} /></a>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-2 flex flex-wrap items-center justify-between gap-2 text-[10px] opacity-60">
          <span>© {year} Lokl Commerce Pvt Ltd.</span>
          <span>Built for the Tier-2 high street.</span>
        </div>
      </div>
    </footer>
  );
}
