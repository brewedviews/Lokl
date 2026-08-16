/**
 * l1HeroConfig — per-L1 hero content for /c/[slug] (CategoryClient's own
 * hero, distinct from Home's hero). Same HeroSlide shape HeroCarousel
 * already uses for Home, reused directly rather than inventing a parallel
 * type — CategoryClient renders `<HeroCarousel slides={getL1HeroSlides(...)}/>`
 * with a ONE-slide array per L1 today, which is exactly what makes
 * HeroCarousel render as a static (non-autoplaying, no dots) hero — see
 * its own doc comment: autoplay and the dot strip both no-op when
 * `slides.length <= 1`. Nothing about this file's shape changes if a
 * given L1 ever needs multiple slides later — just add more entries to
 * that L1's array.
 *
 * Every image here is the same Unsplash asset backend/seed_data.py's
 * L1_CATEGORIES already uses for that exact category's own tile image —
 * not a new upload, just referenced at a hero-appropriate width. Same
 * reuse principle DEFAULT_HERO_SLIDES (Home's own placeholder hero data)
 * already established in HeroCarousel.tsx.
 *
 * This is placeholder-but-real copy, not lorem ipsum — written per
 * category, not a single generic template with the name swapped in. It's
 * a static object today; migrating to offers-model-backed hero content
 * later (once ALLOWED_OFFER_FIELDS is fixed, per the earlier structural
 * audit) only means changing what `getL1HeroSlides` returns, not how
 * CategoryClient calls it.
 */
import type { HeroSlide } from "./HeroCarousel";

export const L1_HERO_SLIDES: Record<string, HeroSlide[]> = {
  women: [{
    id: "women-hero",
    image: "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200&q=80",
    eyebrow: "New in",
    title: "Fresh styles from Bhilai's favourite boutiques",
    subtitle: "Dresses, ethnic wear, co-ord sets and more — delivered in minutes.",
    ctaLabel: "Shop Women",
    ctaHref: "/c/women",
  }],
  men: [{
    id: "men-hero",
    image: "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=1200&q=80",
    eyebrow: "Trending",
    title: "Level up your everyday wardrobe",
    subtitle: "Shirts, jeans, ethnic wear and more from local stores.",
    ctaLabel: "Shop Men",
    ctaHref: "/c/men",
  }],
  ethnic: [{
    id: "ethnic-hero",
    image: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=1200&q=80",
    eyebrow: "Festive ready",
    title: "Ethnic wear for every occasion",
    subtitle: "Kurtas, sarees and more from Bhilai's own stores.",
    ctaLabel: "Shop Ethnic Wear",
    ctaHref: "/c/ethnic",
  }],
  footwear: [{
    id: "footwear-hero",
    image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1200&q=80",
    eyebrow: "Step up",
    title: "Footwear for every stride",
    subtitle: "Sneakers, sandals and formal shoes, delivered fast.",
    ctaLabel: "Shop Footwear",
    ctaHref: "/c/footwear",
  }],
  lingerie: [{
    id: "lingerie-hero",
    image: "https://images.unsplash.com/photo-1568441556126-f36ae0900180?w=1200&q=80",
    eyebrow: "Everyday essentials",
    title: "Comfort-first lingerie & innerwear",
    subtitle: "Everyday essentials from trusted local stores.",
    ctaLabel: "Shop Lingerie",
    ctaHref: "/c/lingerie",
  }],
  kids: [{
    id: "kids-hero",
    image: "https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=1200&q=80",
    eyebrow: "Little ones",
    title: "Playful styles for little ones",
    subtitle: "Comfortable, durable fashion for every age.",
    ctaLabel: "Shop Kids",
    ctaHref: "/c/kids",
  }],
  accessories: [{
    id: "accessories-hero",
    image: "https://images.unsplash.com/photo-1492707892479-7bc8d5a4ee93?w=1200&q=80",
    eyebrow: "Finish the look",
    title: "The finishing touch to every outfit",
    subtitle: "Bags, jewellery and more from Bhilai stores.",
    ctaLabel: "Shop Accessories",
    ctaHref: "/c/accessories",
  }],
  beauty: [{
    id: "beauty-hero",
    image: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=1200&q=80",
    eyebrow: "Self care",
    title: "Beauty essentials, delivered fast",
    subtitle: "Skincare, makeup and more from local stores.",
    ctaLabel: "Shop Beauty",
    ctaHref: "/c/beauty",
  }],
  sports: [{
    id: "sports-hero",
    image: "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=1200&q=80",
    eyebrow: "Game on",
    title: "Gear up for your next workout",
    subtitle: "Activewear and sports essentials, delivered fast.",
    ctaLabel: "Shop Sports",
    ctaHref: "/c/sports",
  }],
};

// Fallback for any L1 slug not in the map above (a category added to the
// backend taxonomy after this file was written) — a generic but honest
// hero rather than a blank gap or a crash. Reuses the Women photo only as
// a visual placeholder; the copy itself is fully generic.
export function getL1HeroSlides(slug: string, l1Name: string): HeroSlide[] {
  if (L1_HERO_SLIDES[slug]) return L1_HERO_SLIDES[slug];
  return [{
    id: `${slug}-hero-fallback`,
    image: "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200&q=80",
    eyebrow: "Shop local",
    title: `${l1Name}, from Bhilai's own stores`,
    subtitle: "Hand-picked picks from trusted local sellers, delivered fast.",
    ctaLabel: `Shop ${l1Name}`,
    ctaHref: `/c/${slug}`,
  }];
}
