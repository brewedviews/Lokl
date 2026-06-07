"""Iter-26 — Premium homepage visual asset refresh.

Replaces the placeholder Unsplash imagery on:
  • `categories.image`  — the 6 visible homepage tiles
  • `offers.image`      — the 4 seeded promo banners
  • `site_config.hero`  — the homepage hero banner image

All images are curated Unsplash editorial fashion shots picked for a
**cohesive** premium retail look (clean, modern, single-subject, consistent
crop/aspect). Match Myntra/Ajio/Nykaa-Fashion benchmark.

Usage:
    python -m seeds.run refresh_homepage_assets
"""
from datetime import datetime, timezone


# ── Premium fashion editorial set, consistent light-neutral aesthetic ──
CATEGORY_IMAGES = {
    "women":       "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&auto=format&fit=crop&q=85",
    "men":         "https://images.unsplash.com/photo-1490114538077-0a7f8cb49891?w=800&auto=format&fit=crop&q=85",
    "footwear":    "https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&auto=format&fit=crop&q=85",
    "accessories": "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=800&auto=format&fit=crop&q=85",
    "kids":        "https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?w=800&auto=format&fit=crop&q=85",
    "beauty":      "https://images.unsplash.com/photo-1612817288484-6f916006741a?w=800&auto=format&fit=crop&q=85",
    # Hidden tiles — keep refreshed so /c/ pages still look clean if re-enabled
    "streetwear":  "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&auto=format&fit=crop&q=85",
    "electronics": "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop&q=85",
    "sports":      "https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=800&auto=format&fit=crop&q=85",
}

# Premium retail-banner aesthetic (16:9), no clip-art / cartoons.
# Each maps by `title` since the seeded IDs are random per insert.
OFFER_IMAGES_BY_TITLE = {
    "Summer Fashion Sale": "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1600&auto=format&fit=crop&q=85",
    "Women's Collection":  "https://images.unsplash.com/photo-1488161628813-04466f872be2?w=1600&auto=format&fit=crop&q=85",
    "Footwear Fest":       "https://images.unsplash.com/photo-1460353581641-37baddab0fa2?w=1600&auto=format&fit=crop&q=85",
    "Kids Fashion Week":   "https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?w=1600&auto=format&fit=crop&q=85",
}

# Hero — editorial fashion + storefront lifestyle. Cream gradient overlay
# means the right side is shown, so pick an image with strong right-side
# composition.
HERO_IMAGE = "https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=2000&auto=format&fit=crop&q=85"


async def up(db):
    now = datetime.now(timezone.utc).isoformat()
    results = {"categories": 0, "offers": 0, "hero": False}

    # Categories
    for slug, url in CATEGORY_IMAGES.items():
        r = await db.categories.update_one(
            {"slug": slug},
            {"$set": {"image": url, "updated_at": now}},
        )
        if r.modified_count or r.matched_count:
            results["categories"] += 1

    # Offers (match by title since IDs are random)
    for title, url in OFFER_IMAGES_BY_TITLE.items():
        r = await db.offers.update_many(
            {"title": title},
            {"$set": {"image": url, "updated_at": now}},
        )
        results["offers"] += r.modified_count

    # Hero in site_config.homepage
    r = await db.site_config.update_one(
        {"id": "homepage"},
        {"$set": {"hero.image": HERO_IMAGE, "updated_at": now}},
        upsert=False,
    )
    results["hero"] = bool(r.modified_count)

    return (
        f"categories updated: {results['categories']}/{len(CATEGORY_IMAGES)}, "
        f"offers updated: {results['offers']}/{len(OFFER_IMAGES_BY_TITLE)}, "
        f"hero updated: {results['hero']}"
    )
