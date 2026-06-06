import React, { useEffect, useState } from "react";
import { TrendingUp, ShoppingBag, Users, Sparkles, Package } from "lucide-react";
import api from "../lib/api";
import MerchantLayout from "../components/merchant/MerchantLayout";
import { useAuth } from "../contexts/AuthContext";

export default function MerchantDashboard() {
  const { merchant } = useAuth();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get("/merchant/dashboard").then((r) => setStats(r.data));
  }, []);

  return (
    <MerchantLayout>
      <div className="p-8 md:p-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-[#595959]">Welcome back, {merchant?.owner_name?.split(" ")[0]}</p>
            <h1 data-testid="dashboard-title" className="display text-4xl md:text-5xl font-bold text-[#1A2B4C] mt-1">{merchant?.store_name}</h1>
          </div>
          <a href="/merchant/ai-studio" data-testid="quick-ai-studio" className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#E68910] text-white font-semibold hover:bg-[#C9770E]">
            <Sparkles size={16} /> Open AI Studio
          </a>
        </div>

        {stats && (
          <>
            <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Revenue (30d)", value: `₹${stats.revenue.toLocaleString()}`, icon: TrendingUp, color: "text-[#4F7363]" },
                { label: "Orders", value: stats.orders, icon: ShoppingBag, color: "text-[#E68910]" },
                { label: "Repeat customers", value: `${stats.repeat_rate}%`, icon: Users, color: "text-[#1A2B4C]" },
                { label: "Conversion", value: `${stats.conversion}%`, icon: Package, color: "text-[#E68910]" },
              ].map((k) => (
                <div key={k.label} className="bg-white border border-[#E5E2DC] rounded-2xl p-5">
                  <k.icon size={18} className={k.color} />
                  <div className="display text-3xl font-bold text-[#1A2B4C] mt-3">{k.value}</div>
                  <div className="text-xs text-[#595959] mt-1">{k.label}</div>
                </div>
              ))}
            </div>

            <div className="mt-8 grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white border border-[#E5E2DC] rounded-2xl p-6">
                <h3 className="display text-xl font-bold text-[#1A2B4C] mb-5">Revenue this week</h3>
                <div className="flex items-end gap-2 h-48">
                  {stats.trends.map((d) => {
                    const max = Math.max(...stats.trends.map((x) => x.revenue));
                    const h = (d.revenue / max) * 100;
                    return (
                      <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
                        <div className="w-full bg-[#1A2B4C] rounded-t-lg transition hover:bg-[#E68910]" style={{ height: `${h}%` }} />
                        <span className="text-[10px] text-[#595959]">{d.day}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="bg-white border border-[#E5E2DC] rounded-2xl p-6">
                <h3 className="display text-xl font-bold text-[#1A2B4C] mb-4">Top products</h3>
                <div className="space-y-4">
                  {stats.top_products.map((p, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#E68910]/10 text-[#E68910] flex items-center justify-center font-bold text-sm">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-[#1A2B4C] truncate">{p.name}</div>
                        <div className="text-xs text-[#595959]">{p.sold} sold</div>
                      </div>
                      <div className="text-sm font-semibold text-[#4F7363]">₹{p.revenue.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </MerchantLayout>
  );
}
