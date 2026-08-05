"""Migration 010 — URGENT: replace the l1-lingerie homepage tile image.

The live `l1-lingerie` doc's `image` field was set (via the admin CMS, not
seed_data.py — an admin-uploaded Cloudinary asset, not one of our Unsplash
URLs) to a suggestive photo: a couple in underwear, shirtless man, woman in
bra/briefs, close physical contact. That's on the family-audience homepage
front screen via the For Her bento tile and must not stay live.

Unlike migration 009 (which only backfills EMPTY images, to avoid clobbering
deliberate admin customization), this migration unconditionally OVERWRITES
l1-lingerie's image — the current live value is confirmed inappropriate, so
"an admin already customized this" is not a reason to preserve it here.

Replacement is a neutral flat-lay (folded bras/underwear on fabric, no
people, no skin) — same URL now in seed_data.py's L1_CATEGORIES so fresh DBs
match. Verified HTTP 200 and visually reviewed before writing.
"""
VERSION = "010_fix_lingerie_tile_image"

NEW_URL = "https://images.unsplash.com/photo-1568441556126-f36ae0900180?w=600&q=80"


async def up(db) -> dict:
    before = await db.categories.find_one({"id": "l1-lingerie"}, {"_id": 0, "image": 1})
    if before is None:
        return {"status": "l1-lingerie doc not found — nothing to fix"}

    await db.categories.update_one({"id": "l1-lingerie"}, {"$set": {"image": NEW_URL}})

    after = await db.categories.find_one({"id": "l1-lingerie"}, {"_id": 0, "image": 1})
    return {
        "status": "overwritten",
        "previous_image": before.get("image"),
        "new_image": after.get("image"),
    }
