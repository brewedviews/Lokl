import React from "react";
import { Link } from "react-router-dom";
import { Sparkles, Instagram, Twitter, Linkedin } from "lucide-react";

export default function Footer() {
  return (
    <footer data-testid="footer" className="mt-24 bg-[#1A2B4C] text-white">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-16 grid grid-cols-2 md:grid-cols-4 gap-10">
        <div className="col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
              <Sparkles size={20} className="text-[#E68910]" />
            </div>
            <span className="display text-2xl font-bold">bharat<span className="text-[#E68910]">.</span></span>
          </div>
          <p className="text-white/70 text-sm max-w-sm leading-relaxed">
            The operating system for hyperlocal fashion commerce in Bharat. Discover trusted boutiques nearby, delivered in minutes.
          </p>
          <div className="flex gap-3 mt-6">
            <a href="#" className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#E68910] transition"><Instagram size={16} /></a>
            <a href="#" className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#E68910] transition"><Twitter size={16} /></a>
            <a href="#" className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#E68910] transition"><Linkedin size={16} /></a>
          </div>
        </div>
        <div>
          <h4 className="display font-semibold mb-4">Shop</h4>
          <ul className="space-y-2 text-sm text-white/70">
            <li><Link to="/shop?category=cat-women" className="hover:text-[#E68910]">Women</Link></li>
            <li><Link to="/shop?category=cat-men" className="hover:text-[#E68910]">Men</Link></li>
            <li><Link to="/shop?category=cat-ethnic" className="hover:text-[#E68910]">Ethnic Wear</Link></li>
            <li><Link to="/stores" className="hover:text-[#E68910]">Nearby Stores</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="display font-semibold mb-4">Merchants</h4>
          <ul className="space-y-2 text-sm text-white/70">
            <li><Link to="/merchant/register" className="hover:text-[#E68910]">Become a Seller</Link></li>
            <li><Link to="/merchant/login" className="hover:text-[#E68910]">Merchant Login</Link></li>
            <li><span>AI Catalog Engine</span></li>
            <li><span>Pricing</span></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-6 text-center text-xs text-white/50">
        © 2026 Bharat Fashion OS · Built for Tier-2 & Tier-3 India
      </div>
    </footer>
  );
}
