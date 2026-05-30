import React from "react";
import { Mail, MapPin, Phone, Instagram, Twitter, Facebook } from "lucide-react";

export default function Footer() {
  return (
    <footer data-testid="footer" className="bg-[#0A1F5C] text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-10 flex flex-col items-start gap-5 sm:gap-6">
        <div>
          <div className="text-2xl font-display font-bold">lokl<span className="text-[#F59E0B]">.</span></div>
          <p className="text-sm opacity-80 mt-2 max-w-md leading-relaxed">
            Fashion from your city's best stores, delivered fast.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a href="#" aria-label="Instagram" className="w-9 h-9 rounded-full bg-white/10 hover:bg-[#F59E0B] grid place-items-center transition"><Instagram size={15} /></a>
          <a href="#" aria-label="Twitter" className="w-9 h-9 rounded-full bg-white/10 hover:bg-[#F59E0B] grid place-items-center transition"><Twitter size={15} /></a>
          <a href="#" aria-label="Facebook" className="w-9 h-9 rounded-full bg-white/10 hover:bg-[#F59E0B] grid place-items-center transition"><Facebook size={15} /></a>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs opacity-80">
          <span className="inline-flex items-center gap-1.5"><MapPin size={13} className="text-[#F59E0B]" /> Bhilai · Durg · Raipur</span>
          <span className="inline-flex items-center gap-1.5"><Mail size={13} className="text-[#F59E0B]" /> hello@lokl.in</span>
          <span className="inline-flex items-center gap-1.5"><Phone size={13} className="text-[#F59E0B]" /> +91 70000 70000</span>
        </div>
      </div>

      <div className="bg-black/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3 flex flex-wrap items-center justify-between gap-2 text-[11px] opacity-60">
          <span>© {new Date().getFullYear()} Lokl Commerce Pvt Ltd. All rights reserved.</span>
          <span>Built for the Tier-2 high street.</span>
        </div>
      </div>
    </footer>
  );
}
