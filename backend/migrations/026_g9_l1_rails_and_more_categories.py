"""Migration 026 — Phase G9: L1 store-card modules -> product rails.

G9 §3 replaces the L1 pages' old CMS-editorial store-card modules
(store_footwear/store_lingerie/store_ethnic — StoreSectionModule, banner +
real stores + admin-pinned cards) with automatic product rails
(l1_footwear_rail/l1_lingerie_rail/l1_ethnic_rail — L2ProductRailSection,
real L2 taxonomy, no CMS curation). Reusing the old ids for the new
content would leave a CMS admin reading "Footwear Store" for something
that no longer shows stores at all — the opposite of the scope clarity
G9 §5 asks for — so this migration retires the three old ids outright and
adds three new ones, rather than relabeling in place.

Also retitles `other_categories`'s admin-facing label to "More
Categories" (G9 §9 — same section id and component, renamed concept).

Same full-replace-list convention every prior section-list change in this
app has used (migrations 012/018/019/020/025) — the underlying render
logic for every OTHER id is untouched, only this list's ids/labels/ranks.
`store_section_overrides` documents already saved under l1_id=women/men/
kids are deliberately left in the database untouched (no destructive
cleanup) — nothing renders them anymore, they simply become inert; only
the two global (l1_id="global") override docs still matter going forward.
"""
from datetime import datetime, timezone

VERSION = "026_g9_l1_rails_and_more_categories"

# Mirrors DEFAULT_HOMEPAGE_SECTIONS in server.py exactly (id-for-id,
# rank-for-rank, label-for-label).
CANONICAL_SECTIONS = [
    {"id": "hero",              "label": "Hero",                        "enabled": True,  "rank": 20},
    {"id": "category_pills",    "label": "Shop by Category (marketplace, 3x3)", "enabled": True,  "rank": 25},
    {"id": "marketplace_offers","label": "Offers for you (marketplace)","enabled": True,  "rank": 30},
    {"id": "shop_by_category",  "label": "Shop by Category (L1)",       "enabled": True,  "rank": 25},
    {"id": "best_deals",        "label": "Best deals",                  "enabled": True,  "rank": 30},
    {"id": "under_499",         "label": "Picks for Every Budget",      "enabled": True,  "rank": 40},
    {"id": "stores_near_you",   "label": "Stores near you (marketplace)","enabled": True,  "rank": 50},
    {"id": "shop_by_store",     "label": "Stores near you (L1)",        "enabled": True,  "rank": 50},
    {"id": "l1_footwear_rail",  "label": "Footwear Picks (L1)",         "enabled": True,  "rank": 55},
    {"id": "l1_lingerie_rail",  "label": "Lingerie / Accessory Picks (L1)", "enabled": True,  "rank": 56},
    {"id": "global_store_ethnic","label": "Ethnic Stores (marketplace)","enabled": True,  "rank": 70},
    {"id": "merchant_cta",      "label": "Own a store",                 "enabled": True,  "rank": 80},
    {"id": "premium_picks",     "label": "Premium picks",               "enabled": True,  "rank": 70},
    {"id": "offers",            "label": "Offers for you (L1)",         "enabled": True,  "rank": 80},
    {"id": "global_store_footwear","label": "Footwear Stores (marketplace)","enabled": True, "rank": 100},
    {"id": "l1_ethnic_rail",    "label": "Ethnic Picks (L1)",           "enabled": True,  "rank": 90},
    {"id": "other_categories",  "label": "More Categories",             "enabled": True,  "rank": 95},
    {"id": "customer_love",     "label": "Loved by Bhilai shoppers",    "enabled": False, "rank": 210},
]


async def up(db) -> dict:
    report: dict = {}

    existing_sections = await db.site_config.find_one({"id": "homepage"}, {"_id": 0, "sections": 1})
    before_ids = sorted(s.get("id") for s in (existing_sections or {}).get("sections", []))
    await db.site_config.update_one(
        {"id": "homepage"},
        {"$set": {"sections": CANONICAL_SECTIONS}},
        upsert=True,
    )
    after_ids = sorted(s["id"] for s in CANONICAL_SECTIONS)
    report["sections_dropped"] = sorted(set(before_ids) - set(after_ids))
    report["sections_added"] = sorted(set(after_ids) - set(before_ids))

    orphaned = await db.store_section_overrides.count_documents(
        {"l1_id": {"$in": ["l1-women", "l1-men", "l1-kids"]}}
    ) if "store_section_overrides" in await db.list_collection_names() else 0
    report["orphaned_l1_store_overrides_left_untouched"] = orphaned

    return report
