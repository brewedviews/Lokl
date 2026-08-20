"""Migration 015 — bidirectional Shopify inventory sync indexes.

Two new collections, both introduced by the outbound/inbound inventory
sync build (see server.py's _sync_remote_inventory, _sync_shopify_delta,
and the /webhooks/shopify/inventory endpoint):

  - remote_inventory_map: reverse lookup an inbound webhook needs — given
    a source platform's own variant identifier (Shopify: an inventory item
    gid), which (merchant_id, product_id, size) does it correspond to.
    Unique on (provider, remote_variant_id) since one source-platform
    variant maps to exactly one Lokl (product, size) pair.

  - shopify_webhook_events: idempotency store for inbound webhook delivery
    (Shopify retries on anything short of a 200). Deliberately a SEPARATE
    collection from the existing `webhook_events` (Razorpay) — that
    collection's unique index is on `razorpay_event_id` with no sparse/
    partial filter, so inserting Shopify-shaped docs into it (which have
    no razorpay_event_id field) would collide on the shared implicit null
    after the very first insert. New collection, new field name, no
    landmine.

Follows migration 014's pattern: individually error-isolated
_ensure_index/_ensure_unique_index, idempotent, safe to re-run.
"""
from pymongo import ASCENDING
from pymongo.errors import OperationFailure

VERSION = "015_shopify_inventory_sync"


async def _index_exists(coll, name: str) -> bool:
    existing = await coll.index_information()
    return name in existing


async def _ensure_index(coll, keys, name: str, report: list, **kwargs) -> None:
    try:
        if await _index_exists(coll, name):
            report.append(f"{coll.name}.{name}: already exists, no-op")
            return
        await coll.create_index(keys, name=name, background=True, **kwargs)
        report.append(f"{coll.name}.{name}: created")
    except OperationFailure as e:
        report.append(f"{coll.name}.{name}: FAILED ({e.code}: {str(e)[:160]})")
    except Exception as e:  # pragma: no cover — defensive
        report.append(f"{coll.name}.{name}: FAILED (unexpected {type(e).__name__}: {str(e)[:160]})")


async def _find_duplicate_values(coll, fields: list[str]) -> list[dict]:
    try:
        group_id = {f: f"${f}" for f in fields}
        return await coll.aggregate([
            {"$group": {"_id": group_id, "count": {"$sum": 1}}},
            {"$match": {"count": {"$gt": 1}}},
        ]).to_list(200)
    except Exception as e:
        return [{"_id": f"<duplicate-check itself failed: {e}>", "count": 999}]


async def _ensure_unique_index(coll, fields: list[str], name: str, report: list) -> None:
    if await _index_exists(coll, name):
        report.append(f"{coll.name}.{name}: already exists, no-op")
        return
    dupes = await _find_duplicate_values(coll, fields)
    if dupes:
        preview = ", ".join(f"{d['_id']!r}×{d['count']}" for d in dupes[:20])
        report.append(f"{coll.name}.{name}: DUPLICATE values found — skipping unique build. {preview}")
        await _ensure_index(coll, [(f, ASCENDING) for f in fields], name, report)
        return
    try:
        await coll.create_index([(f, ASCENDING) for f in fields], unique=True, name=name, background=True)
        report.append(f"{coll.name}.{name}: created (unique, no duplicates found)")
    except OperationFailure as e:
        report.append(f"{coll.name}.{name}: unique build FAILED ({e.code}: {str(e)[:160]}) — falling back to non-unique")
        await _ensure_index(coll, [(f, ASCENDING) for f in fields], name, report)


async def up(db) -> dict:
    report: list[str] = []

    await _ensure_unique_index(
        db.remote_inventory_map, ["provider", "remote_variant_id"],
        "idx_remote_inventory_map_provider_variant", report,
    )
    await _ensure_index(
        db.remote_inventory_map, [("merchant_id", ASCENDING), ("product_id", ASCENDING)],
        "idx_remote_inventory_map_merchant_product", report,
    )

    await _ensure_unique_index(
        db.shopify_webhook_events, ["webhook_id"],
        "idx_shopify_webhook_events_id_unique", report,
    )

    # Every inbound webhook delivery looks a merchant up by (provider,
    # shop_domain) — not unique (a merchant could reconnect and get a new
    # integration doc for the same shop in edge cases), just an access-path
    # index.
    await _ensure_index(
        db.merchant_integrations, [("provider", ASCENDING), ("shop_domain", ASCENDING)],
        "idx_merchant_integrations_provider_shop", report,
    )

    return {"indexes": report}
