/**
 * l1HeroConfig — per-L1 hero content for /c/[slug] (CategoryClient's own
 * hero, distinct from Home's hero). Same HeroSlide shape HeroCarousel
 * already uses for Home, reused directly rather than inventing a parallel
 * type — CategoryClient renders `<HeroCarousel slides={getL1HeroSlides(...)}
 * compact/>` with a ONE-slide array per L1 today, which is exactly what
 * makes HeroCarousel render as a static (non-autoplaying, no dots) hero —
 * see its own doc comment: autoplay and the dot strip both no-op when
 * `slides.length <= 1`. The `compact` prop is what shrinks the hero itself
 * (~45% of Home's default height) — see HeroCarousel's own doc comment.
 * Nothing about this file's shape changes if a given L1 ever needs
 * multiple slides later — just add more entries to that L1's array.
 *
 * Copy is deliberately ONE line per L1 now — eyebrow (short, all-caps
 * category label) + a single sentence stating what the page is, no
 * separate headline/subtitle/multi-line structure. `subtitle` is omitted
 * everywhere here on purpose (HeroCarousel only renders it when present)
 * — an earlier version had a 2-3 line headline+subtitle pairing sized for
 * a much taller hero; once the hero shrank to a thin banner, that copy
 * no longer fit its own container, so it was cut down to match, not just
 * visually shrunk.
 *
 * Every image here is the same Unsplash asset backend/seed_data.py's
 * L1_CATEGORIES already uses for that exact category's own tile image —
 * not a new upload, just referenced at a hero-appropriate width. Same
 * reuse principle DEFAULT_HERO_SLIDES (Home's own placeholder hero data)
 * already established in HeroCarousel.tsx.
 *
 * It's a static object today; migrating to offers-model-backed hero
 * content later (once ALLOWED_OFFER_FIELDS is fixed, per the earlier
 * structural audit) only means changing what `getL1HeroSlides` returns,
 * not how CategoryClient calls it.
 */
import type { HeroSlide } from "./HeroCarousel";

export const L1_HERO_SLIDES: Record<string, HeroSlide[]> = {
  women: [{
    id: "women-hero",
    image: "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200&q=80",
    eyebrow: "WOMEN",
    title: "Fashion from local Bhilai shops, for women.",
    ctaLabel: "Shop Women",
    ctaHref: "/c/women",
  }],
  men: [{
    id: "men-hero",
    image: "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=1200&q=80",
    eyebrow: "MEN",
    title: "Fashion from local Bhilai shops, for men.",
    ctaLabel: "Shop Men",
    ctaHref: "/c/men",
  }],
  ethnic: [{
    id: "ethnic-hero",
    image: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=1200&q=80",
    eyebrow: "ETHNIC WEAR",
    title: "Kurtas, sarees and more from local Bhilai shops.",
    ctaLabel: "Shop Ethnic Wear",
    ctaHref: "/c/ethnic",
  }],
  footwear: [{
    id: "footwear-hero",
    image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1200&q=80",
    eyebrow: "FOOTWEAR",
    title: "Sneakers, sandals and formal shoes from local Bhilai shops.",
    ctaLabel: "Shop Footwear",
    ctaHref: "/c/footwear",
  }],
  lingerie: [{
    id: "lingerie-hero",
    image: "https://images.unsplash.com/photo-1568441556126-f36ae0900180?w=1200&q=80",
    eyebrow: "LINGERIE",
    title: "Everyday lingerie & innerwear from local Bhilai shops.",
    ctaLabel: "Shop Lingerie",
    ctaHref: "/c/lingerie",
  }],
  kids: [{
    id: "kids-hero",
    image: "https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=1200&q=80",
    eyebrow: "KIDS",
    title: "Playful, comfortable fashion from local Bhilai shops.",
    ctaLabel: "Shop Kids",
    ctaHref: "/c/kids",
  }],
  accessories: [{
    id: "accessories-hero",
    image: "https://images.unsplash.com/photo-1492707892479-7bc8d5a4ee93?w=1200&q=80",
    eyebrow: "ACCESSORIES",
    title: "Bags, jewellery and more from local Bhilai shops.",
    ctaLabel: "Shop Accessories",
    ctaHref: "/c/accessories",
  }],
  beauty: [{
    id: "beauty-hero",
    image: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=1200&q=80",
    eyebrow: "BEAUTY",
    title: "Skincare and makeup from local Bhilai shops.",
    ctaLabel: "Shop Beauty",
    ctaHref: "/c/beauty",
  }],
  sports: [{
    id: "sports-hero",
    image: "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=1200&q=80",
    eyebrow: "SPORTS",
    title: "Activewear and sports essentials from local Bhilai shops.",
    ctaLabel: "Shop Sports",
    ctaHref: "/c/sports",
  }],
};

// Fallback for any L1 slug not in the map above (a category added to the
// backend taxonomy after this file was written) — a generic but honest
// hero rather than a blank gap or a crash. Reuses the Women photo only as
// a visual placeholder; the copy itself is fully generic, same eyebrow +
// one-line pattern as every other entry above.
export function getL1HeroSlides(slug: string, l1Name: string): HeroSlide[] {
  if (L1_HERO_SLIDES[slug]) return L1_HERO_SLIDES[slug];
  return [{
    id: `${slug}-hero-fallback`,
    image: "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200&q=80",
    eyebrow: l1Name.toUpperCase(),
    title: `${l1Name} from local Bhilai shops.`,
    ctaLabel: `Shop ${l1Name}`,
    ctaHref: `/c/${slug}`,
  }];
}
