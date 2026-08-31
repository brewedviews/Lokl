"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import Link from "next/link";
import { ShoppingBag, TrendingUp, TrendingDown, AlertCircle, Package, Zap, Crown, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import type { OnboardingStatusResponse } from "@/lib/api/merchant";

interface Analytics {
  today_orders: number;
  today_revenue: number;
  week_orders: number;
  last_week_orders: number;
  wow_change: number;
  pending_orders: number;
  top_products: { _id: string; name: string; orders: number; revenue: number }[];
  low_stock: { id: string; name: string; total_stock: number }[];
}

interface Subscription {
  plan: string;
  status: string;
  days_left: number | null;
  is_expired: boolean;
  limits: { products: number; boosts: number; images: number; priority: number };
}

export default function MerchantDashboard() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState<OnboardingStatusResponse | null>(null);

  useEffect(() => {
    Promise.all([
      apiClient.get<Analytics>("/api/merchant/analytics/summary").then((r) => setAnalytics(r.data)).catch(() => {}),
      apiClient.get<Subscription>("/api/merchant/subscription").then((r) => setSubscription(r.data)).catch(() => {}),
    ]).finally(() => setLoading(false));
    // Persistent onboarding guidance — a merchant who isn't fully launched
    // yet should never lose sight of the next step just by navigating to
    // the analytics dashboard. Removed automatically once step === "live".
    api.merchant.onboardingStatus().then(setOnboarding).catch(() => {});
  }, []);

  const planColor =
    ({
      free: "#9CA3AF",
      starter: "#1A2B4C",
      growth: "#E68910",
      pro: "#7C3AED",
    } as Record<string, string>)[subscription?.plan ?? "free"] ?? "#9CA3AF";

  return (
    <div className="min-h-screen bg-[#FDFBF7] p-4 md:p-8 pb-24 md:pb-8 max-w-4xl mx-auto">

      {/* Subscription banner — expiring ≤7 days or already expired */}
      {subscription && (subscription.is_expired || (subscription.days_left !== null && subscription.days_left <= 7)) && (
        <Link
          href="/merchant/subscription"
          className={`block mb-4 p-3 rounded-2xl text-sm font-semibold text-center ${
            subscription.is_expired ? "bg-red-500 text-white" : "bg-[#E68910] text-white"
          }`}
        >
          {subscription.is_expired
            ? "Your subscription has expired — orders are paused. Renew now"
            : `${subscription.days_left} days left on your plan — Renew to keep getting orders`}
        </Link>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold text-[#1A2B4C]">Dashboard</h1>
          <p className="text-sm text-[#9CA3AF] mt-0.5">
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        {subscription && (
          <Link
            href="/merchant/subscription"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border-2"
            style={{ borderColor: planColor, color: planColor }}
          >
            <Crown size={12} />
            {subscription.plan.toUpperCase()}
          </Link>
        )}
      </div>

      {/* Persistent onboarding guidance — never leave an incomplete merchant
          staring at all-zero KPI tiles with no explanation of why, and no
          path forward. Disappears automatically once step === "live". */}
      {onboarding && onboarding.step !== "live" && (
        <Link
          href={onboarding.next_action.path}
          data-testid="dashboard-onboarding-banner"
          className="mb-6 p-4 rounded-2xl bg-[#1A2B4C] text-white flex items-center justify-between gap-3"
        >
          <div>
            <div className="font-bold text-sm">Your shop isn&apos;t live yet</div>
            <div className="text-xs text-white/70 mt-0.5">Complete the next step to start selling on Lokl.</div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#E68910] text-xs font-bold shrink-0">
            {onboarding.next_action.label} <ArrowRight size={12} />
          </span>
        </Link>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-[#E5E2DC] rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Link
              href="/merchant/orders?filter=pending"
              className={`bg-white rounded-2xl p-4 border-2 ${
                analytics?.pending_orders ? "border-[#E68910]" : "border-[#E5E2DC]"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide">Pending</span>
                {analytics?.pending_orders ? (
                  <span className="w-2 h-2 rounded-full bg-[#E68910] animate-pulse" />
                ) : null}
              </div>
              <div className="text-3xl font-bold text-[#1A2B4C]">{analytics?.pending_orders ?? 0}</div>
              <div className="text-xs text-[#595959] mt-1">orders waiting</div>
            </Link>

            <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]">
              <div className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide mb-2">Today</div>
              <div className="text-3xl font-bold text-[#1A2B4C]">{analytics?.today_orders ?? 0}</div>
              <div className="text-xs text-[#595959] mt-1">
                orders · ₹{(analytics?.today_revenue ?? 0).toLocaleString("en-IN")}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide">This week</span>
                {analytics && analytics.wow_change !== 0 &&
                  (analytics.wow_change > 0 ? (
                    <TrendingUp size={14} className="text-green-500" />
                  ) : (
                    <TrendingDown size={14} className="text-red-400" />
                  ))}
              </div>
              <div className="text-3xl font-bold text-[#1A2B4C]">{analytics?.week_orders ?? 0}</div>
              <div
                className={`text-xs mt-1 font-semibold ${
                  analytics && analytics.wow_change >= 0 ? "text-green-600" : "text-red-500"
                }`}
              >
                {analytics && analytics.wow_change !== 0
                  ? `${analytics.wow_change > 0 ? "+" : ""}${analytics.wow_change}% vs last week`
                  : "vs last week"}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-[#E5E2DC]">
              <div className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide mb-2">Last week</div>
              <div className="text-3xl font-bold text-[#1A2B4C]">{analytics?.last_week_orders ?? 0}</div>
              <div className="text-xs text-[#595959] mt-1">orders completed</div>
            </div>
          </div>

          {/* Low stock alert */}
          {analytics?.low_stock && analytics.low_stock.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={16} className="text-[#E68910]" />
                <span className="font-bold text-[#1A2B4C] text-sm">Low stock alert</span>
              </div>
              {analytics.low_stock.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-1">
                  <span className="text-sm text-[#1A2B4C] truncate">{p.name}</span>
                  <span className="text-xs font-bold text-[#E68910] ml-2">{p.total_stock} left</span>
                </div>
              ))}
              <Link href="/merchant/products" className="text-xs text-[#E68910] font-semibold mt-2 block">
                Update stock →
              </Link>
            </div>
          )}

          {/* Top products this week */}
          {analytics?.top_products && analytics.top_products.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#E5E2DC] p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-[#1A2B4C] text-sm">Top products this week</h3>
                <Link href="/merchant/products" className="text-xs text-[#E68910] font-semibold">
                  See all →
                </Link>
              </div>
              {analytics.top_products.map((p, i) => (
                <div
                  key={p._id}
                  className="flex items-center gap-3 py-2 border-b border-[#F5F5F5] last:border-0"
                >
                  <span className="text-[#9CA3AF] text-xs font-bold w-4">#{i + 1}</span>
                  <span className="flex-1 text-sm text-[#1A2B4C] truncate">{p.name}</span>
                  <span className="text-xs font-semibold text-[#E68910]">{p.orders} orders</span>
                </div>
              ))}
            </div>
          )}

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Link
              href="/merchant/products"
              className="bg-[#1A2B4C] text-white rounded-2xl p-4 flex items-center gap-3"
            >
              <Package size={20} />
              <div>
                <div className="font-bold text-sm">Add product</div>
                <div className="text-xs text-white/60">Grow your catalogue</div>
              </div>
            </Link>
            <Link
              href="/merchant/orders"
              className="bg-[#E68910] text-white rounded-2xl p-4 flex items-center gap-3"
            >
              <ShoppingBag size={20} />
              <div>
                <div className="font-bold text-sm">View orders</div>
                <div className="text-xs text-white/60">Manage deliveries</div>
              </div>
            </Link>
          </div>

          {/* Subscription upsell — only for free or starter plans */}
          {subscription && ["free", "starter"].includes(subscription.plan) && (
            <Link
              href="/merchant/subscription"
              className="block bg-gradient-to-r from-[#1A2B4C] to-[#2A3B5C] text-white rounded-2xl p-4"
            >
              <div className="flex items-center gap-2 mb-1">
                <Zap size={16} className="text-[#E68910]" />
                <span className="font-bold text-sm">Get more orders with Growth plan</span>
              </div>
              <p className="text-xs text-white/70 mb-2">
                Growth stores appear above yours in search. Upgrade to get priority placement, offers, and weekly
                sales reports.
              </p>
              <span className="text-xs font-bold text-[#E68910]">See Growth plan at ₹999/month →</span>
            </Link>
          )}
        </>
      )}
    </div>
  );
}
