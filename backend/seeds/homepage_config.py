"""Homepage CMS default config seed.

Inserts (or refreshes via $setOnInsert) the `site_config` document used by
GET /api/site/homepage-config and the Admin CMS tab. Idempotent — running
multiple times will NOT clobber edits the admin has already published; new
sections introduced after launch are merged in by `_get_site_config()` in
server.py on first GET.

Usage:
    python -m seeds.run homepage_config
"""
from datetime import datetime, timezone


DEFAULT_HOMEPAGE_SECTIONS = [
    {"id": "hero",            "label": "Hero",                       "enabled": True, "rank": 10},
    {"id": "popular_in_city", "label": "Trending now",               "enabled": True, "rank": 20},
    {"id": "categories",      "label": "Shop by category",           "enabled": True, "rank": 30},
    {"id": "selling_fast",    "label": "Selling fast",               "enabled": True, "rank": 40},
    {"id": "offers",          "label": "Offers for you",             "enabled": True, "rank": 50},
    {"id": "recently_viewed", "label": "Recently added",             "enabled": True, "rank": 60},
    {"id": "stores",          "label": "Popular stores in Bhilai",   "enabled": True, "rank": 70},
    {"id": "customer_love",   "label": "Loved by Bhilai shoppers",   "enabled": True, "rank": 80},
]

DEFAULT_HERO = {
    "image": "https://customer-assets.emergentagent.com/job_bharat-fashion-os/artifacts/n1elwepz_ChatGPT%20Image%20May%2016%2C%202026%2C%2006_29_23%20PM.png",
    "eyebrow": "Serving Bhilai",
    "title_line1": "Delivered in minutes from",
    "title_line2": "stores next door.",
    "subtitle": "Hand-picked fashion from trusted Bhilai stores.",
    "cta_primary_label": "Shop Women",
    "cta_primary_link": "/c/women",
    "cta_secondary_label": "Shop Men",
    "cta_secondary_link": "/c/men",
    "show_stats": True,
    "show_usp_chips": True,
}


async def up(db):
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.site_config.find_one({"id": "homepage"})
    if existing:
        # First-boot-only: never touch a config that already exists.
        # Admin CMS edits (hero image, section order, etc.) must survive restarts.
        # _get_site_config() in server.py handles backfilling any new fields at
        # runtime on the first GET after a schema change.
        return "homepage config already exists — skipping (first-boot-only seed)"
    await db.site_config.insert_one({
        "id": "homepage",
        "sections": DEFAULT_HOMEPAGE_SECTIONS,
        "hero": DEFAULT_HERO,
        "created_at": now,
        "updated_at": now,
    })
    return "inserted homepage config (8 sections, hero, default text overrides)"
