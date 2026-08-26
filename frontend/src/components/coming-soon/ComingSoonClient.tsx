"use client";

/**
 * ComingSoonClient — rebuilt from docs/design/lokl-coming-soon-redesign.html,
 * replacing the prior direction's embedded tabbed form + fake ticker with
 * this reference's actual structure: header -> hero (incl. scroll cue) ->
 * customer proposition -> how it works -> why Lokl -> merchant section ->
 * get-started (two cards) -> closing statement -> footer.
 *
 * Dropped from the prior build: ComingSoonTicker (fake animated store
 * count — not in this brief's page structure, reads as a stats dashboard)
 * and ComingSoonWaitlistForm (single tabbed card embedded in the hero —
 * replaced by ComingSoonGetStarted's two permanently-visible cards). See
 * each remaining component's own doc comment for what was verified/
 * corrected against the real product before writing its copy.
 */
import { useEffect, useRef } from "react";
import { apiClient } from "@/lib/api-client";
import { ComingSoonHeader } from "./ComingSoonHeader";
import { ComingSoonHero } from "./ComingSoonHero";
import { ComingSoonCustomerSection } from "./ComingSoonCustomerSection";
import { ComingSoonHowItWorks } from "./ComingSoonHowItWorks";
import { ComingSoonWhyLokl } from "./ComingSoonWhyLokl";
import { ComingSoonMerchantSection } from "./ComingSoonMerchantSection";
import { ComingSoonGetStarted } from "./ComingSoonGetStarted";

function ClosingStatement() {
  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-8 pt-2 pb-14 text-center" data-testid="coming-soon-closing">
      <h2 className="font-display font-bold text-xl sm:text-2xl text-brand-primary tracking-tight">
        Lokl is coming to Bhilai.
      </h2>
      <p className="text-[14px] text-[#595959] mt-1.5">Be there from day one.</p>
    </section>
  );
}

function ComingSoonFooter() {
  return (
    <footer className="bg-brand-primary text-center py-11 px-8" data-testid="coming-soon-footer">
      <span className="font-display text-xl font-bold tracking-tight text-white inline-block mb-2.5">
        lokl<span className="text-brand-accent">.</span>
      </span>
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-[13px] my-3.5">
        <a href="/privacy" className="text-white/45 hover:text-white/70">Privacy</a>
        <a href="/terms" className="text-white/45 hover:text-white/70">Terms</a>
        <a href="mailto:hello@shoplokl.in" className="text-white/45 hover:text-white/70">hello@shoplokl.in</a>
        <a href="https://merchant.shoplokl.in" className="text-white/45 hover:text-white/70">Register your store</a>
      </div>
      <p className="text-[12px] text-white/30 mt-1.5">Bhilai, Chhattisgarh &middot; Lokl Technologies</p>
    </footer>
  );
}

export function ComingSoonClient() {
  const loggedView = useRef(false);
  useEffect(() => {
    if (loggedView.current) return;
    loggedView.current = true;
    apiClient.post("/api/page-view", {}, { params: { page: "coming-soon" } }).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <ComingSoonHeader />
      <main className="flex-1">
        <ComingSoonHero />
        <ComingSoonCustomerSection />
        <ComingSoonHowItWorks />
        <ComingSoonWhyLokl />
        <ComingSoonMerchantSection />
        <ComingSoonGetStarted />
        <ClosingStatement />
      </main>
      <ComingSoonFooter />
    </div>
  );
}
