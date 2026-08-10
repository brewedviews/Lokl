"""Migration 013 — secondary indexes for products + stores.

Context: a performance investigation across the app's slow-loading pages
(category page, search type-ahead, stores list, cart rails, product page)
traced most of them back to a single shared root cause — `db.products` and
`db.stores` have no secondary indexes at all beyond what migration 001
already created, and 001 never indexed the one field almost every single-
document lookup in server.py actually queries by: the app's own string
`id` field (not Mongo's internal `_id` ObjectId). `find_one({"id": pid})` —
the product page, cart, orders, merchant product management, basically
every "fetch one product/store" call site — was a full collection scan.

WHAT'S NEW HERE vs. what migration 001 already covers (checked
server.py's actual query shapes before deciding what to add):
  - products.id / stores.id (unique) — NEW. The highest-leverage index in
    this migration; see _ensure_unique_id_index() for why it's built
    defensively (see SAFETY below).
  - products text index on {name, description} — NEW. Not wired up yet;
    GET /api/search currently does an unanchored, case-insensitive $regex
    against both fields, which is a full collection scan on every
    keystroke regardless of any index — switching it to use this index is
    a deliberately SEPARATE follow-up commit. This migration only builds
    the index so it's ready.
  - stores text index on {name, tagline, specialties} — NEW, same reason.
  - stores.area_slug — NEW. Powers GET /api/stores?area=... (the "Shop by
    Area" deep link); nothing indexed it before.
  - stores.kyc_status + published (compound) — NEW. _visible_store_filter()
    = {kyc_status: "approved", published: True, paused: {$ne: True},
    is_deleted: {$ne: True}} is the single most common store filter in the
    backend — every /feed/* endpoint applies it via _availability_map(),
    plus list_stores/nearby-stores/popular-stores/delivery-status directly.
    This compound covers its two leading EQUALITY fields; paused/is_deleted
    use $ne so they don't get tight index bounds, but the kyc_status+
    published prefix alone already narrows a full scan down to just live,
    published stores. Migration 001's is_deleted+online+published compound
    is a different field combination (no kyc_status) and doesn't serve
    this filter shape.
  - products.store_id / store_id+is_deleted+paused / l1_id+l2_id / price /
    created_at, stores.city — ALREADY created by migration 001. Redeclared
    here VERBATIM (identical name/keys/options) so this migration is
    self-sufficient: a true no-op if 001 already applied, but still closes
    the gap if 001 somehow didn't run against a given deployment. Checked
    whether l1_id and l2_id also need their own STANDALONE indexes beyond
    the (l1_id, l2_id) compound already in 001: every /api/products and
    /api/products/all call site sets l1_id whenever l2_id is set (l2 is
    never queried without l1 anywhere in server.py), so the compound's
    l1_id-prefix already serves "l1_id only" queries — a standalone l2_id
    index would just be extra write overhead with no query it uniquely
    serves, so it's deliberately NOT added.

SAFETY (prior incident): migrations 007/008 record a real production
outage from this exact class of change — a unique index rebuild hit
E11000 on existing duplicate values, crashed uncaught (only drop_index was
try/excepted, not the create), and because migrations/run.py has no
per-migration error isolation, that single crash aborted the whole batch,
silently blocking every migration queued after it. Two defenses here:
  1. _ensure_unique_id_index() checks for duplicate `id` values FIRST (a
     $group aggregation) before ever attempting a unique build. If
     duplicates exist (or the check itself fails, e.g. the collection is
     unreachable), it does NOT attempt the unique index — it falls back to
     a plain non-unique index instead (still fixes the collection-scan
     problem) and reports exactly which ids collided, for manual cleanup.
  2. EVERY index creation in this file goes through _ensure_index(), which
     try/excepts individually and always returns normally — nothing in
     this module can raise out of up(), so one failed index can never
     block the rest of this migration or any migration queued after it.

Idempotent: every index is named and checked via index_information() first
(create_index is also a natural no-op for an identical existing index, but
checking first keeps the report accurate and avoids a wasted server round
trip). Safe to re-run.
"""
from pymongo import ASCENDING, DESCENDING, TEXT
from pymongo.errors import OperationFailure

VERSION = "013_products_stores_indexes"


async def _index_exists(coll, name: str) -> bool:
    existing = await coll.index_information()
    return name in existing


async def _ensure_index(coll, keys, name: str, report: list, **kwargs) -> None:
    """Idempotent, individually error-isolated create_index. Appends one
    status line to `report`. Never raises — a failure here must not stop
    the rest of this migration (or, since migrations/run.py has no
    per-migration isolation of its own, every migration queued after it —
    see migrations 007/008 for exactly this failure mode)."""
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


async def _find_duplicate_ids(coll) -> list[dict]:
    """Groups by `id` and returns groups with count > 1. Documents missing
    `id` entirely group together under _id: null too, so a collection with
    2+ id-less docs is correctly flagged as unsafe for a unique build.
    Empty list = safe to build a unique index. On any failure to even run
    this check, returns a synthetic "unknown" entry — never treat an
    inability to verify safety as "safe"."""
    try:
        return await coll.aggregate([
            {"$group": {"_id": "$id", "count": {"$sum": 1}}},
            {"$match": {"count": {"$gt": 1}}},
        ]).to_list(200)
    except Exception as e:
        return [{"_id": f"<duplicate-check itself failed: {e}>", "count": 999}]


async def _ensure_unique_id_index(coll, name: str, report: list) -> None:
    """The highest-leverage index in this whole migration — but also the
    one prior incidents (migrations 007/008) show is dangerous to build
    blind. Checks for duplicate `id` values first; only attempts the
    unique build if none exist. On duplicates (or an unverifiable check),
    falls back to a plain NON-unique index instead — id lookups stop being
    a full collection scan either way — and reports the offending ids so
    they can be cleaned up by hand before a unique constraint is safe."""
    if await _index_exists(coll, name):
        report.append(f"{coll.name}.{name}: already exists, no-op")
        return

    dupes = await _find_duplicate_ids(coll)
    if dupes:
        preview = ", ".join(f"{d['_id']!r}×{d['count']}" for d in dupes[:20])
        more = f" (+{len(dupes) - 20} more)" if len(dupes) > 20 else ""
        report.append(
            f"{coll.name}.{name}: DUPLICATE ids found — skipping unique build. "
            f"{len(dupes)} group(s): {preview}{more} — MANUAL CLEANUP NEEDED; "
            f"re-run this migration after cleanup (or drop+recreate {name} as "
            f"unique by hand) to enforce uniqueness"
        )
        await _ensure_index(coll, [("id", ASCENDING)], name, report)
        return

    try:
        await coll.create_index([("id", ASCENDING)], unique=True, name=name, background=True)
        report.append(f"{coll.name}.{name}: created (unique, no duplicates found)")
    except OperationFailure as e:
        report.append(
            f"{coll.name}.{name}: unique build FAILED despite no duplicates found "
            f"({e.code}: {str(e)[:160]}) — falling back to non-unique"
        )
        await _ensure_index(coll, [("id", ASCENDING)], name, report)


async def up(db) -> dict:
    report: list[str] = []

    # ===== products =====
    # id — see module docstring: THE highest-leverage index here.
    await _ensure_unique_id_index(db.products, "idx_products_id_unique", report)

    # Already created by migration 001 — redeclared verbatim (defensive,
    # true no-op if 001 already applied).
    await _ensure_index(db.products, [("store_id", ASCENDING)], "idx_products_store_id", report)
    await _ensure_index(
        db.products,
        [("store_id", ASCENDING), ("is_deleted", ASCENDING), ("paused", ASCENDING)],
        "idx_products_store_active", report,
    )
    await _ensure_index(db.products, [("l1_id", ASCENDING), ("l2_id", ASCENDING)], "idx_products_taxonomy", report)
    await _ensure_index(db.products, [("price", ASCENDING)], "idx_products_price", report)
    await _ensure_index(db.products, [("created_at", DESCENDING)], "idx_products_created_desc", report)

    # NEW — text search index, ready ahead of a separate follow-up commit
    # that switches GET /api/search from $regex to $text.
    await _ensure_index(db.products, [("name", TEXT), ("description", TEXT)], "idx_products_text", report)

    # ===== stores =====
    # id — same rationale as products.id.
    await _ensure_unique_id_index(db.stores, "idx_stores_id_unique", report)

    # Already created by migration 001 — redeclared verbatim.
    await _ensure_index(db.stores, [("city", ASCENDING)], "idx_stores_city", report)

    # NEW
    await _ensure_index(db.stores, [("area_slug", ASCENDING)], "idx_stores_area_slug", report)
    await _ensure_index(
        db.stores,
        [("kyc_status", ASCENDING), ("published", ASCENDING)],
        "idx_stores_kyc_published", report,
    )
    await _ensure_index(
        db.stores,
        [("name", TEXT), ("tagline", TEXT), ("specialties", TEXT)],
        "idx_stores_text", report,
    )

    return {"indexes": report}
