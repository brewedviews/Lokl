"""Migration 016 — price_bands: overlapping "Under X" scheme (redesign
Phase A).

PRICE_BANDS_SEED changed from the old mutually-exclusive tiers
(<499 / 499-1499 / >=1500, labeled Under ₹499 / Most Loved / Premium) to
three overlapping thresholds (<499 / <999 / <1499, labeled Under ₹499 /
Under ₹999 / Under ₹1,499). `id` values were deliberately kept unchanged
(band-under-499 / band-most-loved / band-premium) specifically so the
existing boot-time upsert (server.py's startup_seed, matches by `id`,
$setOnInsert-only for `image`) carries every band's real admin-uploaded
image forward automatically with zero migration needed for slug/label —
this migration exists for exactly ONE thing that upsert can't do:
explicitly CLEAR an image whose old meaning no longer matches its new
label.

  - band-under-499: threshold is IDENTICAL before and after (<499 both
    times) — its image needs no action at all, real or otherwise.
  - band-most-loved: image carries forward as-is. Its old "Most Loved"
    curation concept (a deliberately-chosen mid-range product photo) is
    gone, replaced by a plain "Under ₹999" ceiling — the photo may still
    be a perfectly reasonable representative image, so it's NOT cleared
    here, just flagged: an admin should review whether it still reads
    correctly under the new label.
  - band-premium: image is UNCONDITIONALLY CLEARED here. Its old
    "Premium" framing (a deliberately expensive/aspirational product
    photo) is the OPPOSITE of the new "Under ₹1,499" budget-ceiling
    framing — carrying it forward silently would show a
    premium-positioned photo on a tile that says "under this price",
    which is actively misleading, not just stale. Clearing it lets
    feed_price_bento()'s existing fallback (cheapest visible product in
    that band, or a neutral placeholder if none) take over until an
    admin uploads a real replacement via PriceBandsEditor.
"""
VERSION = "016_price_bands_overlapping_bands"


async def up(db) -> dict:
    before = await db.price_bands.find_one({"id": "band-premium"}, {"_id": 0, "image": 1})
    if before is None:
        return {"status": "band-premium doc not found — nothing to clear"}

    previous_image = before.get("image") or ""
    if not previous_image:
        return {"status": "band-premium already has no image — nothing to clear"}

    await db.price_bands.update_one({"id": "band-premium"}, {"$set": {"image": ""}})
    return {
        "status": "cleared",
        "band": "band-premium (now slug=under-1499, label='Under ₹1,499')",
        "previous_image_cleared": previous_image,
        "note": "band-most-loved's image was deliberately left as-is — flagged for admin review, not auto-cleared. See this migration's module docstring.",
    }
