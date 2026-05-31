"""Migration 003 — payment-integrity collections (webhook_events,
payment_audit_log, failed_refunds) + TTL on unpaid Razorpay orders +
loosen orders.status enum to include `awaiting_payment` / `refunded`."""
from pymongo import ASCENDING, DESCENDING

VERSION = "003_payment_indexes_and_validators"


async def up(db):
    report = {"indexes": [], "validators": []}

    # webhook_events: unique on razorpay_event_id (idempotency)
    existing = await db.webhook_events.index_information()
    if "idx_webhook_events_razorpay_id" not in existing:
        await db.webhook_events.create_index(
            "razorpay_event_id", unique=True, name="idx_webhook_events_razorpay_id")
        report["indexes"].append("webhook_events.idx_webhook_events_razorpay_id: created")
    if "idx_webhook_events_unprocessed" not in existing:
        await db.webhook_events.create_index(
            [("processed", ASCENDING), ("created_at", DESCENDING)],
            name="idx_webhook_events_unprocessed")
        report["indexes"].append("webhook_events.idx_webhook_events_unprocessed: created")

    # payment_audit_log: query by order + recency
    al = await db.payment_audit_log.index_information()
    if "idx_audit_order_id" not in al:
        await db.payment_audit_log.create_index("order_id", name="idx_audit_order_id")
        report["indexes"].append("payment_audit_log.idx_audit_order_id: created")
    if "idx_audit_created" not in al:
        await db.payment_audit_log.create_index([("created_at", DESCENDING)], name="idx_audit_created")
        report["indexes"].append("payment_audit_log.idx_audit_created: created")

    # failed_refunds: query by order_id for ops dashboard
    fr = await db.failed_refunds.index_information()
    if "idx_failed_refunds_order" not in fr:
        await db.failed_refunds.create_index("order_id", name="idx_failed_refunds_order")
        report["indexes"].append("failed_refunds.idx_failed_refunds_order: created")

    # TTL on unpaid Razorpay orders — purge stuck `awaiting_payment` orders
    # 24h after expiry (gives ops time to inspect failures before deletion).
    # Note: we store expires_at as an ISO string; Mongo TTL needs a real Date.
    # We rely instead on a periodic cleanup query keyed by status=awaiting_payment
    # + expires_at<now — no TTL index here to avoid string-vs-date confusion.
    report["validators"].append(
        "TTL deferred — cleanup via /admin endpoint; awaiting_payment orders "
        "carry expires_at ISO string queryable by ops.")

    # Loosen orders.status enum to allow `awaiting_payment` and `refunded`
    try:
        await db.command({
            "collMod": "orders",
            "validator": {"$jsonSchema": {
                "bsonType": "object",
                "required": ["id", "items", "total", "status", "created_at"],
                "properties": {
                    "id": {"bsonType": "string", "maxLength": 64},
                    "total": {"bsonType": ["double", "int", "decimal"], "minimum": 0},
                    "status": {"enum": ["awaiting_payment", "pending_merchant", "accepted",
                                         "on_the_way", "delivered", "cancelled",
                                         "returned", "completed", "refunded"]},
                    "payment_status": {"enum": ["unpaid", "paid", "failed",
                                                  "cod_pending", "refund_pending",
                                                  "refunded", None]},
                    "payment_method": {"bsonType": "string", "maxLength": 32},
                    "is_multi_store": {"bsonType": "bool"},
                    "merchant_ids": {"bsonType": "array"},
                    "items": {"bsonType": "array", "minItems": 1},
                    "is_deleted": {"bsonType": "bool"},
                    "created_at": {"bsonType": ["string", "date"]},
                },
            }},
            "validationLevel": "moderate", "validationAction": "warn",
        })
        report["validators"].append("orders: status/payment_status enums extended")
    except Exception as e:
        report["validators"].append(f"orders validator update skipped: {e}")

    return report
