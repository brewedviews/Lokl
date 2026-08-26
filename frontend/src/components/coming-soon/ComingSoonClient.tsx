"use client";

/**
 * ComingSoonClient — G17. Rebuilt from docs/design/coming-soon-v2.html,
 * the design/content reference the user supplied and explicitly approved
 * using as-is (see that file's own doc-comment trail across
 * ComingSoonTicker/Hero/WaitlistForm for the specific claims this
 * supersedes from G15/16's "no fake numbers" rule).
 *
 * Structure: header -> ticker -> hero (with embedded waitlist form) ->
 * how it works -> why Lokl -> merchant section -> footer. `activeTab` is
 * owned here (not inside the hero/form) so the merchant section's "List my
 * store for free" CTA can flip the hero's form to the merchant tab and
 * scroll back up to it — the same interaction the reference's own vanilla
 * JS implements via direct DOM manipulation, done here via lifted React
 * state instead.
 */
import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { ComingSoonHeader } from "./ComingSoonHeader";
import { ComingSoonTicker } from "./ComingSoonTicker";
import { ComingSoonHero } from "./ComingSoonHero";
import { ComingSoonHowItWorks } from "./ComingSoonHowItWorks";
import { ComingSoonWhyLokl } from "./ComingSoonWhyLokl";

type Tab = "customer" | "merchant";

// ---------------------------------------------------------------------------
// Merchant section — stat grid + CTA that drives the hero form's tab
// ---------------------------------------------------------------------------
const MERCHANT_STATS = [
  { big: "₹0", title: "Free to start", body: "List up to 10 products at no cost. No subscription needed to begin." },
  { big: "0%", title: "Zero commission", body: "We don't take a cut. What the customer pays is what you receive." },
  { big: "+", title: "More footfall", body: "Customers who reserve online come to your store. Every order is a potential regular." },
  { big: "30", title: "Min setup", body: "Our team sets up your store for you. WhatsApp us your products and we handle the rest." },
];

function MerchantSection({ onListMyStore }: { onListMyStore: () => void }) {
  return (
    <section className="px-4 sm:px-8 pb-14 sm:pb-20" data-testid="coming-soon-merchant">
      <div className="max-w-6xl mx-auto bg-brand-primary rounded-[28px] px-6 sm:px-12 py-10 sm:py-14">
        <p className="text-[12px] font-bold text-brand-accent uppercase tracking-[0.15em] mb-2.5">For store owners</p>
        <h2 className="font-display font-black text-[24px] sm:text-[38px] text-white leading-tight tracking-tight mb-2.5">
          Your store. All of Bhilai.
        </h2>
        <p className="text-[15px] text-white/55 leading-relaxed max-w-md mb-10">
          List your products for free. No commission. Every Lokl order can bring a new regular customer to your door.
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-10">
          {MERCHANT_STATS.map((s) => (
            <div key={s.title} className="bg-white/[0.07] border border-white/10 rounded-2xl p-5">
              <div className="font-display font-black text-[30px] text-brand-accent tracking-tight mb-1.5">{s.big}</div>
              <h4 className="text-white font-bold text-sm mb-1">{s.title}</h4>
              <p className="text-white/45 text-xs leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onListMyStore}
          data-testid="merchant-list-store-cta"
          className="bg-brand-accent text-white font-extrabold text-[15px] px-8 py-3.5 rounded-full active:scale-95 transition"
        >
          List my store for free
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer — matches the reference exactly (logo, Privacy/Terms/mailto)
// ---------------------------------------------------------------------------
function ComingSoonFooter() {
  return (
    <footer className="bg-brand-primary text-center py-11 px-8" data-testid="coming-soon-footer">
      <span className="font-display text-xl font-bold tracking-tight text-white inline-block mb-2.5">
        lokl<span className="text-brand-accent">.</span>
      </span>
      <div className="flex justify-center gap-6 text-[13px] my-3.5">
        <a href="/privacy" className="text-white/45 hover:text-white/70">Privacy</a>
        <a href="/terms" className="text-white/45 hover:text-white/70">Terms</a>
        <a href="mailto:hello@shoplokl.in" className="text-white/45 hover:text-white/70">hello@shoplokl.in</a>
      </div>
      <p className="text-[12px] text-white/30 mt-1.5">Bhilai, Chhattisgarh &middot; Lokl Technologies</p>
    </footer>
  );
}

export function ComingSoonClient() {
  const [activeTab, setActiveTab] = useState<Tab>("customer");

  const listMyStore = () => {
    setActiveTab("merchant");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const loggedView = useRef(false);
  useEffect(() => {
    if (loggedView.current) return;
    loggedView.current = true;
    apiClient.post("/api/page-view", {}, { params: { page: "coming-soon" } }).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <ComingSoonHeader />
      <ComingSoonTicker />
      <main className="flex-1">
        <ComingSoonHero activeTab={activeTab} onTabChange={setActiveTab} />
        <ComingSoonHowItWorks />
        <ComingSoonWhyLokl />
        <MerchantSection onListMyStore={listMyStore} />
      </main>
      <ComingSoonFooter />
    </div>
  );
}
