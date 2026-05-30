import React from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Package, LogOut, Store, BarChart3, FileText, Rocket, Bell, Landmark } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import useHeartbeat from "../../hooks/useHeartbeat";
import OnlineToggle from "./OnlineToggle";

export default function MerchantLayout({ children }) {
  const { merchant, logout } = useAuth();
  const nav = useNavigate();
  const isApproved = merchant?.kyc_status === "approved";
  useHeartbeat("merchant", { mid: merchant?.id });

  const links = isApproved ? [
    { to: "/merchant/orders", label: "Order requests", icon: Bell },
    { to: "/merchant/products", label: "Products", icon: Package },
    { to: "/merchant/analytics", label: "Sales analytics", icon: BarChart3 },
    { to: "/merchant/storefront", label: "Storefront", icon: Store },
    { to: "/merchant/bank", label: "Bank details", icon: Landmark },
  ] : [
    { to: "/merchant/onboarding", label: "Onboarding", icon: Rocket },
    { to: "/merchant/kyc", label: "KYC details", icon: FileText },
  ];

  return (
    <div className="min-h-screen bg-white flex">
      <aside data-testid="merchant-sidebar" className="hidden md:flex w-64 border-r border-[#E5E2DC] flex-col bg-[#FDFBF7]">
        <Link to="/merchant/orders" data-testid="merchant-logo" className="p-6 flex items-center gap-2 border-b border-[#E5E2DC]">
          <span className="display text-2xl font-bold text-[#1A2B4C]">lokl<span className="text-[#E68910]">.</span></span>
        </Link>
        <nav className="flex-1 p-3 space-y-1">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} data-testid={`nav-${l.label.toLowerCase().replace(/\s/g, "-")}`}
              className={({ isActive }) => `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition ${
                isActive ? "bg-[#1A2B4C] text-white" : "text-[#1C1C1C] hover:bg-white"} ${l.highlight && !isActive ? "border border-[#E68910]/30" : ""}`}>
              <l.icon size={16} className={l.highlight ? "text-[#E68910]" : ""} />
              <span className="flex-1">{l.label}</span>
            </NavLink>
          ))}
          {isApproved && <div className="px-1"><OnlineToggle /></div>}
        </nav>
        <div className="p-3 border-t border-[#E5E2DC]">
          <div className="px-3 py-2">
            <div className="text-[10px] text-[#595959] uppercase">Signed in</div>
            <div className="font-semibold text-sm text-[#1A2B4C] truncate">{merchant?.store_name}</div>
            <div className="text-[10px] text-[#595959] truncate">{merchant?.email}</div>
            <div className={`mt-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
              isApproved ? "bg-[#4F7363]/15 text-[#4F7363]" :
              merchant?.kyc_status === "submitted" ? "bg-[#E68910]/15 text-[#E68910]" :
              merchant?.kyc_status === "rejected" ? "bg-red-100 text-red-500" : "bg-[#E5E2DC] text-[#595959]"}`}>
              KYC · {merchant?.kyc_status || "draft"}
            </div>
          </div>
          <button onClick={async () => { await logout(); nav("/merchant/login"); }} data-testid="logout-btn" className="w-full flex items-center gap-2 px-4 py-2 rounded-xl text-sm hover:bg-white mt-2">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
