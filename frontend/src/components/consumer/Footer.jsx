import React from "react";
import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer data-testid="footer" className="mt-20 bg-[#1A2B4C] text-white">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-6 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2">
          <span className="display font-bold text-lg">lokl<span className="text-[#E68910]">.</span></span>
          <span className="text-white/50">· Hyperlocal fashion for Bharat</span>
        </div>
        <div className="flex items-center gap-5 text-white/70">
          <Link to="/account" className="hover:text-[#E68910]">My account</Link>
          <Link to="/stores" className="hover:text-[#E68910]">Stores</Link>
          <Link to="/merchant/register" className="hover:text-[#E68910]">Sell on Lokl</Link>
          <span className="text-white/40">© 2026</span>
        </div>
      </div>
    </footer>
  );
}
