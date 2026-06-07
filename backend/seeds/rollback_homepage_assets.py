"""Iter-26 — Rollback the iter-26 cosmetic visual refresh.

Per user request, restore the pre-iter26 hero + L1 category images. Offers
restored to their original `seed_v2_offers_testimonials.py` values so the
DB matches what existed before the visual refresh.

Usage:
    python -m seeds.run rollback_homepage_assets
"""
from datetime import datetime, timezone


# Originals from seed_data.py:L1_CATEGORIES
PREVIOUS_CATEGORY_IMAGES = {
    "women":       "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=600&auto=format&fit=crop&q=80",
    "men":         "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=600&auto=format&fit=crop&q=80",
    "footwear":    "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80",
    "streetwear":  "https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=600&auto=format&fit=crop&q=80",
    "kids":        "https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=600&auto=format&fit=crop&q=80",
    "accessories": "https://images.unsplash.com/photo-1492707892479-7bc8d5a4ee93?w=600&auto=format&fit=crop&q=80",
    "beauty":      "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&auto=format&fit=crop&q=80",
    "electronics": "https://images.unsplash.com/photo-1498049794561-7780e7231661?w=600&auto=format&fit=crop&q=80",
    "sports":      "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=600&auto=format&fit=crop&q=80",
}

# Originals from seed_v2_offers_testimonials.py
PREVIOUS_OFFER_IMAGES_BY_TITLE = {
    "Summer Fashion Sale": "https://images.unsplash.com/photo-1618375601660-3e6842f5b791?w=800&q=80",
    "Women's Collection":  "https://images.unsplash.com/photo-1612782809364-17727da6669c?w=800&q=80",
    "Footwear Fest":       "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=80",
    "Kids Fashion Week":   "https://images.unsplash.com/photo-1503944583220-79d8926ad5e2?w=800&q=80",
}

# Original Lokl-branded hero from HeroV2 FALLBACK_HERO_IMG
PREVIOUS_HERO_IMAGE = (
    "https://customer-assets.emergentagent.com/job_bharat-fashion-os/artifacts/"
    "n1elwepz_ChatGPT%20Image%20May%2016%2C%202026%2C%2006_29_23%20PM.png"
)


async def up(db):
    now = datetime.now(timezone.utc).isoformat()
    cat_n = 0
    for slug, url in PREVIOUS_CATEGORY_IMAGES.items():
        r = await db.categories.update_one(
            {"slug": slug},
            {"$set": {"image": url, "updated_at": now}},
        )
        if r.matched_count:
            cat_n += 1
    off_n = 0
    for title, url in PREVIOUS_OFFER_IMAGES_BY_TITLE.items():
        r = await db.offers.update_many(
            {"title": title},
            {"$set": {"image": url, "updated_at": now}},
        )
        off_n += r.modified_count
    h = await db.site_config.update_one(
        {"id": "homepage"},
        {"$set": {"hero.image": PREVIOUS_HERO_IMAGE, "updated_at": now}},
        upsert=False,
    )
    return (
        f"categories restored: {cat_n}/{len(PREVIOUS_CATEGORY_IMAGES)}, "
        f"offers restored: {off_n}/{len(PREVIOUS_OFFER_IMAGES_BY_TITLE)}, "
        f"hero restored: {bool(h.modified_count)}"
    )
