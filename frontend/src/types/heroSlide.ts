// HeroSlide type — mirrors the real Mongo `hero_slides` collection shape
// (redesign Phase A). Backs HeroCarousel.tsx's per-L1 slide list — a
// GENUINELY SEPARATE system from the existing single site-wide Hero
// banner (HeroConfig, in cms.ts), which this does not replace.

import type { Id, IsoDateTime } from "./common";

export interface HeroSlide {
  id: Id;
  l1_id: string;
  image: string;
  image_public_id?: string;
  eyebrow?: string;
  headline?: string;
  /** Phase G3 — optional secondary line rendered below the headline. */
  subheadline?: string;
  /** Phase G3 — substring of `headline` to render in the functional
   *  orange instead of navy. Empty, or a string no longer found verbatim
   *  in `headline`, just renders the whole headline in navy. */
  highlight_text?: string;
  cta_link?: string;
  active: boolean;
  order: number;
  /** P0-5 (G20 product review) — gradient scrim is per-slide configuration
   *  now, not something HeroCarousel.tsx applies unconditionally. Defaults
   *  false; only the marketplace "globe" welcome slide has this true. */
  gradient?: boolean;
  created_at: IsoDateTime;
  updated_at?: IsoDateTime;
}

export interface HeroSlideCreatePayload {
  l1_id: string;
  image?: string;
  image_public_id?: string;
  eyebrow?: string;
  headline?: string;
  subheadline?: string;
  highlight_text?: string;
  cta_link?: string;
  active?: boolean;
  order?: number;
  gradient?: boolean;
}
