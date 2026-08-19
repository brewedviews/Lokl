"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { Bike } from "lucide-react";
import { trackAssetClick } from "@/lib/api/admin";
import { ETAHeaderCard } from "@/components/consumer/ETAHeaderCard";

const FALLBACK_HERO_IMG =
  "https://customer-assets.emergentagent.com/job_bharat-fashion-os/artifacts/n1elwepz_ChatGPT%20Image%20May%2016%2C%202026%2C%2006_29_23%20PM.png";

interface HeroConfig {
  image?: string;
  mobile_image?: string;
  eyebrow?: string;
  title_line1?: string;
  title_line2?: string;
  subtitle?: string;
  redirect_url?: string;
  cta_primary_label?: string;
  cta_primary_link?: string;
  paused?: boolean;
  non_clickable?: boolean;
}

interface Stats {
  fastest_eta_min?: number;
}

interface DeliveryStatus {
  status: string;
  label: string;
  eta_label: string;
  message: string;
}

/** Hero card with cream wash over Bhilai backdrop. Ported from CRA HeroV2.jsx. */
export function HeroV2({ stats, hero }: { stats?: Stats | null; hero?: HeroConfig | null }) {
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus | null>(null);

  useEffect(() => {
    fetch("/api/feed/delivery-status")
      .then(r => r.json())
      .then(d => setDeliveryStatus(d))
      .catch(() => {});
  }, []);

  // iter-27 (Item 7) — admin paused this hero. Hide entirely from consumers.
  if (hero?.paused) return null;

  const img = hero?.image || FALLBACK_HERO_IMG;
  const mobileImg = hero?.mobile_image || img;
  const t1 = hero?.title_line1 || "Bhilai's own neighbourhood";
  const t2 = hero?.title_line2 || "shopping app.";
  const sub = hero?.subtitle || "Shop from trusted local stores around you.";
  const eta = stats?.fastest_eta_min || 45;
  // "CLOSED" (outside operating hours) is a scheduled, forward-looking state —
  // don't lead a first-time visitor with a bold negative badge for it. AWAY
  // (in-hours but temporarily offline) keeps its badge since that's a more
  // notable, unscheduled state.
  const isClosedLabel = deliveryStatus?.label === "CLOSED";
  const redirect = hero?.redirect_url || hero?.cta_primary_link || "";
  // iter-27 (Item 7) — non_clickable forces static render even if a redirect is set.
  const clickable = !hero?.non_clickable && !!redirect;

  const onClick = () => {
    if (redirect) void trackAssetClick("hero", "homepage", redirect);
  };

  const inner = (
    <>
      <Image
        src={img}
        alt="Bhilai Globe Chowk"
        fill
        priority
        sizes="(max-width: 768px) 100vw, 1200px"
        className="object-cover object-[60%_45%] md:object-center hidden md:block"
      />
      <Image
        src={mobileImg}
        alt="hero mobile"
        fill
        priority
        sizes="100vw"
        className="object-cover object-center md:hidden"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#FDFBF7]/95 via-[#FDFBF7]/80 to-[#FDFBF7]/30 md:bg-gradient-to-r md:from-[#FDFBF7]/95 md:via-[#FDFBF7]/55 md:to-transparent" />
      <div className="relative px-5 md:px-10 lg:px-12 py-6 md:py-10 min-h-[300px] md:min-h-[320px] flex flex-col justify-between md:justify-center max-w-2xl">
        <div>
          <h1 className="font-display text-[28px] leading-[1.1] md:text-4xl lg:text-5xl font-bold tracking-tight text-[#0A1F5C]">
            {t1} <span className="text-[#E68910]">{t2}</span>
          </h1>
          <p className="mt-2.5 md:mt-3 text-[13px] md:text-base text-[#0A1F5C]/75 md:text-[#475569] max-w-md leading-relaxed">
            {sub}
          </p>
        </div>
        {/* Compact pill — sits in normal flow below the headline, so it can
            never collide with it. Shown through the tablet range and only
            swapped for the roomier floating card (below) once the container
            is wide enough (xl) that the two genuinely don't overlap. Both
            are the same shared ETAHeaderCard (redesign-plan 3.7) at
            different size/variant settings, not two separate components. */}
        <ETAHeaderCard
          variant="pill"
          size="compact"
          className="xl:hidden mt-4 self-start"
          testId="hero-fastest-eta-mobile"
          icon={Bike}
          title={deliveryStatus?.eta_label || `${eta} minutes`}
          subtitle={deliveryStatus?.message || "Fast delivery"}
          muted={isClosedLabel}
          statusBadge={isClosedLabel ? null : { label: deliveryStatus?.label || "LIVE", tone: deliveryStatus?.label === "AWAY" ? "away" : "live" }}
        />
      </div>
      <ETAHeaderCard
        variant="pill"
        size="roomy"
        className="hidden xl:inline-flex absolute top-1/2 right-6 lg:right-10 -translate-y-1/2 min-w-[260px] shadow-xl"
        testId="hero-fastest-eta"
        icon={Bike}
        title={deliveryStatus?.eta_label || `${eta} minutes`}
        subtitle={deliveryStatus?.message || "Fast delivery in Bhilai"}
        muted={isClosedLabel}
        statusBadge={isClosedLabel ? null : { label: deliveryStatus?.label || "LIVE", tone: deliveryStatus?.label === "AWAY" ? "away" : "live" }}
      />
    </>
  );

  return (
    <section data-testid="hero-v2" className="relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 md:pt-6">
        {clickable ? (
          <Link href={redirect} onClick={onClick} data-testid="hero-redirect-link"
                className="block relative rounded-2xl overflow-hidden bg-[#0A1F5C] min-h-[300px] md:min-h-[320px]">
            {inner}
          </Link>
        ) : (
          <div className="relative rounded-2xl overflow-hidden bg-[#0A1F5C] min-h-[300px] md:min-h-[320px]" data-testid="hero-static">
            {inner}
          </div>
        )}
      </div>
    </section>
  );
}
