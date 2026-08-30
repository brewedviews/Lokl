"""Migration 030 — backfill `discount_percent` on existing products + index.

Context: offer-led product discovery (min_discount/max_discount campaign
filtering, GET /products & /products/all) needs a real, queryable
`discount_percent` field on every product. server.py's
`_calculate_discount_percent()` is now the single canonical place this gets
computed going forward (every create/update/bulk path already calls it —
see _create_product_for_merchant, _insert_bulk_product,
_apply_product_update, quick_update_product) — but every product that
existed BEFORE that helper shipped has no `discount_percent` field at all,
which would silently exclude it from every `min_discount` filter and the
`sort=discount` option.

This migration does two things, mirroring migration 013's own idiom
(idempotent, individually error-isolated, named indexes, a `report` list
returned rather than raised exceptions):
  1. Backfills `discount_percent` on every product missing it (or whose
     stored value doesn't match what mrp/price currently imply — covers a
     product edited by a direct DB write, or before this migration ships,
     between deploys).
  2. Adds `idx_products_discount_percent`, mirroring the existing
     `idx_products_price` index exactly (same ascending, same style) —
     needed for `min_discount`/`max_discount` range queries.

Per project convention (confirmed: no existing migration imports from
server.py — it's a heavyweight FastAPI module with side effects at import
time, and migrations are meant to be self-contained scripts), the formula
is duplicated here rather than imported. It is intentionally the SAME
trivial, stable formula as `_calculate_discount_percent` in server.py —
floored, deterministic, 0 whenever mrp/price is missing or mrp does not
exceed price (covers every combination the audit called out: missing MRP,
missing price, MRP <= price, null values). If the rounding rule in
server.py's helper is ever deliberately changed, this migration's copy
would need a matching one-off re-run — an acceptable, rare cost for a
one-shot backfill script.

Idempotent: recomputing the same mrp/price always yields the same
discount_percent, so re-running this migration is always a safe no-op for
already-correct documents (only genuinely stale/missing values get
written) — no separate "already ran" tracking needed beyond the runner's
own applied-versions collection.
"""
from pymongo import ASCENDING
from pymongo.errors import OperationFailure

VERSION = "030_discount_percent_backfill_and_index"


def _calculate_discount_percent(mrp, price) -> int:
    """MUST stay identical to server.py's `_calculate_discount_percent`."""
    if not mrp or not price or mrp <= price:
        return 0
    try:
        return int((float(mrp) - float(price)) / float(mrp) * 100)
    except (TypeError, ValueError):
        return 0


async def _backfill_discount_percent(db, report: list) -> None:
    try:
        cursor = db.products.find({}, {"_id": 0, "id": 1, "mrp": 1, "price": 1, "discount_percent": 1})
        total, updated = 0, 0
        async for p in cursor:
            total += 1
            correct = _calculate_discount_percent(p.get("mrp"), p.get("price"))
            if p.get("discount_percent") != correct:
                await db.products.update_one({"id": p["id"]}, {"$set": {"discount_percent": correct}})
                updated += 1
        report.append(f"products.discount_percent backfill: {updated}/{total} document(s) updated")
    except Exception as e:  # pragma: no cover — defensive, see migration 013's own rationale
        report.append(f"products.discount_percent backfill: FAILED (unexpected {type(e).__name__}: {str(e)[:160]})")


async def _ensure_index(coll, keys, name: str, report: list, **kwargs) -> None:
    """Same idempotent, error-isolated pattern as migration 013's own
    _ensure_index — never raises, so a failure here can't block this
    migration's backfill (already applied above) or any migration queued
    after it."""
    try:
        existing = await coll.index_information()
        if name in existing:
            report.append(f"{coll.name}.{name}: already exists, no-op")
            return
        await coll.create_index(keys, name=name, background=True, **kwargs)
        report.append(f"{coll.name}.{name}: created")
    except OperationFailure as e:
        report.append(f"{coll.name}.{name}: FAILED ({e.code}: {str(e)[:160]})")
    except Exception as e:  # pragma: no cover
        report.append(f"{coll.name}.{name}: FAILED (unexpected {type(e).__name__}: {str(e)[:160]})")


async def up(db) -> dict:
    report: list[str] = []
    await _backfill_discount_percent(db, report)
    await _ensure_index(db.products, [("discount_percent", ASCENDING)], "idx_products_discount_percent", report)
    return {"discount_percent": report}
