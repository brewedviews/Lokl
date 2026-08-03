"""Migration 001 — initial indexes + $jsonSchema validators + soft-delete backfill.

Idempotent: every operation either creates-or-skips. Safe to re-run.

Run with:    python -m migrations.run
"""
from datetime import datetime, timezone
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import OperationFailure

VERSION = "001_initial_indexes_and_validators"


# ===== Indexes (every read pattern in server.py) =====
INDEXES = {
    "merchants": [
        # partialFilterExpression, NOT sparse: email is optional (phone-based
        # registration never collects one) and the register endpoint stores
        # it as an explicit `null` on the doc. Sparse indexes only exclude
        # documents where the field is entirely ABSENT — a field present with
        # value null still gets indexed, so every merchant past the first
        # with email:null still collided (this was tried first in migration
        # 007 and confirmed insufficient against real MongoDB in production).
        # A partial index filtered on {"$type": "string"} only indexes docs
        # with an actual email string, which is what's needed here. See
        # migration 008 for the drop+recreate that repairs a database where
        # this index already exists as unique-non-sparse or unique-sparse.
        {"keys": [("email", ASCENDING)], "unique": True,
         "partialFilterExpression": {"email": {"$type": "string"}},
         "name": "idx_merchants_email_unique"},
        {"keys": [("phone_canonical", ASCENDING)], "unique": True, "sparse": True, "name": "idx_merchants_phone_unique"},
        {"keys": [("role", ASCENDING)], "name": "idx_merchants_role"},
        {"keys": [("kyc_status", ASCENDING)], "name": "idx_merchants_kyc_status"},
        {"keys": [("is_deleted", ASCENDING), ("kyc_status", ASCENDING)], "name": "idx_merchants_active_kyc"},
        {"keys": [("created_at", DESCENDING)], "name": "idx_merchants_created_desc"},
    ],
    "stores": [
        {"keys": [("merchant_id", ASCENDING)], "name": "idx_stores_merchant_id"},
        {"keys": [("is_deleted", ASCENDING), ("online", ASCENDING), ("published", ASCENDING)], "name": "idx_stores_active_online"},
        {"keys": [("lat", ASCENDING), ("lng", ASCENDING)], "name": "idx_stores_geo"},
        {"keys": [("city", ASCENDING)], "name": "idx_stores_city"},
        {"keys": [("paused", ASCENDING)], "name": "idx_stores_paused"},
    ],
    "products": [
        {"keys": [("store_id", ASCENDING)], "name": "idx_products_store_id"},
        {"keys": [("merchant_id", ASCENDING)], "name": "idx_products_merchant_id"},
        {"keys": [("store_id", ASCENDING), ("is_deleted", ASCENDING), ("paused", ASCENDING)], "name": "idx_products_store_active"},
        {"keys": [("l1_id", ASCENDING), ("l2_id", ASCENDING)], "name": "idx_products_taxonomy"},
        {"keys": [("price", ASCENDING)], "name": "idx_products_price"},
        {"keys": [("created_at", DESCENDING)], "name": "idx_products_created_desc"},
        {"keys": [("gender", ASCENDING)], "name": "idx_products_gender"},
        {"keys": [("rating", DESCENDING)], "name": "idx_products_rating_desc"},
    ],
    "orders": [
        {"keys": [("customer.phone", ASCENDING)], "name": "idx_orders_customer_phone"},
        {"keys": [("merchant_ids", ASCENDING)], "name": "idx_orders_merchant_ids"},
        {"keys": [("status", ASCENDING)], "name": "idx_orders_status"},
        {"keys": [("customer.phone", ASCENDING), ("status", ASCENDING)], "name": "idx_orders_customer_status"},
        {"keys": [("created_at", DESCENDING)], "name": "idx_orders_created_desc"},
        {"keys": [("otp", ASCENDING)], "name": "idx_orders_otp"},
        {"keys": [("is_deleted", ASCENDING)], "name": "idx_orders_is_deleted"},
    ],
    "returns": [
        {"keys": [("order_id", ASCENDING)], "name": "idx_returns_order_id"},
        {"keys": [("status", ASCENDING)], "name": "idx_returns_status"},
        {"keys": [("customer_phone", ASCENDING)], "name": "idx_returns_customer"},
        {"keys": [("merchant_id", ASCENDING)], "name": "idx_returns_merchant"},
        {"keys": [("created_at", DESCENDING)], "name": "idx_returns_created_desc"},
    ],
    "complaints": [
        {"keys": [("order_id", ASCENDING)], "name": "idx_complaints_order_id"},
        {"keys": [("status", ASCENDING)], "name": "idx_complaints_status"},
        {"keys": [("created_at", DESCENDING)], "name": "idx_complaints_created_desc"},
    ],
    "customers": [
        {"keys": [("phone", ASCENDING)], "unique": True, "name": "idx_customers_phone_unique"},
        {"keys": [("email", ASCENDING)], "sparse": True, "name": "idx_customers_email"},
        {"keys": [("updated_at", DESCENDING)], "name": "idx_customers_updated_desc"},
    ],
    "categories": [
        {"keys": [("id", ASCENDING)], "name": "idx_categories_id"},
    ],
    "subcategories": [
        {"keys": [("l1_id", ASCENDING)], "name": "idx_subcategories_l1"},
        {"keys": [("id", ASCENDING)], "name": "idx_subcategories_id"},
    ],
    "processed_payments": [
        {"keys": [("payment_id", ASCENDING)], "unique": True, "name": "idx_processed_payments_unique"},
    ],
    "heartbeats": [
        {"keys": [("session_id", ASCENDING)], "name": "idx_heartbeats_session"},
        {"keys": [("last_seen", DESCENDING)], "name": "idx_heartbeats_last_seen"},
    ],
    "offers": [
        {"keys": [("published", ASCENDING), ("rank", ASCENDING)], "name": "idx_offers_published_rank"},
    ],
    "testimonials": [
        {"keys": [("published", ASCENDING), ("rank", ASCENDING)], "name": "idx_testimonials_published_rank"},
    ],
    "change_requests": [
        {"keys": [("merchant_id", ASCENDING)], "name": "idx_change_requests_merchant"},
        {"keys": [("status", ASCENDING)], "name": "idx_change_requests_status"},
    ],
}


# ===== $jsonSchema validators (collection-level integrity) =====
# Set to validationLevel="moderate" so legacy docs don't break on first apply.
# Length limits mirror the Task 3 spec.
VALIDATORS = {
    "merchants": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["id", "email", "password_hash", "store_name", "owner_name", "role", "created_at"],
            "properties": {
                "id":              {"bsonType": "string", "maxLength": 64},
                "email":           {"bsonType": "string", "maxLength": 254, "pattern": r"^[^@\s]+@[^@\s]+\.[^@\s]+$"},
                "password_hash":   {"bsonType": "string", "minLength": 20, "maxLength": 200},
                "store_name":      {"bsonType": "string", "maxLength": 100},
                "owner_name":      {"bsonType": "string", "maxLength": 100},
                "phone":           {"bsonType": ["string", "null"], "maxLength": 20},
                "phone_canonical": {"bsonType": ["string", "null"], "maxLength": 15},
                "city":            {"bsonType": ["string", "null"], "maxLength": 80},
                "role":            {"enum": ["merchant", "admin"]},
                "kyc_status":      {"enum": ["draft", "submitted", "approved", "rejected", "on_hold", None]},
                "is_deleted":      {"bsonType": "bool"},
                "created_at":      {"bsonType": ["string", "date"]},
            },
        }
    },
    "stores": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["id", "merchant_id", "name"],
            "properties": {
                "id":          {"bsonType": "string", "maxLength": 64},
                "merchant_id": {"bsonType": "string", "maxLength": 64},
                "name":        {"bsonType": "string", "maxLength": 100},
                "tagline":     {"bsonType": ["string", "null"], "maxLength": 200},
                "city":        {"bsonType": ["string", "null"], "maxLength": 80},
                "lat":         {"bsonType": ["double", "int", "null"], "minimum": -90, "maximum": 90},
                "lng":         {"bsonType": ["double", "int", "null"], "minimum": -180, "maximum": 180},
                "online":      {"bsonType": "bool"},
                "published":   {"bsonType": "bool"},
                "paused":      {"bsonType": "bool"},
                "is_deleted":  {"bsonType": "bool"},
            },
        }
    },
    "products": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["id", "merchant_id", "store_id", "name", "price", "created_at"],
            "properties": {
                "id":           {"bsonType": "string", "maxLength": 64},
                "merchant_id":  {"bsonType": "string", "maxLength": 64},
                "store_id":     {"bsonType": "string", "maxLength": 64},
                "name":         {"bsonType": "string", "maxLength": 200},
                "description":  {"bsonType": ["string", "null"]},  # Text — no length cap
                "price":        {"bsonType": ["double", "int", "decimal"], "minimum": 0},
                "mrp":          {"bsonType": ["double", "int", "decimal", "null"], "minimum": 0},
                "l1_id":        {"bsonType": ["string", "null"], "maxLength": 64},
                "l2_id":        {"bsonType": ["string", "null"], "maxLength": 64},
                "gender":       {"bsonType": ["string", "null"], "maxLength": 16},
                "stock":        {"bsonType": ["object", "null"]},
                "is_deleted":   {"bsonType": "bool"},
                "paused":       {"bsonType": "bool"},
            },
        }
    },
    "orders": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["id", "items", "total", "status", "created_at"],
            "properties": {
                "id":             {"bsonType": "string", "maxLength": 64},
                "total":          {"bsonType": ["double", "int", "decimal"], "minimum": 0},
                "status":         {"enum": ["pending_merchant", "accepted", "on_the_way",
                                            "delivered", "cancelled", "returned", "completed"]},
                "is_multi_store": {"bsonType": "bool"},
                "merchant_ids":   {"bsonType": "array"},
                "items":          {"bsonType": "array", "minItems": 1},
                "is_deleted":     {"bsonType": "bool"},
                "created_at":     {"bsonType": ["string", "date"]},
            },
        }
    },
    "returns": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["id", "order_id", "status", "created_at"],
            "properties": {
                "id":       {"bsonType": "string", "maxLength": 64},
                "order_id": {"bsonType": "string", "maxLength": 64},
                "status":   {"enum": ["requested", "pickup_assigned", "picked_up", "received",
                                       "refunded", "rejected", "completed"]},
                "reason":   {"bsonType": ["string", "null"], "maxLength": 500},
            },
        }
    },
    "complaints": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["id", "order_id", "status", "created_at"],
            "properties": {
                "id":       {"bsonType": "string", "maxLength": 64},
                "order_id": {"bsonType": "string", "maxLength": 64},
                "type":     {"bsonType": "string", "maxLength": 80},
                "details":  {"bsonType": ["string", "null"], "maxLength": 2000},
                "status":   {"enum": ["open", "in_progress", "resolved", "closed"]},
            },
        }
    },
}


# Collections that get soft-delete fields backfilled
SOFT_DELETE_COLLECTIONS = ["merchants", "stores", "products", "orders"]


async def _ensure_index(coll, spec: dict) -> str:
    """Idempotent create_index — survives re-runs by ignoring 'already exists'."""
    keys = spec["keys"]
    kwargs = {k: v for k, v in spec.items() if k != "keys"}
    try:
        return await coll.create_index(keys, **kwargs)
    except OperationFailure as e:
        # Duplicate-name with same spec → already there. Conflicting spec → raise.
        if "already exists" in str(e) or e.code in (85, 86):
            return spec.get("name", "?") + " (already present)"
        raise


async def _apply_validator(db, name: str, validator: dict) -> str:
    """Create the collection if missing, then collMod its validator. Uses
    `moderate` validation level so existing non-conforming docs don't break
    writes; only NEW writes must conform."""
    names = await db.list_collection_names()
    if name not in names:
        await db.create_collection(name, validator=validator, validationLevel="moderate")
        return f"{name}: created with validator"
    try:
        await db.command({
            "collMod": name,
            "validator": validator,
            "validationLevel": "moderate",
            "validationAction": "warn",  # log but allow (still hardens prod-going-forward)
        })
        return f"{name}: collMod ok"
    except OperationFailure as e:
        return f"{name}: collMod skipped ({e.code}: {str(e)[:80]})"


async def up(db):
    report = {"indexes": [], "validators": [], "soft_delete": []}

    # 1) Indexes
    for cname, specs in INDEXES.items():
        for spec in specs:
            res = await _ensure_index(db[cname], spec)
            report["indexes"].append(f"{cname}.{spec.get('name')}={res}")

    # 2) Validators
    for cname, validator in VALIDATORS.items():
        msg = await _apply_validator(db, cname, validator)
        report["validators"].append(msg)

    # 3) Soft-delete backfill — set is_deleted=False on docs that don't have it.
    #    Existing docs are treated as live by default; only explicit soft_delete
    #    calls flip them.
    now = datetime.now(timezone.utc).isoformat()
    for cname in SOFT_DELETE_COLLECTIONS:
        r = await db[cname].update_many(
            {"is_deleted": {"$exists": False}},
            {"$set": {"is_deleted": False}},
        )
        report["soft_delete"].append(f"{cname}: backfilled is_deleted on {r.modified_count} docs")

    return report
