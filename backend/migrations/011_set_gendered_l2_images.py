"""Migration 011 — set images for the gendered Ethnic Wear / Footwear /
Lingerie L2s nested under Women and Men.

These 5 L2 docs (l2-women-ethnic, l2-women-footwear, l2-women-lingerie,
l2-men-ethnic, l2-men-footwear) already exist live — they power the Women
category page's "Ethnic Wear"/"Footwear" filter pills — but were never
tracked in seed_data.py until now, and their `image` field has always been
empty. The homepage For Her/For Him bento tiles now point at these instead
of the standalone l1-ethnic/l1-footwear/l1-lingerie categories (so each
gender gets its own image and its own filtered destination instead of both
grids sharing one L1's image). Without this backfill those 4 tiles would
render as blank placeholders.

Idempotent + non-destructive: only sets `image` where it's currently empty
— an admin-set custom image is left alone, same as migration 009.
"""
VERSION = "011_set_gendered_l2_images"

L2_IMAGES = {
    "l2-women-ethnic":   "https://images.unsplash.com/photo-1597983073750-16f5ded1321f?w=600&q=80",
    "l2-women-footwear": "https://images.unsplash.com/photo-1535043934128-cf0b28d52f95?w=600&q=80",
    "l2-women-lingerie": "https://images.unsplash.com/photo-1568441556126-f36ae0900180?w=600&q=80",
    "l2-men-ethnic":     "https://images.unsplash.com/photo-1701365676249-9d7ab5022dec?w=600&q=80",
    "l2-men-footwear":   "https://images.unsplash.com/photo-1668069226492-508742b03147?w=600&q=80",
}


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
    return report
