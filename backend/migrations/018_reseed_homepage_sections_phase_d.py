"""Migration 018 — reseed site_config.homepage.sections with the redesign's
locked Phase D section order.

Context: server.py's DEFAULT_HOMEPAGE_SECTIONS constant only seeds a
brand-new site_config doc or auto-appends ids the existing doc doesn't
have yet (see _get_site_config()) — it never overwrites rank/enabled for
an id that's already present, by design (an admin's real customization
via the Sections CMS panel is supposed to win). That's exactly why
migration 012 had to do a full replace when the canonical order changed
last time, and the same situation applies again here: Phases A-C shipped
several new section ids (shop_by_category, gendered_stores, ...) that
auto-appended onto the END of whatever rank each phase's own
DEFAULT_HOMEPAGE_SECTIONS snapshot had at the time, rather than landing at
the position the finished, locked Phase D sequence actually calls for.
Phase C's "gendered_stores" id is also now dead code — Phase D split it
into three independently-ranked ids (store_footwear/store_ethnic/
store_lingerie) so Premium picks could sit between Ethnic and
Lingerie/Innerwear per the locked sequence — so the old id needs dropping,
not just outranking.

As with 012, this is a full replace, not a merge: no real admin
customization is expected to exist yet (this redesign has been under
active, coordinated development this same work stream), so there's
nothing to preserve — see 012's own docstring for the identical reasoning
the first time this situation came up.

Idempotent: always sets the same target list, safe to re-run (though the
runner tracks it and won't).
"""
VERSION = "018_reseed_homepage_sections_phase_d"

CANONICAL_SECTIONS = [
    {"id": "category_pills",  "label": "Category pills",             "enabled": True,  "rank": 10},
    {"id": "hero",             "label": "Hero",                       "enabled": True,  "rank": 20},
    {"id": "shop_by_category", "label": "Shop by Category",           "enabled": True,  "rank": 25},
    {"id": "best_deals",       "label": "Best deals",                 "enabled": True,  "rank": 30},
    {"id": "under_499",        "label": "Shop by Price",              "enabled": True,  "rank": 40},
    {"id": "shop_by_area",     "label": "Shop by Area",               "enabled": True,  "rank": 50},
    {"id": "meet_sellers",     "label": "Shops near you",             "enabled": True,  "rank": 60},
    {"id": "store_footwear",   "label": "Footwear Store",             "enabled": True,  "rank": 70},
    {"id": "store_ethnic",     "label": "Ethnic Store",                "enabled": True,  "rank": 80},
    {"id": "premium_picks",    "label": "Premium picks",              "enabled": True,  "rank": 90},
    {"id": "store_lingerie",   "label": "Lingerie / Innerwear Store", "enabled": True,  "rank": 100},
    {"id": "browse_all",       "label": "Browse All",                 "enabled": True,  "rank": 110},
    {"id": "try_and_buy",     "label": "Try & Buy",                "enabled": True,  "rank": 120},
    {"id": "shop_by_brand",   "label": "Shop by Brand",            "enabled": True,  "rank": 130},
    {"id": "for_her",         "label": "For Her",                  "enabled": True,  "rank": 140},
    {"id": "for_him",         "label": "For Him",                  "enabled": True,  "rank": 150},
    {"id": "merchant_cta",    "label": "Open a store",             "enabled": True,  "rank": 160},
    {"id": "offers",          "label": "Offers for you",           "enabled": True,  "rank": 170},
    {"id": "just_in",        "label": "Just In",                   "enabled": False, "rank": 180},
    {"id": "trending",       "label": "Trending now",              "enabled": False, "rank": 190},
    {"id": "customer_love",  "label": "Loved by Bhilai shoppers",  "enabled": False, "rank": 200},
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
