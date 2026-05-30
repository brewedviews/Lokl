import React from "react";
import { Link } from "react-router-dom";
import { Truck, Shield, RotateCcw, BadgeCheck, Mail, MapPin, Phone, Instagram, Twitter, Facebook } from "lucide-react";

export default function Footer() {
  return (
    <footer data-testid="footer" className="bg-[#0A1F5C] text-white">
      {/* Trust bar */}
      <div className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: Truck, title: "30–45 min delivery", body: "Across Bhilai" },
            { icon: RotateCcw, title: "24h easy returns", body: "Free reverse pickup" },
            { icon: Shield, title: "Secure payments", body: "COD + UPI + cards" },
            { icon: BadgeCheck, title: "Verified stores", body: "Hand-picked merchants" },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <div key={t.title} className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 grid place-items-center shrink-0">
                  <Icon size={18} className="text-[#F59E0B]" />
                </div>
                <div>
                  <div className="text-sm font-bold leading-tight">{t.title}</div>
                  <div className="text-[11px] opacity-70 mt-0.5">{t.body}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-10 grid grid-cols-2 md:grid-cols-5 gap-8">
        {/* Brand */}
        <div className="col-span-2 md:col-span-2">
          <div className="text-2xl font-display font-bold">lokl<span className="text-[#F59E0B]">.</span></div>
          <p className="text-sm opacity-80 mt-3 max-w-sm leading-relaxed">
            Fashion from your city's best boutiques, delivered in 30–45 minutes with doorstep trial and easy returns.
          </p>
          <div className="flex items-center gap-3 mt-4">
            <a href="#" aria-label="Instagram" className="w-9 h-9 rounded-full bg-white/10 hover:bg-[#F59E0B] grid place-items-center transition"><Instagram size={15} /></a>
            <a href="#" aria-label="Twitter" className="w-9 h-9 rounded-full bg-white/10 hover:bg-[#F59E0B] grid place-items-center transition"><Twitter size={15} /></a>
            <a href="#" aria-label="Facebook" className="w-9 h-9 rounded-full bg-white/10 hover:bg-[#F59E0B] grid place-items-center transition"><Facebook size={15} /></a>
          </div>
        </div>

        {/* Shop */}
        <div>
          <div className="text-[10px] uppercase tracking-widest font-bold text-[#F59E0B] mb-3">Shop</div>
          <ul className="space-y-2 text-sm opacity-90">
            <li><Link to="/c/women" className="hover:text-[#F59E0B]">Women</Link></li>
            <li><Link to="/c/men" className="hover:text-[#F59E0B]">Men</Link></li>
            <li><Link to="/c/footwear" className="hover:text-[#F59E0B]">Footwear</Link></li>
            <li><Link to="/stores" className="hover:text-[#F59E0B]">All stores</Link></li>
            <li><Link to="/products" className="hover:text-[#F59E0B]">All products</Link></li>
          </ul>
        </div>

        {/* Company */}
        <div>
          <div className="text-[10px] uppercase tracking-widest font-bold text-[#F59E0B] mb-3">Company</div>
          <ul className="space-y-2 text-sm opacity-90">
            <li><Link to="/about" className="hover:text-[#F59E0B]">About Lokl</Link></li>
            <li><Link to="/merchant/register" className="hover:text-[#F59E0B]">Sell on Lokl</Link></li>
            <li><Link to="/careers" className="hover:text-[#F59E0B]">Careers</Link></li>
            <li><Link to="/press" className="hover:text-[#F59E0B]">Press</Link></li>
          </ul>
        </div>

        {/* Help */}
        <div>
          <div className="text-[10px] uppercase tracking-widest font-bold text-[#F59E0B] mb-3">Help</div>
          <ul className="space-y-2 text-sm opacity-90">
            <li><Link to="/account" className="hover:text-[#F59E0B]">My account</Link></li>
            <li><Link to="/help/returns" className="hover:text-[#F59E0B]">Returns</Link></li>
            <li><Link to="/help/shipping" className="hover:text-[#F59E0B]">Shipping</Link></li>
            <li><Link to="/help/contact" className="hover:text-[#F59E0B]">Contact us</Link></li>
            <li><Link to="/help/privacy" className="hover:text-[#F59E0B]">Privacy</Link></li>
            <li><Link to="/help/terms" className="hover:text-[#F59E0B]">Terms</Link></li>
          </ul>
        </div>
      </div>

      {/* Contact strip */}
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
