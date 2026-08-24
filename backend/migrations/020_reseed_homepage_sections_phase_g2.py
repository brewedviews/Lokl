"""Migration 020 — reseed site_config.homepage.sections with Phase G2's
locked section order.

Context: same situation migrations 012/018/019 already handled — see
012's own docstring for the first time this reasoning was spelled out.
_get_site_config() only seeds a brand-new doc or auto-appends an id the
existing doc doesn't have yet; it never REMOVES an id already present.
Phase G2 drops five sections from the homepage outright: "Shops near
you" (meet_sellers), the standalone promotional "Browse everything on
Lokl" CTA strip (browse_all — NOT the separate inline "Browse all {L1}"
product grid on /c/[slug], which was never part of this ranked list and
is untouched), try_and_buy, for_her, and for_him. A DEFAULT_HOMEPAGE_SECTIONS
constant change alone won't retroactively strip these ids from the live
doc, so this does the same full-replace 012/018/019 already established
as the correct tool for this situation. No real admin customization is
expected to exist yet (this redesign has been under continuous,
coordinated development), so there's nothing to preserve beyond the
existing rank/enabled values, which are carried forward unchanged for
every id that survives.

Idempotent: always sets the same target list, safe to re-run (though the
runner tracks it and won't).
"""
VERSION = "020_reseed_homepage_sections_phase_g2"

CANONICAL_SECTIONS = [
    {"id": "category_pills",  "label": "Category pills",             "enabled": True,  "rank": 10},
    {"id": "hero",             "label": "Hero",                       "enabled": True,  "rank": 20},
    {"id": "shop_by_category", "label": "Shop by Category",           "enabled": True,  "rank": 25},
    {"id": "best_deals",       "label": "Best deals",                 "enabled": True,  "rank": 30},
    {"id": "under_499",        "label": "Shop by Price",              "enabled": True,  "rank": 40},
    {"id": "shop_by_store",    "label": "Shop by Store",              "enabled": True,  "rank": 50},
    {"id": "premium_picks",    "label": "Premium picks",              "enabled": True,  "rank": 60},
    {"id": "shop_by_area",     "label": "Shop by Area",               "enabled": True,  "rank": 70},
    {"id": "store_footwear",   "label": "Footwear Store",             "enabled": True,  "rank": 90},
    {"id": "store_ethnic",     "label": "Ethnic Store",                "enabled": True,  "rank": 100},
    {"id": "store_lingerie",   "label": "Lingerie / Innerwear Store", "enabled": True,  "rank": 110},

    {"id": "shop_by_brand", "label": "Shop by Brand",            "enabled": True,  "rank": 140},
    {"id": "merchant_cta",  "label": "Open a store",             "enabled": True,  "rank": 170},
    {"id": "offers",        "label": "Offers for you",           "enabled": True,  "rank": 180},
    {"id": "just_in",       "label": "Just In",                  "enabled": False, "rank": 190},
    {"id": "trending",      "label": "Trending now",             "enabled": False, "rank": 200},
    {"id": "customer_love", "label": "Loved by Bhilai shoppers", "enabled": False, "rank": 210},
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
