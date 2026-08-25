"use client";

/**
 * CategoryTile — the one shared category/subcategory tile component
 * (redesign-plan 3.1), replacing three previously-separate implementations
 * that had each independently built the same `w-16 h-16 rounded-full` +
 * label-below tile: CategoryTileRow.tsx (persistent strip), CategoryClient's
 * L2 grid, and HomeClient's GenderBentoSection.
 *
 * Two density variants:
 *   - "dense" (default) — the circular-avatar + label-below treatment all
 *     three call sites actually use today. Preserved pixel-for-pixel from
 *     the pre-consolidation markup (same w-16 h-16, same border/ring
 *     active-state options) so migrating call sites to this component is a
 *     pure refactor, not a visual change.
 *   - "generous" — portrait photo, bottom gradient scrim, white label baked
 *     into the image, per the plan's spec for Home/mood/search category
 *     browsing. Built now per 3.1 ("build once, not as two components") but
 *     not yet consumed by any live page — Phase 4's mood/occasion landing
 *     pages are the intended first caller.
 *
 * Deliberately presentational only: navigation (Link vs filter-button),
 * analytics tracking, and impression observation stay at each call site
 * (passed in via `href`/`onClick`/`tileRef`) rather than being baked in
 * here, since only CategoryTileRow needs click/impression tracking and
 * only CategoryClient's L2 grid is a filter-button instead of a navigation
 * link.
 */
import Link from "next/link";
import type { ReactNode } from "react";

export interface CategoryTileProps {
  density?: "generous" | "dense";
  label: string;
  image?: string | null;
  /** Navigation mode — renders as a Next <Link>. Omit and use `onClick`
   *  alone for a filter-button tile (CategoryClient's L2 grid). */
  href?: string;
  onClick?: () => void;
  active?: boolean;
  /** Which visual treatment `active` uses on the "dense" variant —
   *  CategoryTileRow's persistent strip used a ring, CategoryClient's L2
   *  filter grid used a border; both are preserved as a prop rather than
   *  picking one and losing the other. No effect on "generous". */
  activeStyle?: "ring" | "border";
  /** Rendered in place of the image when there isn't one — each call site
   *  had a different fallback (an emoji, a plain tint, a Sparkles icon). */
  fallback?: ReactNode;
  /** Override for the circular swatch's own background/border — used by
   *  CategoryTileRow's "All" tile, which is navy-filled rather than the
   *  default cream. Dense variant only. */
  circleClassName?: string;
  /** Override for the dense-variant label's own color — the three original
   *  call sites each used a slightly different active/inactive label color
   *  (CategoryTileRow: #0A1F5C at 80% when inactive; CategoryClient's L2
   *  grid: #595959; GenderBentoSection: solid #0A1F5C always, no
   *  active/inactive distinction at all). Defaults to CategoryTileRow's
   *  original scheme when omitted. */
  labelClassName?: string;
  imageLoading?: "eager" | "lazy";
  testId?: string;
  /** For impression-observer refs (CategoryTileRow only). */
  tileRef?: (el: HTMLAnchorElement | HTMLButtonElement | null) => void;
  /** G6 — small overlay pill, top-left, "generous" variant only. Lets a
   *  caller (ShopByAreaSection's store-count pill) reuse this component
   *  verbatim instead of re-implementing the generous-variant markup just
   *  to add one extra badge. No effect on "dense". */
  badge?: ReactNode;
}

export function CategoryTile({
  density = "dense",
  label,
  image,
  href,
  onClick,
  active = false,
  activeStyle = "ring",
  fallback,
  circleClassName,
  labelClassName,
  imageLoading = "lazy",
  testId,
  tileRef,
  badge,
}: CategoryTileProps) {
  const Wrapper = href ? Link : "button";
  const wrapperProps = href
    ? { href, onClick }
    : { type: "button" as const, onClick };

  if (density === "generous") {
    return (
      <Wrapper
        {...(wrapperProps as any)}
        ref={tileRef as any}
        data-testid={testId}
        className="group relative block aspect-[3/4] rounded-2xl overflow-hidden active:scale-95 transition shrink-0"
      >
        {image ? (
          <img
            src={image}
            alt={label}
            loading={imageLoading}
            className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-[#F4F1E9] flex items-center justify-center">{fallback}</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        {active && <div className="absolute inset-0 ring-2 ring-inset ring-[#E68910] rounded-2xl" />}
        {badge && <div className="absolute top-2 left-2">{badge}</div>}
        <span className="absolute bottom-2.5 left-2.5 right-2.5 text-white font-display font-medium text-sm leading-tight line-clamp-2">
          {label}
        </span>
      </Wrapper>
    );
  }

  // "dense" — circular avatar + label below, matching every current call
  // site's existing markup exactly.
  const activeClasses = activeStyle === "ring"
    ? "ring-2 ring-[#0A1F5C] ring-offset-2 ring-offset-white"
    : "border-2 border-[#0A1F5C]";
  const inactiveClasses = activeStyle === "ring" ? "border border-[#E5E2DC]" : "border-2 border-[#E5E2DC]";

  return (
    <Wrapper
      {...(wrapperProps as any)}
      ref={tileRef as any}
      data-testid={testId}
      aria-current={active ? "page" : undefined}
      className="flex-shrink-0 flex flex-col items-center gap-1.5 active:scale-95 transition"
    >
      <div className={`relative w-16 h-16 rounded-full overflow-hidden bg-[#FDFBF7] transition ${circleClassName ?? (active ? activeClasses : inactiveClasses)}`}>
        {image ? (
          <img
            src={image}
            alt={label}
            loading={imageLoading}
            className="absolute inset-0 w-full h-full object-cover object-top"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">{fallback}</div>
        )}
      </div>
      <span className={`text-[11px] font-semibold text-center w-16 leading-tight line-clamp-2 ${labelClassName ?? (active ? "text-[#0A1F5C]" : "text-[#0A1F5C]/80")}`}>
        {label}
      </span>
    </Wrapper>
  );
}
