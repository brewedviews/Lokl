"""Migration 022 — Phase G4: store_section_overrides collection.

Two things, same as migration 017's "index/schema setup + first real
content" combination:

1. A unique compound index on (l1_id, l2_id) — the same scoping key
   GET /categories/{l1_id}/stores?l2_id=... (stores_in_category() in
   server.py) already matches real stores on, so this is a DB-level
   guarantee that "Women's Footwear" and "Men's Footwear" (different
   l1_id) or "Women's Lingerie" and "Men's Inner Wear" (different l2_id)
   can never collide into the same override doc. Brand-new, empty
   collection — no pre-existing-duplicate risk migration 013 had to guard
   against, so the index is built directly.

2. Initial CMS content for the six L1/category combinations the redesign
   plan's Footwear/Ethnic/Lingerie-or-Innerwear Store sections cover:
   Women's Footwear/Ethnic/Lingerie and Men's Footwear/Ethnic/Inner Wear.
   `pinned_stores` here are CMS DISPLAY CARDS, not real merchants — they
   never touch db.stores/db.merchants/db.products (see this collection's
   own doc comment in server.py). Real store counts in every one of these
   six categories are 0 today (checked live, not assumed) — checked
   before writing this migration — so right now these pinned cards ARE
   the section's entire visible content; once real stores exist in a
   category, stores_in_category()'s results render first, automatically,
   with zero further admin action needed.

   Images are existing Unsplash URLs already used elsewhere in this
   codebase's own seed data (seed_data.py's L2 images, seeds/demo_stores.py's
   store banners) — no new external image source introduced. Banner_image
   is deliberately left blank on three of the six (Women's Ethnic, Men's
   Footwear, Men's Inner Wear) so both the "CMS banner configured" and
   "CMS banner absent -> falls back to the L2's own default image" paths
   are exercised by real seeded data, not just a manual test.

Idempotent: upserts by (l1_id, l2_id), only via $setOnInsert for the
content fields — an admin's real edit via the Store Sections CMS editor
is never overwritten by a later re-run of this migration (same
"seed once, never clobber a real edit" contract PRICE_BANDS_SEED/AREAS_SEED
use at boot).
"""
import uuid
from datetime import datetime, timezone

from pymongo import ASCENDING
from pymongo.errors import OperationFailure

VERSION = "022_store_section_overrides"

INDEX_NAME = "idx_store_section_overrides_l1_l2_unique"

_FOOTWEAR_BANNER = "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1200&q=80"
_LINGERIE_BANNER = "https://images.unsplash.com/photo-1571513722275-4b41940f54b8?w=1200&q=80"
_ETHNIC_BANNER = "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=1200&q=80"

_CARD_IMG_FOOTWEAR_1 = "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600&q=80"
_CARD_IMG_FOOTWEAR_2 = "https://images.unsplash.com/photo-1549298916-b41d501d3772?w=600&q=80"
_CARD_IMG_FOOTWEAR_3 = "https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=600&q=80"
_CARD_IMG_ETHNIC_1 = "https://images.unsplash.com/photo-1610189012906-4c0aa9b9781e?w=600&q=80"
_CARD_IMG_ETHNIC_2 = "https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=600&q=80"
_CARD_IMG_ETHNIC_3 = "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=600&q=80"
_CARD_IMG_LINGERIE_1 = "https://images.unsplash.com/photo-1571513722275-4b41940f54b8?w=600&q=80"
_CARD_IMG_LINGERIE_2 = "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=600&q=80"
_CARD_IMG_LINGERIE_3 = "https://images.unsplash.com/photo-1587560699334-cc4ff634909a?w=600&q=80"
_CARD_IMG_INNERWEAR_1 = "https://images.unsplash.com/photo-1640765937555-6f413ed1d936?w=600&q=80"
_CARD_IMG_INNERWEAR_2 = "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&q=80"
_CARD_IMG_INNERWEAR_3 = "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=600&q=80"


def _card(name, image, link):
    return {"id": f"psc-{uuid.uuid4().hex[:8]}", "name": name, "image": image, "link": link}


OVERRIDES = [
    {
        "l1_id": "l1-women", "l2_id": "l2-women-footwear",
        "banner_image": _FOOTWEAR_BANNER,
        "pinned_stores": [
            _card("Step & Sole", _CARD_IMG_FOOTWEAR_1, "/c/women/footwear"),
            _card("Comfort Walk Studio", _CARD_IMG_FOOTWEAR_2, "/c/women/footwear"),
            _card("Heel & Toe Collective", _CARD_IMG_FOOTWEAR_3, "/c/women/footwear"),
        ],
    },
    {
        "l1_id": "l1-women", "l2_id": "l2-women-ethnic",
        "banner_image": "",  # exercises the "no CMS override" fallback path
        "pinned_stores": [
            _card("Weaves of Bhilai", _CARD_IMG_ETHNIC_1, "/c/women/ethnic-wear"),
            _card("Threadline Ethnic", _CARD_IMG_ETHNIC_2, "/c/women/ethnic-wear"),
            _card("Zari & Zircon", _CARD_IMG_ETHNIC_3, "/c/women/ethnic-wear"),
        ],
    },
    {
        "l1_id": "l1-women", "l2_id": "l2-women-lingerie",
        "banner_image": _LINGERIE_BANNER,
        "pinned_stores": [
            _card("Soft Basics Co.", _CARD_IMG_LINGERIE_1, "/c/women/lingerie"),
            _card("Everyday Comfort", _CARD_IMG_LINGERIE_2, "/c/women/lingerie"),
            _card("Bloom Intimates", _CARD_IMG_LINGERIE_3, "/c/women/lingerie"),
        ],
    },
    {
        "l1_id": "l1-men", "l2_id": "l2-men-footwear",
        "banner_image": "",  # exercises the "no CMS override" fallback path
        "pinned_stores": [
            _card("Urban Sole", _CARD_IMG_FOOTWEAR_2, "/c/men/footwear"),
            _card("Stride Footwear", _CARD_IMG_FOOTWEAR_3, "/c/men/footwear"),
            _card("Groundwork Shoes", _CARD_IMG_FOOTWEAR_1, "/c/men/footwear"),
        ],
    },
    {
        "l1_id": "l1-men", "l2_id": "l2-men-ethnic",
        "banner_image": _ETHNIC_BANNER,
        "pinned_stores": [
            _card("Kurta House Bhilai", _CARD_IMG_ETHNIC_2, "/c/men/ethnic-wear"),
            _card("Nehru Collar Co.", _CARD_IMG_ETHNIC_3, "/c/men/ethnic-wear"),
            _card("Handloom Men", _CARD_IMG_ETHNIC_1, "/c/men/ethnic-wear"),
        ],
    },
    {
        "l1_id": "l1-men", "l2_id": "l2-men-innerwear",
        "banner_image": "",  # exercises the "no CMS override" fallback path
        "pinned_stores": [
            _card("Everyday Essentials", _CARD_IMG_INNERWEAR_1, "/c/men/innerwear"),
            _card("Comfort Fit Basics", _CARD_IMG_INNERWEAR_2, "/c/men/innerwear"),
            _card("Daily Wear Co.", _CARD_IMG_INNERWEAR_3, "/c/men/innerwear"),
        ],
    },
]


async def up(db) -> dict:
    report: dict = {"index": "", "seeded": [], "skipped_existing": []}

    existing_indexes = await db.store_section_overrides.index_information()
    if INDEX_NAME in existing_indexes:
        report["index"] = "already exists, no-op"
    else:
        try:
            await db.store_section_overrides.create_index(
                [("l1_id", ASCENDING), ("l2_id", ASCENDING)],
                unique=True, name=INDEX_NAME,
            )
            report["index"] = "created"
        except OperationFailure as e:
            report["index"] = f"FAILED ({e.code}: {str(e)[:160]})"

    now = datetime.now(timezone.utc).isoformat()
    for cfg in OVERRIDES:
        existing = await db.store_section_overrides.find_one(
            {"l1_id": cfg["l1_id"], "l2_id": cfg["l2_id"]}, {"_id": 0, "l1_id": 1},
        )
        if existing:
            report["skipped_existing"].append(f"{cfg['l1_id']}/{cfg['l2_id']}")
            continue
        await db.store_section_overrides.insert_one({
            "id": f"sso-{uuid.uuid4().hex[:8]}",
            "l1_id": cfg["l1_id"],
            "l2_id": cfg["l2_id"],
            "banner_image": cfg["banner_image"],
            "pinned_stores": cfg["pinned_stores"],
            "created_at": now,
            "updated_at": now,
        })
        report["seeded"].append(f"{cfg['l1_id']}/{cfg['l2_id']}")

    return report
