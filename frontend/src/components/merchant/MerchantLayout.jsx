import React from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Package, Sparkles, LogOut, Store, BarChart3 } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

const links = [
  { to: "/merchant/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/merchant/products", label: "Products", icon: Package },
  { to: "/merchant/ai-studio", label: "AI Catalog Studio", icon: Sparkles, highlight: true },
  { to: "/merchant/analytics", label: "Analytics", icon: BarChart3 },
];

export default function MerchantLayout({ children }) {
  const { merchant, logout } = useAuth();
  const nav = useNavigate();

  return (
    <div className="min-h-screen bg-white flex">
      <aside data-testid="merchant-sidebar" className="hidden md:flex w-64 border-r border-[#E5E2DC] flex-col bg-[#FDFBF7]">
        <Link to="/" className="p-6 flex items-center gap-2 border-b border-[#E5E2DC]">
          <div className="w-9 h-9 rounded-full bg-[#1A2B4C] flex items-center justify-center">
            <Sparkles size={16} className="text-[#E68910]" />
          </div>
          <span className="display text-xl font-bold text-[#1A2B4C]">bharat<span className="text-[#E68910]">.</span></span>
        </Link>
        <nav className="flex-1 p-3 space-y-1">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} data-testid={`nav-${l.label.toLowerCase().replace(/\s/g, "-")}`}
              className={({ isActive }) => `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${
                isActive ? "bg-[#1A2B4C] text-white" : "text-[#1C1C1C] hover:bg-white"} ${l.highlight && !isActive ? "border border-[#E68910]/30" : ""}`}>
              <l.icon size={16} className={l.highlight ? "text-[#E68910]" : ""} /> {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-[#E5E2DC]">
          <div className="px-3 py-3">
            <div className="text-xs text-[#595959]">Signed in as</div>
            <div className="font-semibold text-[#1A2B4C] truncate">{merchant?.store_name}</div>
            <div className="text-xs text-[#595959] truncate">{merchant?.email}</div>
          </div>
          <button onClick={() => { logout(); nav("/"); }} data-testid="logout-btn" className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm hover:bg-white">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
