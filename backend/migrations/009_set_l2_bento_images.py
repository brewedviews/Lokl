"""Migration 009 — set L2 subcategory images for the For Her / For Him
homepage bento sections, and fix the l1-lingerie L1 image (dead link).

The boot-time taxonomy upsert (`server.py`, near `build_seed_docs()`) uses
`$setOnInsert` for `image` so admin-uploaded category art is never
overwritten on restart — but that also means it will NEVER backfill an
`image` onto a category/subcategory doc that already exists in a live DB.
seed_data.py now has real image URLs for these 9 L2s, but on any DB that was
seeded before this change, the live docs are stuck at "". Separately,
verification for this same bento surfaced that the L1 lingerie image already
live in seed_data.py (photo-1604176424472-17cd740f6974) 404s — replaced with
a verified neutral flat-lay. This migration is the one-time backfill/fix for
those already-live docs.

Idempotent + non-destructive: L2s are only touched when `image` is currently
missing or empty; the L1 lingerie fix only overwrites if the doc still has
the specific known-dead URL. Either way, an admin-set custom image (via
PUT /admin/{sub}categories/{id}) is left alone.
"""
VERSION = "009_set_l2_bento_images"

L2_IMAGES = {
    "l2-women-dresses": "https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?w=600&q=80",
    "l2-women-tops":    "https://images.unsplash.com/photo-1761117228880-df2425bd70da?w=600&q=80",
    "l2-women-bottoms": "https://images.unsplash.com/photo-1580651214613-f4692d6d138f?w=600&q=80",
    "l2-women-coords":  "https://images.unsplash.com/photo-1767077280564-6521b1487d83?w=600&q=80",
    "l2-men-tshirts":   "https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=600&q=80",
    "l2-men-jeans":     "https://images.unsplash.com/photo-1542272604-787c3835535d?w=600&q=80",
    "l2-men-shirts":    "https://images.unsplash.com/photo-1740711152088-88a009e877bb?w=600&q=80",
    "l2-men-formals":   "https://images.unsplash.com/photo-1618886614638-80e3c103d31a?w=600&q=80",
    "l2-men-innerwear": "https://images.unsplash.com/photo-1640765937555-6f413ed1d936?w=600&q=80",
}

L1_LINGERIE_DEAD_URL = "https://images.unsplash.com/photo-1604176424472-17cd740f6974?w=600&q=80"
L1_LINGERIE_FIX_URL = "https://images.unsplash.com/photo-1568441556126-f36ae0900180?w=600&q=80"


async def up(db) -> dict:
    report = {"updated": [], "skipped_has_image": [], "not_found": []}
    for l2_id, url in L2_IMAGES.items():
        doc = await db.subcategories.find_one({"id": l2_id}, {"_id": 0, "image": 1})
        if doc is None:
            report["not_found"].append(l2_id)
            continue
        if doc.get("image"):
            report["skipped_has_image"].append(f"{l2_id} (kept existing: {doc['image']})")
            continue
        await db.subcategories.update_one({"id": l2_id}, {"$set": {"image": url}})
        report["updated"].append(f"{l2_id} -> {url}")

    l1 = await db.categories.find_one({"id": "l1-lingerie"}, {"_id": 0, "image": 1})
    if l1 is None:
        report["not_found"].append("l1-lingerie")
    elif l1.get("image") == L1_LINGERIE_DEAD_URL or not l1.get("image"):
        await db.categories.update_one({"id": "l1-lingerie"}, {"$set": {"image": L1_LINGERIE_FIX_URL}})
        report["updated"].append(f"l1-lingerie -> {L1_LINGERIE_FIX_URL} (was dead link or empty)")
    else:
        report["skipped_has_image"].append(f"l1-lingerie (kept existing custom: {l1['image']})")

    return report
