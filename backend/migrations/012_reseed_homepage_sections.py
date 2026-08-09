"""Migration 012 — reseed site_config.homepage.sections with the current
canonical homepage section list.

Context: HomeClient.tsx's merge logic previously let the LOCAL
DEFAULT_SECTIONS rank silently override whatever rank the DB had for any
section id it recognized — meaning the admin "Sections" CMS panel (already
built, already wired into the nav) had been editing a document that had
zero actual effect on the live homepage. That override has been fixed
(DB rank/enabled is now authoritative), which means whatever is currently
sitting in the live site_config.homepage.sections array becomes live for
the first time. On a long-running deployment that array is stale: it still
has ids from an old iteration (popular_in_city, stores, selling_fast,
recently_viewed) that no longer have a matching renderer in
HomeClient.tsx's sectionRenderers, and is missing every section shipped
since (just_in, best_deals, try_and_buy, for_her, for_him, meet_sellers,
merchant_cta, premium_picks, shop_by_area).

This migration does a full replace of `sections` with
server.py's DEFAULT_HOMEPAGE_SECTIONS (the current live order/enabled
state), so the admin CMS starts matching what customers already see
instead of a stale list full of dead ids. Full replace is safe here
specifically because no rank/enabled value in the existing document has
ever taken effect on the live site (per the bug above) — there is no
real admin customization to preserve.

Idempotent: always sets the same target list, safe to re-run (though the
runner tracks it and won't).
"""
VERSION = "012_reseed_homepage_sections"

CANONICAL_SECTIONS = [
    {"id": "category_pills", "label": "Category pills",           "enabled": True,  "rank": 10},
    {"id": "hero",           "label": "Hero",                     "enabled": True,  "rank": 20},
    {"id": "under_499",      "label": "Under ₹499",               "enabled": True,  "rank": 30},
    {"id": "meet_sellers",   "label": "Meet your sellers",        "enabled": True,  "rank": 40},
    {"id": "best_deals",     "label": "Best deals",               "enabled": True,  "rank": 50},
    {"id": "try_and_buy",    "label": "Try & Buy",                "enabled": True,  "rank": 60},
    {"id": "for_her",        "label": "For Her",                  "enabled": True,  "rank": 70},
    {"id": "for_him",        "label": "For Him",                  "enabled": True,  "rank": 72},
    {"id": "merchant_cta",   "label": "Open a store",             "enabled": True,  "rank": 80},
    {"id": "premium_picks",  "label": "Premium picks",            "enabled": True,  "rank": 90},
    {"id": "shop_by_area",   "label": "Shop by Area",             "enabled": True,  "rank": 100},
    {"id": "offers",         "label": "Offers for you",           "enabled": True,  "rank": 110},
    {"id": "just_in",        "label": "Just In",                  "enabled": False, "rank": 120},
    {"id": "trending",       "label": "Trending now",             "enabled": False, "rank": 130},
    {"id": "customer_love",  "label": "Loved by Bhilai shoppers", "enabled": False, "rank": 140},
]


async def up(db) -> dict:
    existing = await db.site_config.find_one({"id": "homepage"}, {"_id": 0, "sections": 1})
    before_ids = sorted(s.get("id") for s in (existing or {}).get("sections", []))

    await db.site_config.update_one(
        {"id": "homepage"},
        {"$set": {"sections": CANONICAL_SECTIONS}},
        upsert=True,
    )

    after_ids = sorted(s["id"] for s in CANONICAL_SECTIONS)
    dropped = sorted(set(before_ids) - set(after_ids))
    added = sorted(set(after_ids) - set(before_ids))
    return {
        "before_ids": before_ids,
        "after_ids": after_ids,
        "dropped_stale_ids": dropped,
        "added_ids": added,
    }
