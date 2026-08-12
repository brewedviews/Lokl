"""Migration 014 — db.riders indexes.

Phase 1 of the rider delivery platform (replacing WhatsApp/SMS coordination
with an in-app PWA — see Commit 1's shared leg-transition helpers). This
migration creates the structural indexes for the new `riders` collection
introduced in Commit 2:

  - riders.id (unique) — every rider-scoped lookup/update in server.py
    (admin_update_rider, the future rider order endpoints in Commit 3) is
    `find_one({"id": rid})` / `find_one_and_update({"id": rid}, ...)`.
  - riders.phone (unique) — a phone maps to exactly ONE rider; this is what
    rider_request_otp/rider_verify_otp/rider_update_status key off of
    (`find_one({"phone": phone, ...})`), and what admin_create_rider's
    duplicate-phone check relies on being enforced at the DB level too, not
    just the pre-insert `find_one` (same read-then-write race the rest of
    this codebase accepts — no Mongo transactions anywhere — a unique index
    is the actual backstop).

The `rider_otps` collection (OTP TTL store, ephemeral) is intentionally NOT
handled here — it follows the same lightweight try/except-in-startup_seed()
pattern as `customer_otps`/`merchant_login_otps` (see server.py's
startup_seed), not the formal migrations/ path. `riders` is a durable
structural collection, matching why products/stores indexes (migration 013)
went through migrations/ instead.

SAFETY: follows migration 013's pattern exactly — every index creation is
individually try/excepted via `_ensure_index()` (never raises), and the
`id`/`phone` unique builds go through `_ensure_unique_index()` first, which
checks for existing duplicate values before attempting a unique build (falls
back to a non-unique index + reports the offending values instead of
crashing the whole migration batch — see 013's docstring for the migrations
007/008 incident this defends against). This collection is brand new in
Commit 2 so duplicates are not expected, but the check costs nothing and
keeps this migration safe to re-run / safe if ever pointed at a
pre-populated collection (e.g. a future data import).

Idempotent: every index is named and checked via index_information() first.
Safe to re-run.
"""
from pymongo import ASCENDING
from pymongo.errors import OperationFailure

VERSION = "014_riders"


async def _index_exists(coll, name: str) -> bool:
    existing = await coll.index_information()
    return name in existing


async def _ensure_index(coll, keys, name: str, report: list, **kwargs) -> None:
    """Idempotent, individually error-isolated create_index. Never raises —
    matches migration 013's `_ensure_index` so one failed index here can't
    block the rest of this migration or any migration queued after it."""
    try:
        if await _index_exists(coll, name):
            report.append(f"{coll.name}.{name}: already exists, no-op")
            return
        await coll.create_index(keys, name=name, background=True, **kwargs)
        report.append(f"{coll.name}.{name}: created")
    except OperationFailure as e:
        report.append(f"{coll.name}.{name}: FAILED ({e.code}: {str(e)[:160]})")
    except Exception as e:  # pragma: no cover — defensive, see module docstring
        report.append(f"{coll.name}.{name}: FAILED (unexpected {type(e).__name__}: {str(e)[:160]})")


async def _find_duplicate_values(coll, field: str) -> list[dict]:
    """Groups by `field` and returns groups with count > 1. Empty list = safe
    to build a unique index. On any failure to even run this check, returns a
    synthetic 'unknown' entry — never treat an inability to verify safety as
    safe (mirrors migration 013's `_find_duplicate_ids`)."""
    try:
        return await coll.aggregate([
            {"$group": {"_id": f"${field}", "count": {"$sum": 1}}},
            {"$match": {"count": {"$gt": 1}}},
        ]).to_list(200)
    except Exception as e:
        return [{"_id": f"<duplicate-check itself failed: {e}>", "count": 999}]


async def _ensure_unique_index(coll, field: str, name: str, report: list) -> None:
    if await _index_exists(coll, name):
        report.append(f"{coll.name}.{name}: already exists, no-op")
        return

    dupes = await _find_duplicate_values(coll, field)
    if dupes:
        preview = ", ".join(f"{d['_id']!r}×{d['count']}" for d in dupes[:20])
        more = f" (+{len(dupes) - 20} more)" if len(dupes) > 20 else ""
        report.append(
            f"{coll.name}.{name}: DUPLICATE {field} values found — skipping unique build. "
            f"{len(dupes)} group(s): {preview}{more} — MANUAL CLEANUP NEEDED; "
            f"re-run this migration after cleanup to enforce uniqueness"
        )
        await _ensure_index(coll, [(field, ASCENDING)], name, report)
        return

    try:
        await coll.create_index([(field, ASCENDING)], unique=True, name=name, background=True)
        report.append(f"{coll.name}.{name}: created (unique, no duplicates found)")
    except OperationFailure as e:
        report.append(
            f"{coll.name}.{name}: unique build FAILED despite no duplicates found "
            f"({e.code}: {str(e)[:160]}) — falling back to non-unique"
        )
        await _ensure_index(coll, [(field, ASCENDING)], name, report)


async def up(db) -> dict:
    report: list[str] = []

    await _ensure_unique_index(db.riders, "id", "idx_riders_id_unique", report)
    await _ensure_unique_index(db.riders, "phone", "idx_riders_phone_unique", report)

    return {"indexes": report}
