"use client";

/**
 * Merchant onboarding home — "Getting your shop ready."
 *
 * Redesigned to answer, at a glance: what's done, what's next, why, what's
 * skippable, what's blocking, and when the shop goes live — driven entirely
 * by GET /merchant/onboarding-status (additive, reuses the exact same gates
 * as _merchant_next_route; no routing/gating logic changed here).
 *
 * Replaces the old 5-item checklist that hardcoded `done: false` for the
 * products/publish steps and linked to a /merchant/publish-ready page that
 * never existed.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2, Circle, Clock, XCircle, PauseCircle, ArrowRight, Bell,
  PartyPopper, Loader2, LifeBuoy,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import type { OnboardingStatusResponse } from "@/lib/api/merchant";

interface Notif { type: string; title: string; body: string; time: string }

const STEP_META = {
  verify_business: { title: "Verify your business", blurb: "A few details so we can confirm you run a real shop." },
  setup_shop: { title: "Set up your shop", blurb: "Tell customers where you are and what you sell." },
  add_products: { title: "Add your products", blurb: "Just one product is enough to get started." },
} as const;

type StepKey = keyof typeof STEP_META;
const STEP_ORDER: StepKey[] = ["verify_business", "setup_shop", "add_products"];

export default function MerchantOnboardingPage() {
  const router = useRouter();
  const [status, setStatus] = useState<OnboardingStatusResponse | null>(null);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [requestingHelp, setRequestingHelp] = useState(false);
  const [helpSent, setHelpSent] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const s = await api.merchant.onboardingStatus();
        setStatus(s);
      } catch { /* keep polling */ }
      apiClient.get<Notif[]>("/api/merchant/notifications").then((r) => setNotifs(r.data)).catch(() => {});
    };
    void load();
    const i = setInterval(load, 10000);
    return () => clearInterval(i);
  }, []);

  const requestHelp = async () => {
    setRequestingHelp(true);
    try {
      await api.merchant.requestAssistance();
      setHelpSent(true);
      toast.success("We've let our team know — they'll reach out shortly.");
    } catch {
      toast.error("Couldn't send your request. Please try again.");
    } finally {
      setRequestingHelp(false);
    }
  };

  if (!status) {
    return (
      <div className="p-6 md:p-10 pb-24 md:pb-10 max-w-4xl flex items-center gap-2 text-[#595959]">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    );
  }

  // ── Fully launched — the merchant should never have to wonder. ──
  if (status.step === "live") {
    return (
      <div className="p-6 md:p-10 pb-24 md:pb-10 max-w-2xl">
        <div className="bg-gradient-to-br from-[#4F7363]/10 to-white border-2 border-[#4F7363]/30 rounded-3xl p-8 text-center">
          <div className="text-5xl mb-3">🎉</div>
          <h1 className="font-display text-2xl md:text-3xl font-bold text-[#1A2B4C]">Your shop is now live!</h1>
          <div className="mt-5 space-y-2 text-left max-w-xs mx-auto">
            <CheckRow label="Business verified" />
            <CheckRow label="Shop set up" />
            <CheckRow label="Products added" />
          </div>
          <p className="text-sm text-[#595959] mt-5">Customers can now discover and shop from your store on Lokl.</p>
          <div className="flex flex-col sm:flex-row gap-2 mt-6 justify-center">
            {status.store_id && (
              <Link href={`/store/${status.store_id}`} className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full border-2 border-[#1A2B4C] text-[#1A2B4C] font-semibold">
                View my shop
              </Link>
            )}
            <button onClick={() => router.push("/merchant/orders")} className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-[#1A2B4C] text-white font-semibold">
              Go to orders <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentStep = status.step as StepKey;
  const verify = status.verify_business;
  const activeCount = status.add_products.active_count;

  return (
    <div className="p-6 md:p-10 pb-24 md:pb-10 max-w-4xl">
      <h1 className="font-display text-3xl md:text-4xl font-bold text-[#1A2B4C]">Getting your shop ready</h1>
      <p className="text-[#595959] mt-1">Three quick steps and customers can start ordering from you.</p>

      {/* Blocked-state banner (needs_changes) — explicit "why" + what to fix. */}
      {verify.status === "needs_changes" && (
        <div data-testid="verify-needs-changes-banner" className="mt-6 p-4 rounded-2xl bg-red-50 border border-red-200 flex items-start gap-3">
          <XCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-[#1A2B4C] text-sm">We need a couple of changes before we can verify your business</div>
            {verify.blocked_reason && <div className="text-sm text-[#1C1C1C] mt-1 whitespace-pre-wrap">{verify.blocked_reason}</div>}
          </div>
        </div>
      )}
      {verify.status === "in_review" && (
        <div data-testid="verify-in-review-banner" className="mt-6 p-4 rounded-2xl bg-[#E68910]/5 border border-[#E68910]/30 flex items-center gap-3">
          <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#E68910] opacity-75 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#E68910]" />
          </span>
          <div className="text-sm text-[#1C1C1C]">Your business details are being reviewed — this usually takes a few hours. We'll move you forward automatically, no need to refresh.</div>
        </div>
      )}

      {/* Step list — always shows: completed / in review / needs changes / not started / locked. */}
      <div className="mt-6 bg-white border border-[#E5E2DC] rounded-2xl p-5" data-testid="onboarding-steps">
        <div className="space-y-2">
          {STEP_ORDER.map((key, i) => {
            const meta = STEP_META[key];
            const stepStatus: string = key === "verify_business" ? verify.status
              : key === "setup_shop" ? status.setup_shop.status
              : status.add_products.status;
            const isCurrent = key === currentStep;
            const isLocked = stepStatus === "locked";
            const isDone = stepStatus === "completed";
            return (
              <div
                key={key}
                data-testid={`onboarding-step-${key}`}
                className={`flex items-start gap-3 p-3.5 rounded-xl border ${
                  isDone ? "border-[#4F7363]/30 bg-[#4F7363]/5"
                  : isCurrent ? "border-[#1A2B4C]/30 bg-[#1A2B4C]/5"
                  : "border-[#E5E2DC] bg-[#FDFBF7]"
                } ${isLocked ? "opacity-60" : ""}`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                  isDone ? "bg-[#4F7363] text-white" : "bg-white border border-[#E5E2DC] text-[#595959]"
                }`}>
                  {isDone ? <CheckCircle2 size={14} /> : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[#1A2B4C] text-sm">{meta.title}</div>
                  <div className="text-xs text-[#595959] mt-0.5">{meta.blurb}</div>
                  {key === "add_products" && activeCount > 0 && (
                    <div className="text-xs text-[#4F7363] font-semibold mt-1">{activeCount} active product{activeCount === 1 ? "" : "s"}</div>
                  )}
                </div>
                <StepBadge status={stepStatus} />
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-[#94A3B8] mt-3">Your progress is saved — you can continue later, any time.</p>

      {/* Single primary CTA — never make the merchant choose what to do. */}
      <div className="mt-5 bg-white border border-[#E5E2DC] rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#595959] font-bold">Next</div>
          <div className="font-display text-lg font-bold text-[#1A2B4C]">{status.next_action.label}</div>
        </div>
        {verify.status !== "in_review" && (
          <Link
            href={status.next_action.path}
            data-testid="onboarding-primary-cta"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-[#E68910] text-white font-semibold hover:bg-[#C9770E] shrink-0"
          >
            Continue with {status.next_action.label} <ArrowRight size={14} />
          </Link>
        )}
      </div>

      <p className="text-xs text-[#94A3B8] mt-3">
        Once your business is approved, your shop is set up and you have at least one product, your shop will automatically go live on Lokl.
      </p>

      {notifs.length > 0 && (
        <div className="mt-6 bg-white border border-[#E5E2DC] rounded-2xl p-5">
          <h3 className="font-display text-lg font-bold text-[#1A2B4C] mb-3 flex items-center gap-2"><Bell size={16} /> Notifications</h3>
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
                   <PartyPopper size={14} />}
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

      {/* Merchant-requested assistance — bridges to admin's existing setup-on-behalf-of capabilities. */}
      <div className="mt-6 bg-[#FDFBF7] border border-[#E5E2DC] rounded-2xl p-5 flex items-start gap-3">
        <LifeBuoy size={20} className="text-[#E68910] shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-bold text-[#1A2B4C] text-sm">Need help setting up your shop?</div>
          <div className="text-xs text-[#595959] mt-0.5">Our team can help you complete your shop setup and add products.</div>
        </div>
        {helpSent ? (
          <span data-testid="assistance-sent" className="text-xs font-semibold text-[#4F7363] shrink-0">Request sent ✓</span>
        ) : (
          <button
            onClick={() => void requestHelp()}
            disabled={requestingHelp}
            data-testid="request-assistance-btn"
            className="text-xs font-bold text-[#E68910] hover:underline shrink-0 disabled:opacity-50"
          >
            {requestingHelp ? "Sending…" : "Request Lokl assistance"}
          </button>
        )}
      </div>
    </div>
  );
}

function StepBadge({ status }: { status: string }) {
  if (status === "completed") return <span data-testid="badge-completed" className="text-[10px] uppercase font-bold px-2.5 py-1 rounded-full bg-[#4F7363]/15 text-[#4F7363] shrink-0">Completed</span>;
  if (status === "in_review") return <span data-testid="badge-in-review" className="text-[10px] uppercase font-bold px-2.5 py-1 rounded-full bg-[#E68910]/15 text-[#E68910] shrink-0 flex items-center gap-1"><Clock size={10} /> In review</span>;
  if (status === "needs_changes") return <span data-testid="badge-needs-changes" className="text-[10px] uppercase font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-600 shrink-0">Needs changes</span>;
  if (status === "locked") return <span data-testid="badge-locked" className="text-[10px] uppercase font-bold px-2.5 py-1 rounded-full bg-[#F5F5F5] text-[#9CA3AF] shrink-0">Locked</span>;
  return <span data-testid="badge-not-started" className="text-[10px] uppercase font-bold px-2.5 py-1 rounded-full bg-[#F5F5F5] text-[#595959] shrink-0 flex items-center gap-1"><Circle size={10} /> Not started</span>;
}

function CheckRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[#1A2B4C]">
      <CheckCircle2 size={16} className="text-[#4F7363] shrink-0" /> {label}
    </div>
  );
}
