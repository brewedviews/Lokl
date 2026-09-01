"use client";

/**
 * ComingSoonClient — brand launch page, not a marketplace preview.
 *
 * Deliberately organized as four chapters rather than a run of unrelated
 * sections (01 hero, 02 what-is-Lokl + how-it-works, 03 why Lokl, 04
 * merchant + get-started) — a thin dashed "stitch" divider marks each
 * chapter boundary, a restrained nod to a tailor's cutting line rather
 * than a hard rule or a background-color block.
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

function Stitch() {
  return <div className="max-w-4xl mx-auto px-5 sm:px-8"><div className="border-t border-dashed border-card-border" /></div>;
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
      <p className="text-[12px] text-white/30 mt-1.5">Bhilai, Chhattisgarh &middot; Lokl, by Ujjwal Deshlahare</p>
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
        <Stitch />
        <ComingSoonWhyLokl />
        <Stitch />
        <ComingSoonMerchantSection />
        <ComingSoonGetStarted />
      </main>
      <ComingSoonFooter />
    </div>
  );
}
