"""Migration 002 — backfill stores with GeoJSON `location` field + 2dsphere index.

Idempotent: skips docs that already have `location.type == "Point"`.
"""
from datetime import datetime, timezone
from pymongo.errors import OperationFailure

VERSION = "002_geo_index_migration"


async def up(db):
    report = {"backfilled": [], "indexes": [], "validation": []}
    cursor = db.stores.find({}, {"_id": 0, "id": 1, "lat": 1, "lng": 1, "location": 1})
    ok = 0; skipped = 0; failed = 0
    async for s in cursor:
        if (s.get("location") or {}).get("type") == "Point":
            skipped += 1
            continue
        lat = s.get("lat"); lng = s.get("lng")
        if lat is None or lng is None:
            failed += 1; continue
        try:
            lat_f = float(lat); lng_f = float(lng)
            if not (-90 <= lat_f <= 90) or not (-180 <= lng_f <= 180):
                failed += 1; continue
            await db.stores.update_one(
                {"id": s["id"]},
                {"$set": {"location": {"type": "Point", "coordinates": [lng_f, lat_f]}}},
            )
            ok += 1
        except Exception:
            failed += 1
    report["backfilled"].append(f"stores: {ok} converted, {skipped} already had GeoJSON, {failed} failed (missing/invalid coords)")

    # 2dsphere index — idempotent via index_information check
    existing = await db.stores.index_information()
    if "idx_stores_location_2dsphere" not in existing:
        try:
            await db.stores.create_index(
                [("location", "2dsphere")],
                name="idx_stores_location_2dsphere",
                background=True,
            )
            report["indexes"].append("stores.idx_stores_location_2dsphere: created")
        except OperationFailure as e:
            report["indexes"].append(f"stores.idx_stores_location_2dsphere: {e}")
    else:
        report["indexes"].append("stores.idx_stores_location_2dsphere: already present")

    # delivery_config uniqueness
    dc_existing = await db.delivery_config.index_information()
    if "idx_delivery_config_city_slug" not in dc_existing:
        await db.delivery_config.create_index("city_slug", unique=True, name="idx_delivery_config_city_slug")
        report["indexes"].append("delivery_config.idx_delivery_config_city_slug: created")

    # Decision: NO product 2dsphere — products inherit location from their store.
    # Discovery flows through store $geoNear → product $lookup (see routes/geo.py).
    report["validation"].append("products: no 2dsphere index (location inherited from store)")
    return report
