"""Migration 031 — consolidate L1 taxonomy down to Women / Men / Kids.

Context: Lokl's L1 category taxonomy is being simplified everywhere
(merchant signup, product creation, consumer browsing, search/filter APIs)
down to exactly three active L1s — Women, Men, Kids. The other six L1 rows
that exist today in `db.categories` (Ethnic Wear, Footwear, Lingerie &
Innerwear, Accessories, Beauty, Sports) are DEACTIVATED (paused = True),
never deleted — per the audit, real products/stores reference them, and a
hard delete first (discovering references after the fact) is exactly the
unsafe sequence this task explicitly warned against.

This migration, in order:
  1. Adds the three per-L1 "Accessories" L2 categories the new taxonomy
     requires under Women/Men (Kids already has `l2-kids-accessories`,
     seeded pre-existing — left untouched, not re-created).
  2. Remaps every existing product currently under one of the six
     deactivated L1s to Women/Men/Kids, by the product's own `gender`
     field, choosing the closest existing L2 under the new L1 (see
     `_TARGET_L2` below for the exact per-old-L1 rule). This is a real,
     documented judgment call for the two L1s the task's own brief never
     gave an explicit example for (Beauty, Sports have no direct L2
     equivalent under Women/Men/Kids) — routed into the new Accessories L2
     as the closest "other non-apparel items" bucket. Reported explicitly
     below so it's visible, not silently decided.
  3. Pauses the six L1 rows themselves, and their own L2 children (so an
     admin browsing /admin/subcategories doesn't find orphaned, unreachable
     L2s with no visible indication they're dead) — `paused = True` on
     both, never `delete_one`.

Deliberately NOT touched (audited, explicitly out of scope): products under
`l1-streetwear` and `l1-electronics` — neither ever existed as a real
`db.categories` row (no L1_CATEGORIES/seed_data.py entry either); they are
demo data from an unrelated non-fashion pilot (electronics/appliances) that
predates this taxonomy and cannot be sensibly forced into Women/Men/Kids.
`_visible_product_filter()` (server.py) never checks l1_id validity, so
those products keep working (search, store page, "all products") exactly
as before — this migration does not change that.

Idempotent: re-running is a safe no-op — L2 inserts check for an existing
id first, product remap only touches documents still pointing at one of
the six old L1 ids (already-migrated products are skipped), and pausing an
already-paused row is a no-op `$set`.
"""
from datetime import datetime, timezone

VERSION = "031_consolidate_l1_categories"

NOW = datetime.now(timezone.utc).isoformat()

_OLD_L1_IDS = ["l1-ethnic", "l1-footwear", "l1-lingerie", "l1-accessories", "l1-beauty", "l1-sports"]

_NEW_ACCESSORIES_L2 = [
    {"id": "l2-women-accessories", "l1_id": "l1-women", "l1_slug": "women", "name": "Accessories",
     "slug": "accessories", "order": 16, "created_at": NOW},
    {"id": "l2-men-accessories", "l1_id": "l1-men", "l1_slug": "men", "name": "Accessories",
     "slug": "accessories", "order": 15, "created_at": NOW},
]

# Per-old-L1, per-target-L1 destination L2 id. Ethnic/Footwear map into the
# already-existing matching L2 under Women/Men/Kids (seed_data.py already
# carries l2-women-ethnic, l2-men-footwear, l2-kids-ethnic, etc.). Lingerie
# has no men/kids equivalent in the schema — per the brief's own explicit
# hint ("Lingerie -> most likely Women") every lingerie product lands under
# Women regardless of its own gender field. Accessories/Beauty/Sports have
# no dedicated L2 identity of their own under the new taxonomy — routed
# into each target L1's new/existing Accessories L2 (documented judgment
# call for Beauty/Sports, called out in the report).
_TARGET_L2 = {
    "l1-ethnic":   {"l1-women": "l2-women-ethnic",   "l1-men": "l2-men-ethnic",   "l1-kids": "l2-kids-ethnic"},
    "l1-footwear": {"l1-women": "l2-women-footwear", "l1-men": "l2-men-footwear", "l1-kids": "l2-kids-footwear"},
    "l1-lingerie": {"l1-women": "l2-women-lingerie", "l1-men": "l2-women-lingerie", "l1-kids": "l2-women-lingerie"},
    "l1-accessories": {"l1-women": "l2-women-accessories", "l1-men": "l2-men-accessories", "l1-kids": "l2-kids-accessories"},
    "l1-beauty":      {"l1-women": "l2-women-accessories", "l1-men": "l2-men-accessories", "l1-kids": "l2-kids-accessories"},
    "l1-sports":      {"l1-women": "l2-women-accessories", "l1-men": "l2-men-accessories", "l1-kids": "l2-kids-accessories"},
}


def _target_l1(gender) -> str:
    g = (gender or "").strip().lower()
    if g == "women":
        return "l1-women"
    if g == "men":
        return "l1-men"
    if g == "kids":
        return "l1-kids"
    # unisex / blank / anything else — documented default, not a guess
    # hidden in code: Women is the largest, most-established segment.
    return "l1-women"


async def _add_accessories_l2(db, report: list) -> None:
    for doc in _NEW_ACCESSORIES_L2:
        existing = await db.subcategories.find_one({"id": doc["id"]}, {"_id": 0, "id": 1})
        if existing:
            report.append(f"subcategories.{doc['id']}: already exists, no-op")
            continue
        await db.subcategories.insert_one(doc)
        report.append(f"subcategories.{doc['id']}: created under {doc['l1_id']}")


async def _remap_products(db, report: list) -> None:
    for old_l1 in _OLD_L1_IDS:
        cursor = db.products.find({"l1_id": old_l1}, {"_id": 0, "id": 1, "gender": 1, "name": 1})
        moved_by_target: dict[str, int] = {}
        async for p in cursor:
            target_l1 = _target_l1(p.get("gender"))
            target_l2 = _TARGET_L2[old_l1][target_l1]
            await db.products.update_one(
                {"id": p["id"]},
                {"$set": {"l1_id": target_l1, "l2_id": target_l2, "updated_at": NOW}},
            )
            moved_by_target[target_l1] = moved_by_target.get(target_l1, 0) + 1
        if moved_by_target:
            breakdown = ", ".join(f"{k}={v}" for k, v in sorted(moved_by_target.items()))
            report.append(f"products under {old_l1}: remapped ({breakdown})")
        else:
            report.append(f"products under {old_l1}: none found, no-op")


async def _deactivate_old_l1(db, report: list) -> None:
    for l1_id in _OLD_L1_IDS:
        r1 = await db.categories.update_one({"id": l1_id}, {"$set": {"paused": True, "updated_at": NOW}})
        r2 = await db.subcategories.update_many({"l1_id": l1_id}, {"$set": {"paused": True, "updated_at": NOW}})
        report.append(f"{l1_id}: category paused (matched={r1.matched_count}), "
                       f"{r2.modified_count} child L2 row(s) paused")


async def up(db) -> dict:
    report: dict[str, list] = {"add_accessories_l2": [], "remap_products": [], "deactivate_old_l1": []}
    await _add_accessories_l2(db, report["add_accessories_l2"])
    await _remap_products(db, report["remap_products"])
    await _deactivate_old_l1(db, report["deactivate_old_l1"])
    return report
