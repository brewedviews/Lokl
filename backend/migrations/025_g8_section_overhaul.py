"""Migration 025 — Phase G8: section overhaul content updates.

Two independent, idempotent changes:

1. Seed one real hero slide each for Men (l1-men) and Kids (l1-kids) —
   before this, only Women had one (hero-women-welcome-001, seeded in
   017/G3/G6), so Men/Kids rendered no hero at all (graceful-empty, but
   not the "equivalent structure" G8 asks for). Images individually
   downloaded and visually inspected before being written here (same
   discipline as every prior content fix this session) — the Men image
   (photo-1617137968427-85924c800a22, a man in a navy suit) is the SAME
   asset already used elsewhere in this app as the Men L1's own category
   thumbnail (CategoryTileRow/category tiles) — reused, not a new asset.
   The Kids image (photo-1519689680058-324335c77eba) is a clean baby-
   clothing flat-lay (onesie, beanie, teddy bear, booties) — genuinely
   new to this codebase's image set (no existing kids flat-lay asset
   fit a wide hero crop as well), verified by download+visual inspection
   before use.

2. Refresh the PRE-EXISTING Women hero slide's copy (hero-women-welcome-001,
   seeded in 017/G3/G6, before the G7 global/L1 hero split existed) — it
   still carried the generic "Bhilai's own neighbourhood shopping app."
   headline verbatim, identical to the new global slide's own copy, so
   Women's L1 hero read as un-scoped. G8 §7 wants each L1 hero
   category-specific (Women: fashion/dresses/festive); this reuses
   l2-women-ethnic's own vetted image (a festive-wear photo, already
   individually verified and already used for the Ethnic category tile —
   same "reuse an already-verified asset" discipline as this migration's
   Men slide) and writes new headline/subheadline/highlight copy. Guarded
   on the OLD generic headline still being present, so this step is a
   no-op (not a silent overwrite) if an admin has since edited the slide.

3. Drop `shop_by_brand`, `shop_by_area`, and `trending` from
   site_config.homepage.sections — G8 removes these as MARKETPLACE HOME
   SECTIONS (they were marketplace-only since G7; G8's explicit target
   section order for "/" omits all three — Shop by Brand explicitly,
   Shop by Area/Trending by consistent omission across the brief's own
   order diagram and verification checklist). Same full-replace-list
   convention every prior section removal in this app has used (migrations
   012/018/019/020, and G6's just_in removal) — the underlying endpoints
   (/api/areas, AreasEditor, /stores?area=, /brands, BrandsEditor,
   /api/feed/home-products) are NOT touched, only the homepage section
   list. New ids this phase adds (marketplace_offers, global_store_ethnic,
   global_store_footwear, other_categories, store_footwear/lingerie's
   re-ranking) are handled by _get_site_config()'s own existing
   auto-append-missing-ids logic — no migration needed for pure additions,
   only for these removals.
"""
from datetime import datetime, timezone

VERSION = "025_g8_section_overhaul"

MEN_SLIDE_ID = "hero-men-welcome-001"
KIDS_SLIDE_ID = "hero-kids-welcome-001"

MEN_SLIDE = {
    "l1_id": "l1-men",
    "image": "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=1200&q=80",
    "eyebrow": "Serving Bhilai",
    "headline": "Fashion that fits Bhilai men.",
    "subheadline": "Shirts, jeans & ethnic wear from stores near you.",
    "highlight_text": "fits Bhilai men",
    "cta_link": "",
}

KIDS_SLIDE = {
    "l1_id": "l1-kids",
    "image": "https://images.unsplash.com/photo-1519689680058-324335c77eba?w=1200&q=80",
    "eyebrow": "Serving Bhilai",
    "headline": "Little styles, big smiles.",
    "subheadline": "Trusted kidswear from local Bhilai stores.",
    "highlight_text": "big smiles",
    "cta_link": "",
}

WOMEN_SLIDE_ID = "hero-women-welcome-001"
WOMEN_SLIDE_OLD_HEADLINE = "Bhilai's own neighbourhood shopping app."
WOMEN_SLIDE_UPDATE = {
    "image": "https://images.unsplash.com/photo-1597983073750-16f5ded1321f?w=1200&q=80",
    "headline": "Festive fashion for Bhilai women.",
    "subheadline": "Dresses, ethnic wear & more from stores near you.",
    "highlight_text": "Bhilai women",
}

# Mirrors DEFAULT_HOMEPAGE_SECTIONS in server.py exactly (id-for-id,
# rank-for-rank) minus the three removed ids — same full-replace approach
# migration 020 used for the Phase G2 removals.
CANONICAL_SECTIONS = [
    {"id": "hero",              "label": "Hero",                        "enabled": True,  "rank": 20},
    {"id": "category_pills",    "label": "Shop by Category (marketplace, 3x3)", "enabled": True,  "rank": 25},
    {"id": "marketplace_offers","label": "Offers for you (marketplace)","enabled": True,  "rank": 30},
    {"id": "shop_by_category",  "label": "Shop by Category (L1)",       "enabled": True,  "rank": 25},
    {"id": "best_deals",        "label": "Best deals",                  "enabled": True,  "rank": 30},
    {"id": "under_499",         "label": "Picks for Every Budget",      "enabled": True,  "rank": 40},
    {"id": "stores_near_you",   "label": "Stores near you (marketplace)","enabled": True,  "rank": 50},
    {"id": "shop_by_store",     "label": "Stores near you (L1)",        "enabled": True,  "rank": 50},
    {"id": "store_footwear",    "label": "Footwear Store",              "enabled": True,  "rank": 55},
    {"id": "store_lingerie",    "label": "Lingerie / Innerwear / Kids Store", "enabled": True,  "rank": 56},
    {"id": "global_store_ethnic","label": "Ethnic Stores (marketplace)","enabled": True,  "rank": 70},
    {"id": "merchant_cta",      "label": "Own a store",                 "enabled": True,  "rank": 80},
    {"id": "premium_picks",     "label": "Premium picks",               "enabled": True,  "rank": 70},
    {"id": "offers",            "label": "Offers for you (L1)",         "enabled": True,  "rank": 80},
    {"id": "global_store_footwear","label": "Footwear Stores (marketplace)","enabled": True, "rank": 100},
    {"id": "store_ethnic",      "label": "Ethnic Store",                "enabled": True,  "rank": 90},
    {"id": "other_categories",  "label": "Other Categories",            "enabled": True,  "rank": 95},
    {"id": "customer_love",     "label": "Loved by Bhilai shoppers",    "enabled": False, "rank": 210},
]


async def up(db) -> dict:
    report: dict = {}
    now = datetime.now(timezone.utc).isoformat()

    for slide_id, slide in ((MEN_SLIDE_ID, MEN_SLIDE), (KIDS_SLIDE_ID, KIDS_SLIDE)):
        existing = await db.hero_slides.find_one({"id": slide_id}, {"_id": 0})
        if existing:
            report[slide_id] = "already exists — nothing to do"
            continue
        await db.hero_slides.insert_one({
            "id": slide_id,
            "image_public_id": "",
            "active": True,
            "order": 1,
            "created_at": now,
            "updated_at": now,
            **slide,
        })
        report[slide_id] = "created"

    women_slide = await db.hero_slides.find_one({"id": WOMEN_SLIDE_ID}, {"_id": 0, "headline": 1})
    if women_slide and women_slide.get("headline") == WOMEN_SLIDE_OLD_HEADLINE:
        await db.hero_slides.update_one(
            {"id": WOMEN_SLIDE_ID},
            {"$set": {**WOMEN_SLIDE_UPDATE, "updated_at": now}},
        )
        report[WOMEN_SLIDE_ID] = "copy refreshed (was still the generic global headline)"
    else:
        report[WOMEN_SLIDE_ID] = "left untouched (already customized or missing)"

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

    return report
