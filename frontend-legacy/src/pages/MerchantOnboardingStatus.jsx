import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Clock, CheckCircle2, XCircle, Sparkles, Store, ArrowRight, Bell, PauseCircle } from "lucide-react";
import MerchantLayout from "../components/merchant/MerchantLayout";
import api from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

export default function MerchantOnboardingStatus() {
  const { merchant, refresh } = useAuth();
  const [data, setData] = useState(null);
  const [notifs, setNotifs] = useState([]);
  const nav = useNavigate();

  useEffect(() => {
    api.get("/merchant/kyc/status").then((r) => setData(r.data));
    api.get("/merchant/notifications").then((r) => setNotifs(r.data));
    // If merchant is already past onboarding (approved + has storefront), bounce them to the right tab.
    api.get("/merchant/next-route").then(({ data: nr }) => {
      const route = nr?.route;
      if (route && route !== "/merchant/onboarding") {
        nav(route, { replace: true });
      }
    }).catch(() => { /* stay on this page */ });
    const i = setInterval(() => {
      api.get("/merchant/kyc/status").then((r) => setData(r.data));
      api.get("/merchant/notifications").then((r) => setNotifs(r.data));
    }, 8000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = data?.kyc_status || merchant?.kyc_status || "draft";
  const holdComment = data?.merchant?.hold_comment;

  const resubmit = async () => {
    try {
      await api.post("/merchant/kyc/resubmit");
      const r = await api.get("/merchant/kyc/status");
      setData(r.data);
      refresh && refresh();
    } catch (e) {
      // ignore — UI will re-poll
    }
  };

  const steps = [
    { key: "draft", label: "Submit KYC", done: status !== "draft", path: "/merchant/kyc" },
    { key: "submitted", label: "KYC approved by team", done: status === "approved" },
    { key: "approved", label: "Set up storefront", done: !!merchant?.storefront, path: "/merchant/storefront", lockUntil: "approved" },
    { key: "products", label: "Add 1+ products", done: false, path: "/merchant/products", lockUntil: "approved" },
    { key: "publish", label: "Go live", done: false, path: "/merchant/publish-ready", lockUntil: "approved" },
  ];

  return (
    <MerchantLayout>
      <div className="p-6 md:p-10 max-w-4xl">
        <h1 className="display text-3xl md:text-4xl font-bold text-[#1A2B4C]">Welcome to Lokl</h1>
        <p className="text-[#595959] mt-1">A few quick steps and your store goes live.</p>

        <div data-testid="kyc-status-card" className={`mt-6 rounded-3xl p-6 border-2 ${
          status === "approved" ? "bg-[#4F7363]/5 border-[#4F7363]/30" :
          status === "rejected" ? "bg-red-50 border-red-200" :
          status === "on_hold" ? "bg-[#E68910]/10 border-[#E68910]/40" :
          status === "submitted" ? "bg-[#E68910]/5 border-[#E68910]/30" :
          "bg-white border-[#E5E2DC]"}`}>
          <div className="flex items-center gap-3">
            {status === "approved" ? <CheckCircle2 size={28} className="text-[#4F7363]" /> :
             status === "rejected" ? <XCircle size={28} className="text-red-500" /> :
             status === "on_hold" ? <PauseCircle size={28} className="text-[#E68910]" /> :
             status === "submitted" ? <Clock size={28} className="text-[#E68910]" /> :
             <Sparkles size={28} className="text-[#E68910]" />}
            <div>
              <div className="display text-xl font-bold text-[#1A2B4C]">
                {status === "approved" ? "KYC approved — you're in!" :
                 status === "rejected" ? "KYC needs attention" :
                 status === "on_hold" ? "KYC on hold — action needed" :
                 status === "submitted" ? "KYC under review" :
                 "Let's get started"}
              </div>
              <div className="text-sm text-[#595959] mt-0.5">
                {status === "approved" ? "Set up your storefront and start adding products." :
                 status === "rejected" ? "Please review the comments below and resubmit." :
                 status === "on_hold" ? "Our team needs you to fix one thing before we can approve." :
                 status === "submitted" ? "Our team will verify your documents within 24 hours." :
                 "Complete your KYC to unlock your AI-powered storefront."}
              </div>
            </div>
          </div>

          {status === "on_hold" && holdComment && (
            <div data-testid="hold-comment-box" className="mt-4 p-3 rounded-xl bg-white border border-[#E68910]/30">
              <div className="text-[10px] uppercase tracking-widest text-[#E68910] font-bold mb-1">What to fix</div>
              <div className="text-sm text-[#1C1C1C] whitespace-pre-wrap">{holdComment}</div>
            </div>
          )}

          {status === "draft" && (
            <Link to="/merchant/kyc" data-testid="start-kyc" className="mt-5 inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#1A2B4C] text-white font-semibold">
              Start KYC <ArrowRight size={14} />
            </Link>
          )}
          {status === "rejected" && (
            <Link to="/merchant/kyc" className="mt-5 inline-flex items-center gap-2 px-5 py-3 rounded-full bg-red-500 text-white font-semibold">
              Resubmit KYC <ArrowRight size={14} />
            </Link>
          )}
          {status === "on_hold" && (
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/merchant/kyc" data-testid="hold-update-kyc" className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#E68910] text-white font-semibold">
                Update KYC details <ArrowRight size={14} />
              </Link>
              <button onClick={resubmit} data-testid="hold-mark-fixed" className="inline-flex items-center gap-2 px-5 py-3 rounded-full border-2 border-[#E68910] text-[#E68910] font-semibold hover:bg-[#E68910]/10">
                I've fixed it — re-review now
              </button>
            </div>
          )}
        </div>

        {notifs.length > 0 && (
          <div className="mt-6 bg-white border border-[#E5E2DC] rounded-2xl p-5">
            <h3 className="display text-lg font-bold text-[#1A2B4C] mb-3 flex items-center gap-2"><Bell size={16} /> Notifications</h3>
            <div className="space-y-3">
              {notifs.slice().reverse().map((n, i) => (
                <div key={i} data-testid={`notif-${i}`} className="flex items-start gap-3 pb-3 border-b border-[#E5E2DC] last:border-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    n.type === "kyc-approved" ? "bg-[#4F7363]/15 text-[#4F7363]" :
                    n.type === "kyc-rejected" ? "bg-red-100 text-red-500" :
                    n.type === "kyc-on-hold" ? "bg-[#E68910]/20 text-[#E68910]" :
                    "bg-[#E68910]/15 text-[#E68910]"}`}>
                    {n.type === "kyc-approved" ? <CheckCircle2 size={14} /> :
                     n.type === "kyc-rejected" ? <XCircle size={14} /> :
                     n.type === "kyc-on-hold" ? <PauseCircle size={14} /> :
                     <Sparkles size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-[#1A2B4C]">{n.title}</div>
                    <div className="text-xs text-[#595959]">{n.body}</div>
                  </div>
                  <div className="text-[10px] text-[#595959]">{new Date(n.time).toLocaleTimeString()}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 bg-white border border-[#E5E2DC] rounded-2xl p-5">
          <h3 className="display text-lg font-bold text-[#1A2B4C] mb-3">Your launch checklist</h3>
          <div className="space-y-2">
            {steps.map((s, i) => {
              const locked = s.lockUntil && status !== "approved";
              return (
                <div key={s.key + i} className={`flex items-center gap-3 p-3 rounded-xl border ${s.done ? "border-[#4F7363]/30 bg-[#4F7363]/5" : locked ? "border-[#E5E2DC] bg-[#FDFBF7] opacity-60" : "border-[#E5E2DC]"}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${s.done ? "bg-[#4F7363] text-white" : "bg-white border border-[#E5E2DC]"}`}>
                    {s.done ? <CheckCircle2 size={14} /> : i + 1}
                  </div>
                  <div className="flex-1 font-medium text-[#1A2B4C]">{s.label}</div>
                  {!locked && s.path && !s.done && (
                    <button onClick={() => nav(s.path)} className="text-xs font-semibold text-[#E68910] hover:underline">Open →</button>
                  )}
                  {locked && <span className="text-[10px] text-[#595959]">Locked until approved</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </MerchantLayout>
  );
}
