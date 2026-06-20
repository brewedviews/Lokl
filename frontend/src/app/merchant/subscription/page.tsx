"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { Check, X, Zap, Crown } from "lucide-react";

interface Plan {
  id: string;
  name: string;
  price: number;
  badge: string | null;
  color: string;
  tagline: string;
  features: { text: string; included: boolean }[];
  cta: string;
  highlight: boolean;
}

const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    badge: null,
    color: "#9CA3AF",
    tagline: "Try Lokl for 30 days",
    features: [
      { text: "10 products", included: true },
      { text: "Standard search placement", included: true },
      { text: "WhatsApp order alerts", included: true },
      { text: "Priority placement in search", included: false },
      { text: "Featured on homepage", included: false },
      { text: "Offers & coupons", included: false },
      { text: "Sales analytics", included: false },
      { text: "Weekly sales report", included: false },
    ],
    cta: "Current free plan",
    highlight: false,
  },
  {
    id: "starter",
    name: "Starter",
    price: 499,
    badge: null,
    color: "#1A2B4C",
    tagline: "For stores just getting started",
    features: [
      { text: "30 products", included: true },
      { text: "Standard search placement", included: true },
      { text: "WhatsApp order alerts", included: true },
      { text: "Basic dashboard", included: true },
      { text: "Priority placement in search", included: false },
      { text: "Featured on homepage", included: false },
      { text: "Offers & coupons", included: false },
      { text: "Weekly sales report", included: false },
    ],
    cta: "Choose Starter",
    highlight: false,
  },
  {
    id: "growth",
    name: "Growth",
    price: 999,
    badge: "MOST POPULAR",
    color: "#E68910",
    tagline: "For stores serious about sales",
    features: [
      { text: "100 products", included: true },
      { text: "⚡ Priority placement — appear above Starter stores", included: true },
      { text: "✅ Featured in 'Stores near you' on homepage", included: true },
      { text: "Offers & coupons for your store", included: true },
      { text: "3 product boosts/month (pin to top of category)", included: true },
      { text: "Sales analytics — see what's selling", included: true },
      { text: "📊 Weekly WhatsApp sales report (every Monday)", included: true },
      { text: "Verified Store badge", included: true },
    ],
    cta: "Choose Growth — ₹999/month",
    highlight: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: 1999,
    badge: "MAX VISIBILITY",
    color: "#7C3AED",
    tagline: "For stores that want to dominate",
    features: [
      { text: "Unlimited products", included: true },
      { text: "🏆 Top #1 placement — always first in your category", included: true },
      { text: "🏠 Permanent homepage feature slot", included: true },
      { text: "10 product boosts/month", included: true },
      { text: "Custom offer banner on homepage", included: true },
      { text: "Daily WhatsApp sales summary (every evening)", included: true },
      { text: "Low stock WhatsApp alerts", included: true },
      { text: "Priority rider dispatch", included: true },
      { text: "Lokl Premium Partner badge", included: true },
    ],
    cta: "Choose Pro — ₹1,999/month",
    highlight: false,
  },
];

interface Subscription {
  plan: string;
  status: string;
  days_left: number | null;
  is_expired: boolean;
}

export default function SubscriptionPage() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [paymentRef, setPaymentRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiClient
      .get<Subscription>("/api/merchant/subscription")
      .then((r) => setSubscription(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleUpgrade = async (planId: string) => {
    if (!paymentRef.trim()) {
      setError("Please enter your UPI transaction ID or payment reference");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await apiClient.post("/api/merchant/subscription/activate", {
        plan: planId,
        payment_ref: paymentRef,
      });
      setSubmitted(true);
    } catch (e) {
      setError(getErrorMessage(e) || "Something went wrong. Please WhatsApp us at +91 7719052107");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col items-center justify-center px-6 text-center pb-24">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="font-bold text-[#1A2B4C] text-xl mb-2">Request submitted!</h2>
        <p className="text-[#595959] text-sm mb-6">
          We&apos;ll verify your payment and activate your plan within 2 hours.
          <br />
          You&apos;ll get a WhatsApp confirmation.
        </p>
        <a href="/merchant/dashboard" className="px-6 py-3 bg-[#1A2B4C] text-white rounded-full font-semibold text-sm">
          Back to dashboard
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7] pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <div className="flex items-center gap-2 mb-1">
          <Crown size={20} className="text-[#E68910]" />
          <h1 className="font-display text-2xl font-bold text-[#1A2B4C]">Choose your plan</h1>
        </div>
        <p className="text-sm text-[#595959] mb-6">
          More visibility = more orders. Growth merchants get priority placement and appear above Standard stores.
        </p>

        {/* Current plan status */}
        {!loading && subscription && (
          <div
            className={`mb-6 p-4 rounded-2xl border-2 ${
              subscription.is_expired ? "border-red-300 bg-red-50" : "border-[#E5E2DC] bg-white"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-[#9CA3AF] uppercase font-semibold">Current plan</span>
                <div className="font-bold text-[#1A2B4C] text-lg capitalize">{subscription.plan}</div>
              </div>
              <div className="text-right">
                {subscription.is_expired ? (
                  <span className="text-red-500 font-bold text-sm">Expired</span>
                ) : subscription.days_left !== null ? (
                  <span
                    className={`font-bold text-sm ${
                      subscription.days_left <= 7 ? "text-[#E68910]" : "text-green-600"
                    }`}
                  >
                    {subscription.days_left} days left
                  </span>
                ) : (
                  <span className="text-green-600 font-bold text-sm">Active</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Plan cards — skip free */}
        <div className="space-y-4 mb-8">
          {PLANS.filter((p) => p.id !== "free").map((plan) => (
            <div
              key={plan.id}
              className={`bg-white rounded-2xl border-2 overflow-hidden transition-all ${
                plan.highlight
                  ? "border-[#E68910] shadow-lg"
                  : selectedPlan === plan.id
                  ? "border-[#1A2B4C]"
                  : "border-[#E5E2DC]"
              }`}
            >
              {plan.badge && (
                <div
                  className="text-center py-1.5 text-xs font-bold text-white"
                  style={{ backgroundColor: plan.color }}
                >
                  {plan.badge}
                </div>
              )}
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-[#1A2B4C] text-lg">{plan.name}</h3>
                    <p className="text-xs text-[#9CA3AF]">{plan.tagline}</p>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-2xl text-[#1A2B4C]">
                      ₹{plan.price.toLocaleString("en-IN")}
                    </div>
                    <div className="text-xs text-[#9CA3AF]">/month</div>
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  {plan.features.map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      {f.included ? (
                        <Check size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
                      ) : (
                        <X size={14} className="text-red-300 flex-shrink-0 mt-0.5" />
                      )}
                      <span className={`text-xs ${f.included ? "text-[#1A2B4C]" : "text-[#9CA3AF]"}`}>
                        {f.text}
                      </span>
                    </div>
                  ))}
                </div>

                {subscription?.plan === plan.id ? (
                  <div className="text-center py-2 text-sm font-semibold text-[#9CA3AF]">
                    ✓ Your current plan
                  </div>
                ) : (
                  <button
                    onClick={() => setSelectedPlan(selectedPlan === plan.id ? null : plan.id)}
                    className="w-full py-3 rounded-xl font-bold text-sm transition-all"
                    style={{
                      backgroundColor:
                        selectedPlan === plan.id || plan.highlight ? plan.color : "transparent",
                      color: selectedPlan === plan.id || plan.highlight ? "white" : plan.color,
                      border: `2px solid ${plan.color}`,
                    }}
                  >
                    {selectedPlan === plan.id ? "✓ Selected" : plan.cta}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Payment instructions — shown when a plan is selected */}
        {selectedPlan && (
          <div className="bg-white rounded-2xl border border-[#E5E2DC] p-5 mb-6">
            <h3 className="font-bold text-[#1A2B4C] mb-3">How to pay</h3>
            <div className="space-y-3 text-sm text-[#595959]">
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#1A2B4C] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                  1
                </span>
                <div>
                  <p className="font-semibold text-[#1A2B4C]">Pay via UPI</p>
                  <p>
                    Send ₹{PLANS.find((p) => p.id === selectedPlan)?.price.toLocaleString("en-IN")} to:
                  </p>
                  <p className="font-mono font-bold text-[#1A2B4C] mt-1">lokl@upi</p>
                  <p className="text-xs text-[#9CA3AF]">or scan QR code below</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#1A2B4C] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                  2
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-[#1A2B4C]">Enter your UPI transaction ID</p>
                  <input
                    type="text"
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    placeholder="e.g. UPI/CR/123456789"
                    className="w-full mt-2 px-3 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] text-sm font-mono"
                  />
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#1A2B4C] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                  3
                </span>
                <div>
                  <p className="font-semibold text-[#1A2B4C]">Submit — we&apos;ll activate within 2 hours</p>
                  <p className="text-xs text-[#9CA3AF]">You&apos;ll receive a WhatsApp confirmation from us</p>
                </div>
              </div>
            </div>
            {error && <p className="text-red-500 text-xs mt-3">{error}</p>}
            <button
              onClick={() => void handleUpgrade(selectedPlan)}
              disabled={submitting || !paymentRef.trim()}
              className="w-full mt-4 py-3.5 bg-[#E68910] text-white rounded-xl font-bold text-sm disabled:opacity-50"
            >
              {submitting
                ? "Submitting..."
                : `Submit payment for ${PLANS.find((p) => p.id === selectedPlan)?.name} plan`}
            </button>
          </div>
        )}

        {/* Upsell note for free plan */}
        {subscription?.plan === "free" && (
          <div className="bg-[#1A2B4C]/5 rounded-2xl p-4 mb-6 flex items-start gap-3">
            <Zap size={16} className="text-[#E68910] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-[#595959]">
              You&apos;re on the free plan. Growth and Pro merchants appear above you in every search —
              upgrade to start winning more orders in Bhilai.
            </p>
          </div>
        )}

        <div className="text-center text-sm text-[#9CA3AF] pb-8">
          Questions? WhatsApp us at{" "}
          <a href="https://wa.me/917719052107" className="text-[#E68910] font-semibold">
            +91 7719052107
          </a>
        </div>
      </div>
    </div>
  );
}
