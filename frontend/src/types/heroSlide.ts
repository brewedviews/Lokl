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
  cta_link?: string;
  active: boolean;
  order: number;
  created_at: IsoDateTime;
  updated_at?: IsoDateTime;
}

export interface HeroSlideCreatePayload {
  l1_id: string;
  image?: string;
  image_public_id?: string;
  eyebrow?: string;
  headline?: string;
  cta_link?: string;
  active?: boolean;
  order?: number;
}
