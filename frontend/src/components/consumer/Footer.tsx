/**
 * Slim consumer footer — single strip on desktop, wraps on mobile.
 * Ported visual parity from the legacy CRA Footer.jsx.
 */
import Link from "next/link";
import { Mail, MapPin, Phone, Lock } from "lucide-react";

export function Footer({ topGap = true }: { topGap?: boolean }) {
  const year = new Date().getFullYear();
  return (
    <footer
      data-testid="footer"
      className={`bg-[#0A1F5C] text-white pb-20 md:pb-0 ${topGap ? "mt-12 md:mt-16" : ""}`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-lg font-display font-bold leading-none">
            lokl<span className="text-[#F59E0B]">.</span>
          </span>
          <span className="hidden sm:inline text-[11px] opacity-70 truncate">
            Fashion from your city&apos;s best stores.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] opacity-85" data-testid="footer-contact">
          <span className="inline-flex items-center gap-1.5"><MapPin size={12} className="text-[#F59E0B]" /> Bhilai</span>
          <a href="mailto:hello@shoplokl.in" className="inline-flex items-center gap-1.5 hover:text-[#F59E0B] transition" data-testid="footer-email"><Mail size={12} className="text-[#F59E0B]" /> hello@shoplokl.in</a>
          <a href="tel:+917719052107" className="inline-flex items-center gap-1.5 hover:text-[#F59E0B] transition" data-testid="footer-phone"><Phone size={12} className="text-[#F59E0B]" /> +91 7719052107</a>
        </div>
        <div className="flex items-center gap-3 text-[11px] opacity-70" data-testid="footer-legal">
          <Link href="/privacy" className="inline-flex items-center gap-1 hover:opacity-100 transition" data-testid="footer-privacy"><Lock size={10} /> Privacy Policy</Link>
          <Link href="/terms" className="inline-flex items-center gap-1 hover:opacity-100 transition" data-testid="footer-terms"><Lock size={10} /> Terms &amp; Conditions</Link>
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
