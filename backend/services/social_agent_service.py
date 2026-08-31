"""Social content agent — Business Intelligence + content queue.

Two responsibilities, kept deliberately separate:

  1. Opportunity detection (`get_discount_opportunities`,
     `get_new_store_opportunities`): diff Lokl's live product/store data
     against a stored snapshot to surface "this discount just appeared" /
     "this store just went live" events — the Business Intelligence Agent
     from the Lokl x Claude social-agent blueprint.

  2. Content queue (`create_queue_item` / `list_queue_items` /
     `update_queue_status`): one document per drafted post, reviewed by a
     human (WhatsApp ping + a one-page admin screen, routes/social_content.py)
     before anything is ever published.

No Instagram publishing lives here. That's the Meta Graph API integration
(blueprint Part 3) — deliberately out of scope until this detect -> draft ->
approve loop is proven with manual posting first.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

STATE_DOC_ID = "social_agent_state"
VALID_STATUSES = {"pending_review", "approved", "rejected", "changes_requested", "published"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Business Intelligence: opportunity detection ───────────────────────

async def get_discount_opportunities(db, min_discount_delta: int = 15) -> list[dict]:
    """Products whose `discount_percent` just appeared or grew by at least
    `min_discount_delta` points since the last time this ran.

    Snapshot-diff, not a timestamp filter: `products.discount_percent` has
    no reliable `changed_at` field today (confirmed by reading migration
    030's own backfill script — the field is computed on write, never
    stamped with a change time), so this stores its own snapshot in
    `social_agent_state` rather than requiring a schema change. Each run
    only returns genuinely NEW movement since the previous run.
    """
    state = await db.social_agent_state.find_one({"id": STATE_DOC_ID}) or {}
    prev_snapshot: dict = state.get("discount_snapshot", {})

    products = await db.products.find(
        {"discount_percent": {"$gt": 0}},
        {"_id": 0, "id": 1, "name": 1, "store_id": 1, "price": 1, "mrp": 1,
         "discount_percent": 1, "image": 1},
    ).to_list(2000)

    opportunities = []
    new_snapshot: dict = {}
    for p in products:
        pid = p["id"]
        current = p.get("discount_percent", 0)
        new_snapshot[pid] = current
        previous = prev_snapshot.get(pid, 0)
        if current - previous >= min_discount_delta:
            opportunities.append({
                "event": "discount",
                "product_id": pid,
                "product_name": p.get("name"),
                "store_id": p.get("store_id"),
                "price": p.get("price"),
                "mrp": p.get("mrp"),
                "discount_percent": current,
                "previous_discount_percent": previous,
                "image": p.get("image"),
            })

    await db.social_agent_state.update_one(
        {"id": STATE_DOC_ID},
        {"$set": {"discount_snapshot": new_snapshot, "discount_checked_at": _now_iso()}},
        upsert=True,
    )
    return opportunities


async def get_new_store_opportunities(db, since_iso: Optional[str] = None) -> list[dict]:
    """Stores that went live (`live_since`) since the last check.

    Deliberately reuses `stores.live_since` — stamped exactly once, on the
    real False->True online transition, by `POST /merchant/store/online`
    (confirmed by reading that handler directly) — rather than
    `/admin/merchants/{mid}/approve`. Lokl runs no manual merchant-approval
    gate at launch, so the approval endpoint is not a reliable "new store"
    signal; the self-serve go-live moment is.
    """
    state = await db.social_agent_state.find_one({"id": STATE_DOC_ID}) or {}
    since = since_iso or state.get("stores_checked_at") or "1970-01-01T00:00:00+00:00"

    stores = await db.stores.find(
        {"live_since": {"$gt": since}, "published": True},
        {"_id": 0, "id": 1, "name": 1, "business_category": 1, "locality": 1,
         "live_since": 1, "merchant_id": 1},
    ).sort("live_since", 1).to_list(200)

    opportunities = []
    for s in stores:
        product_count = await db.products.count_documents({"store_id": s["id"]})
        opportunities.append({
            "event": "new_store",
            "store_id": s["id"],
            "store_name": s.get("name"),
            "category": s.get("business_category"),
            "locality": s.get("locality"),
            "live_since": s.get("live_since"),
            "product_count": product_count,
        })

    await db.social_agent_state.update_one(
        {"id": STATE_DOC_ID},
        {"$set": {"stores_checked_at": _now_iso()}},
        upsert=True,
    )
    return opportunities


# ── Content queue ───────────────────────────────────────────────────────

async def create_queue_item(db, payload: dict) -> dict:
    doc = {
        "id": f"soc-{uuid.uuid4().hex[:10]}",
        # brand | entertainment | education | community | culture | product | offer | merchant_story
        "pillar": payload.get("pillar", "product"),
        "post_type": payload.get("post_type", "post"),  # post | carousel | reel
        "source_event": payload.get("source_event"),    # "discount" | "new_store" | "manual" | ...
        "data_source": payload.get("data_source"),      # short human-readable trace for the reviewer
        "caption": payload.get("caption", ""),
        "creative_brief": payload.get("creative_brief", ""),
        "image_url": payload.get("image_url"),
        "hashtags": payload.get("hashtags") or [],
        "scheduled_time": payload.get("scheduled_time"),
        "status": "pending_review",
        "review_note": None,
        "created_at": _now_iso(),
        "reviewed_at": None,
    }
    await db.social_content_queue.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def list_queue_items(db, status: Optional[str] = None, limit: int = 50) -> list[dict]:
    q = {"status": status} if status else {}
    return await db.social_content_queue.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)


async def get_queue_item(db, item_id: str) -> Optional[dict]:
    return await db.social_content_queue.find_one({"id": item_id}, {"_id": 0})


async def update_queue_status(db, item_id: str, status: str, note: Optional[str] = None) -> Optional[dict]:
    if status not in VALID_STATUSES:
        raise ValueError(f"invalid status: {status}")
    result = await db.social_content_queue.update_one(
        {"id": item_id},
        {"$set": {"status": status, "review_note": note, "reviewed_at": _now_iso()}},
    )
    if result.matched_count == 0:
        return None
    return await get_queue_item(db, item_id)


async def ensure_indexes(db):
    await db.social_content_queue.create_index("status")
    await db.social_content_queue.create_index("created_at")
    await db.social_agent_state.create_index("id", unique=True)
