"""Migration 023 — Phase G6: homepage refinement content updates.

Bundles four independent, idempotent content changes, each following an
existing precedent elsewhere in this migrations directory rather than
inventing a new pattern:

1. Hero copy — targeted $set on the one live Women hero slide
   (hero-women-welcome-001), same "known id, known fields" shape
   migration 021 already used for this exact document.

2. Drop `just_in` from site_config.homepage.sections — full-replace of
   the sections list, same pattern migration 020 used to remove five
   sections outright (not just disable them) for Phase G2. `just_in` was
   already enabled:false everywhere; this removes the id itself, since
   the JustInSection component/route no longer exist after G6.

3. Backfill empty `image` on six Kids subcategories — checked live in
   Mongo before writing this: every Kids L2 has image="" today, unlike
   Women/Men (already populated). Guarded per-doc — only sets `image`
   where it's currently empty, so a real admin edit is never clobbered
   (same "$set only, never retroactive-overwrite" contract PRICE_BANDS_
   SEED/AREAS_SEED use at boot). Needed for G6's newly-activated Kids
   Shop by Category (girls/boys/infant) and the three Kids Store modules
   below (footwear/ethnic/accessories, used as their banner fallback
   when no CMS override banner is set).

4. Seed three initial Kids store_section_overrides docs (footwear/ethnic/
   accessories) — same insert-if-not-exists shape migration 022 used to
   seed the original Women/Men content, real launch content rather than
   leaving Kids' three new modules blank until an admin manually
   configures them.

All image URLs below were downloaded and visually inspected before being
written here (same discipline the Bloom-Intimates content-mismatch fix
used) — not assumed correct just because the URL returns 200. One
honest gap, noted rather than papered over: no verified real photo of a
child in actual Indian ethnic wear (kurta/lehenga) was found during this
search — the "ethnic" slot's seeded image instead shows a child in smart/
occasion wear, and its `display_title` is deliberately set to "Kids
Occasion Wear" (using the same G6 display_title flexibility that makes
this whole model editorial) rather than mislabeling it "Ethnic Stores"
against imagery that doesn't actually show ethnic wear. An admin can
swap in a better-matched photo and title later without any code change.
"""
import uuid
from datetime import datetime, timezone

VERSION = "023_g6_homepage_refinement"

# ---- 1. Hero copy ----------------------------------------------------
HERO_SLIDE_ID = "hero-women-welcome-001"
HERO_HEADLINE = "Bhilai's own neighbourhood shopping app."
HERO_SUBHEADLINE = "Shop from trusted stores around you."
HERO_HIGHLIGHT = "neighbourhood shopping app"

# ---- 2. Homepage sections (just_in dropped) ---------------------------
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
    {"id": "trending",      "label": "Trending now",             "enabled": False, "rank": 200},
    {"id": "customer_love", "label": "Loved by Bhilai shoppers", "enabled": False, "rank": 210},
]

# ---- 3. Kids subcategory image backfill --------------------------------
# CORRECTION (caught before shipping, during this migration's own
# verification pass): the first version of this file had footwear and
# accessories SWAPPED (1622260614153 is a green camping backpack, not a
# child; 1571210862729 is a child jumping in sneakers, not a backpack) and
# the "ethnic" slot pointed at a photo of four adult men on a mountain —
# all three caught by re-downloading each exact URL individually and
# looking at it again, not trusted from the original batch review. No
# real Indian-ethnic-wear photo of a child was found in this search — see
# this file's own docstring for why "ethnic"'s seeded content is honestly
# titled "Kids Occasion Wear" instead.
KIDS_L2_IMAGES = {
    "l2-kids-girls":       "https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?w=600&q=80",
    "l2-kids-boys":        "https://images.unsplash.com/photo-1596870230751-ebdfce98ec42?w=600&q=80",
    "l2-kids-infant":      "https://images.unsplash.com/photo-1522771930-78848d9293e8?w=600&q=80",
    "l2-kids-footwear":    "https://images.unsplash.com/photo-1571210862729-78a52d3779a2?w=600&q=80",
    "l2-kids-ethnic":      "https://images.unsplash.com/photo-1519238359922-989348752efb?w=600&q=80",
    "l2-kids-accessories": "https://images.unsplash.com/photo-1503919545889-aef636e10ad4?w=600&q=80",
}

# ---- 4. Kids store_section_overrides seed ------------------------------
_FOOTWEAR_BANNER_KIDS = "https://images.unsplash.com/photo-1571210862729-78a52d3779a2?w=1200&q=80"
_ETHNIC_BANNER_KIDS = "https://images.unsplash.com/photo-1519238359922-989348752efb?w=1200&q=80"
_ACCESSORIES_BANNER_KIDS = "https://images.unsplash.com/photo-1503919545889-aef636e10ad4?w=1200&q=80"


def _card(name, image, link):
    return {"id": f"psc-{uuid.uuid4().hex[:8]}", "name": name, "image": image, "link": link}


KIDS_OVERRIDES = [
    {
        "l1_id": "l1-kids", "l2_id": "l2-kids-footwear",
        "display_title": "",  # blank -> frontend falls back to "Footwear Stores", which matches this imagery
        "mode": "real_plus_editorial",
        "banner_image": _FOOTWEAR_BANNER_KIDS,
        "pinned_stores": [
            _card("Tiny Steps Footwear", "https://images.unsplash.com/photo-1503919545889-aef636e10ad4?w=600&q=80", "/c/kids/footwear"),
            _card("Little Soles Co.", "https://images.unsplash.com/photo-1571210862729-78a52d3779a2?w=600&q=80", "/c/kids/footwear"),
        ],
    },
    {
        "l1_id": "l1-kids", "l2_id": "l2-kids-ethnic",
        # See this migration's own docstring — honestly retitled rather
        # than mislabeled "Ethnic Stores" against imagery that isn't
        # actually ethnic wear.
        "display_title": "Kids Occasion Wear",
        "mode": "real_plus_editorial",
        "banner_image": _ETHNIC_BANNER_KIDS,
        "pinned_stores": [
            _card("Smart Kids Co.", "https://images.unsplash.com/photo-1519238359922-989348752efb?w=600&q=80", "/c/kids/ethnic"),
            _card("Little Occasions", "https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?w=600&q=80", "/c/kids/ethnic"),
        ],
    },
    {
        "l1_id": "l1-kids", "l2_id": "l2-kids-accessories",
        "display_title": "",  # blank -> frontend falls back to "Accessories Stores", matches
        "mode": "real_plus_editorial",
        "banner_image": _ACCESSORIES_BANNER_KIDS,
        "pinned_stores": [
            _card("Little Explorers", "https://images.unsplash.com/photo-1503919545889-aef636e10ad4?w=600&q=80", "/c/kids/accessories"),
            _card("Pack & Go Kids", "https://images.unsplash.com/photo-1622260614153-03223fb72052?w=600&q=80", "/c/kids/accessories"),
        ],
    },
]


async def up(db) -> dict:
    report: dict = {}

    # 1. Hero copy
    hero_existing = await db.hero_slides.find_one({"id": HERO_SLIDE_ID}, {"_id": 0})
    if hero_existing:
        await db.hero_slides.update_one(
            {"id": HERO_SLIDE_ID},
            {"$set": {"headline": HERO_HEADLINE, "subheadline": HERO_SUBHEADLINE, "highlight_text": HERO_HIGHLIGHT}},
        )
        report["hero"] = "updated"
    else:
        report["hero"] = f"{HERO_SLIDE_ID} not found — nothing to update"

    # 2. Homepage sections (drop just_in)
    existing_sections = await db.site_config.find_one({"id": "homepage"}, {"_id": 0, "sections": 1})
    before_ids = sorted(s.get("id") for s in (existing_sections or {}).get("sections", []))
    await db.site_config.update_one(
        {"id": "homepage"},
        {"$set": {"sections": CANONICAL_SECTIONS}},
        upsert=True,
    )
    after_ids = sorted(s["id"] for s in CANONICAL_SECTIONS)
    report["sections_dropped"] = sorted(set(before_ids) - set(after_ids))

    # 3. Kids subcategory image backfill (only where currently empty)
    backfilled = []
    for l2_id, image in KIDS_L2_IMAGES.items():
        r = await db.subcategories.update_one(
            {"id": l2_id, "$or": [{"image": ""}, {"image": {"$exists": False}}]},
            {"$set": {"image": image}},
        )
        if r.modified_count:
            backfilled.append(l2_id)
    report["kids_images_backfilled"] = backfilled

    # 4. Kids store_section_overrides seed (insert-if-not-exists)
    now = datetime.now(timezone.utc).isoformat()
    seeded = []
    skipped = []
    for cfg in KIDS_OVERRIDES:
        existing = await db.store_section_overrides.find_one(
            {"l1_id": cfg["l1_id"], "l2_id": cfg["l2_id"]}, {"_id": 0, "l1_id": 1},
        )
        if existing:
            skipped.append(f"{cfg['l1_id']}/{cfg['l2_id']}")
            continue
        await db.store_section_overrides.insert_one({
            "id": f"sso-{uuid.uuid4().hex[:8]}",
            "l1_id": cfg["l1_id"],
            "l2_id": cfg["l2_id"],
            "display_title": cfg["display_title"],
            "mode": cfg["mode"],
            "banner_image": cfg["banner_image"],
            "pinned_stores": cfg["pinned_stores"],
            "created_at": now,
            "updated_at": now,
        })
        seeded.append(f"{cfg['l1_id']}/{cfg['l2_id']}")
    report["kids_overrides_seeded"] = seeded
    report["kids_overrides_skipped_existing"] = skipped

    return report
