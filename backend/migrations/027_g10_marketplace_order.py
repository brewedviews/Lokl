"""Migration 027 — Phase G10: marketplace section-order correction.

G10 §1 explicitly requires Ethnic Stores to render BEFORE Stores Near You
on the Marketplace, and Premium Picks to render AFTER Own a Store — both
the opposite of what G8/G9 shipped. Confirmed live (GET /api/site/
homepage-config) before writing this migration, not assumed from a prior
report. Only rank VALUES change here — no ids added or removed, no
renderer/component changes, L1's own section sequence is unaffected (see
DEFAULT_HOMEPAGE_SECTIONS' own comment in server.py for the exact
rank-selection reasoning that keeps both surfaces' orderings valid
simultaneously for the three shared ids: best_deals/under_499/
premium_picks).

Same full-replace-list convention every prior section-list change in this
app has used (migrations 020/025/026).
"""
from datetime import datetime, timezone

VERSION = "027_g10_marketplace_order"

# Mirrors DEFAULT_HOMEPAGE_SECTIONS in server.py exactly (id-for-id,
# rank-for-rank, label-for-label).
CANONICAL_SECTIONS = [
    {"id": "hero",              "label": "Hero",                        "enabled": True,  "rank": 10},
    {"id": "category_pills",    "label": "Shop by Category (marketplace, 3x3)", "enabled": True,  "rank": 20},
    {"id": "shop_by_category",  "label": "Shop by Category (L1)",       "enabled": True,  "rank": 20},
    {"id": "marketplace_offers","label": "Offers for you (marketplace)","enabled": True,  "rank": 30},
    {"id": "best_deals",        "label": "Best deals",                  "enabled": True,  "rank": 40},
    {"id": "under_499",         "label": "Picks for Every Budget",      "enabled": True,  "rank": 50},
    {"id": "global_store_ethnic","label": "Ethnic Stores (marketplace)","enabled": True,  "rank": 60},
    {"id": "shop_by_store",     "label": "Stores near you (L1)",        "enabled": True,  "rank": 60},
    {"id": "stores_near_you",   "label": "Stores near you (marketplace)","enabled": True,  "rank": 70},
    {"id": "l1_footwear_rail",  "label": "Footwear Picks (L1)",         "enabled": True,  "rank": 65},
    {"id": "l1_lingerie_rail",  "label": "Lingerie / Accessory Picks (L1)", "enabled": True,  "rank": 66},
    {"id": "merchant_cta",      "label": "Own a store",                 "enabled": True,  "rank": 80},
    {"id": "premium_picks",     "label": "Premium picks",               "enabled": True,  "rank": 90},
    {"id": "offers",            "label": "Offers for you (L1)",         "enabled": True,  "rank": 95},
    {"id": "global_store_footwear","label": "Footwear Stores (marketplace)","enabled": True, "rank": 100},
    {"id": "l1_ethnic_rail",    "label": "Ethnic Picks (L1)",           "enabled": True,  "rank": 105},
    {"id": "other_categories",  "label": "More Categories",             "enabled": True,  "rank": 110},
    {"id": "customer_love",     "label": "Loved by Bhilai shoppers",    "enabled": False, "rank": 210},
]


async def up(db) -> dict:
    report: dict = {}

    existing_sections = await db.site_config.find_one({"id": "homepage"}, {"_id": 0, "sections": 1})
    before = {s.get("id"): s.get("rank") for s in (existing_sections or {}).get("sections", [])}
    await db.site_config.update_one(
        {"id": "homepage"},
        {"$set": {"sections": CANONICAL_SECTIONS}},
        upsert=True,
    )
    after = {s["id"]: s["rank"] for s in CANONICAL_SECTIONS}
    report["rank_changes"] = {
        sid: {"before": before.get(sid), "after": rank}
        for sid, rank in after.items()
        if before.get(sid) != rank
    }
    report["ids_dropped"] = sorted(set(before) - set(after))
    report["ids_added"] = sorted(set(after) - set(before))

    return report
