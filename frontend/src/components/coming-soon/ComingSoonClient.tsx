"use client";

/**
 * ComingSoonClient — brand launch page, not a marketplace preview.
 * Structure: header -> hero (rider-delivering-home illustration, benefit
 * strip, scroll cue) -> what is Lokl (editorial) -> how it works (a
 * connected journey) -> why Lokl (customer positioning) -> merchant
 * section -> get started (two waitlist cards) -> footer. No closing
 * statement this pass — kept the page to exactly the sections asked for,
 * since the goal was less information, not more.
 *
 * Every section's own doc comment records what was verified against the
 * real product (delivery fee/commission/free-plan claims, the real
 * try_at_doorstep mechanic, the real merchant/login route) before writing
 * its copy — nothing here restates unverified numbers.
 */
import { useEffect, useRef } from "react";
import { apiClient } from "@/lib/api-client";
import { ComingSoonHeader } from "./ComingSoonHeader";
import { ComingSoonHero } from "./ComingSoonHero";
import { ComingSoonWhatIsLokl } from "./ComingSoonWhatIsLokl";
import { ComingSoonHowItWorks } from "./ComingSoonHowItWorks";
import { ComingSoonWhyLokl } from "./ComingSoonWhyLokl";
import { ComingSoonMerchantSection } from "./ComingSoonMerchantSection";
import { ComingSoonGetStarted } from "./ComingSoonGetStarted";

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
    <div className="min-h-screen bg-brand-bg flex flex-col">
      <ComingSoonHeader />
      <main className="flex-1">
        <ComingSoonHero />
        <ComingSoonWhatIsLokl />
        <ComingSoonHowItWorks />
        <ComingSoonWhyLokl />
        <ComingSoonMerchantSection />
        <ComingSoonGetStarted />
      </main>
      <ComingSoonFooter />
    </div>
  );
}
