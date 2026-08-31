"""Migration 033 — reconcile stale store product_count/published state for
existing storefronts affected by the "Modeladdress" bug class (see
server.py's `_create_or_setup_storefront_for_merchant`, fixed to recompute
`product_count` and call `_maybe_autopublish_store()` on every future
storefront creation — this migration is the one-time backfill for stores
created BEFORE that fix shipped).

Root cause recap: storefront creation used to hardcode `product_count: 0`
and never trigger autopublish. A store created after admin had already
added products for that merchant (admin_override lets admin create
products before a storefront exists at all — an intentional onboarding-
prep feature) was frozen at `product_count: 0`, `published: False`
forever — regardless of how many real, unpaused products existed
underneath it — until some unrelated later product mutation happened to
touch that same store and incidentally correct it.

This migration does exactly two things per existing, non-deleted store,
and nothing else:

  1. Recompute `product_count` from the real, current
     `db.products.count_documents({"store_id": ..., "paused": {"$ne":
     True}})`. Corrects a stale counter in either direction, though in
     practice this bug class only ever produced "too low". A store whose
     stored value already matches reality is left untouched (no write).

  2. Run the SAME autopublish condition the app already applies after
     every live product mutation (`_maybe_autopublish_store` in
     server.py — duplicated here verbatim, since migrations are
     self-contained and never import from server.py): if the merchant's
     KYC is approved, the store exists, is not already published, and now
     has >=1 unpaused product, flip it to published (stamping `live_at`)
     and push the same "Your store is live on Lokl" notification a real
     autopublish event would.

This is deliberately one-directional and narrow, matching the live
function's own contract:
  - NEVER un-publishes an already-published store (an already-live store's
    `published` is left exactly as-is, even if it currently has 0 unpaused
    products — a store that went live and then had its only product paused
    is a legitimate "temporarily nothing for sale" state, not a bug).
  - NEVER touches `paused` (admin-suspended), `is_deleted`, or any other
    store/merchant field — banner, tagline, KYC status, bank details, area,
    timing, etc. are never read or written here.
  - Soft-deleted stores (`is_deleted: True`) are excluded entirely — this
    backfill only reconciles active stores.

Idempotent by construction: a store whose product_count already matches
reality and whose published state is already correct produces zero writes
on a re-run. Safe to run any number of times.
"""
from datetime import datetime, timezone

VERSION = "033_reconcile_stale_store_product_counts"


async def up(db) -> dict:
    report: list[str] = []
    counts_fixed = 0
    autopublished = 0

    stores = await db.stores.find(
        {"is_deleted": {"$ne": True}},
        {"_id": 0, "id": 1, "merchant_id": 1, "product_count": 1, "published": 1},
    ).to_list(None)

    for s in stores:
        store_id = s.get("id")
        merchant_id = s.get("merchant_id")
        if not store_id or not merchant_id:
            continue

        real_count = await db.products.count_documents({"store_id": store_id, "paused": {"$ne": True}})
        stored_count = s.get("product_count")
        if stored_count != real_count:
            await db.stores.update_one({"id": store_id}, {"$set": {"product_count": real_count}})
            report.append(f"{store_id}: product_count {stored_count!r} -> {real_count} (stale counter)")
            counts_fixed += 1

        if s.get("published"):
            continue  # already live — never touched, regardless of current count

        m = await db.merchants.find_one({"id": merchant_id}, {"_id": 0, "kyc_status": 1})
        if not m or m.get("kyc_status") != "approved":
            continue
        if real_count < 1:
            continue

        now = datetime.now(timezone.utc).isoformat()
        await db.stores.update_one({"id": store_id}, {"$set": {
            "published": True,
            "product_count": real_count,
            "live_at": now,
        }})
        await db.merchants.update_one({"id": merchant_id}, {"$push": {"notifications": {
            "type": "go-live", "title": "Your store is live on Lokl",
            "body": "Customers in Bhilai can now discover and order from your store.",
            "time": now,
        }}})
        report.append(f"{store_id}: published False -> True (KYC approved + {real_count} unpaused product(s), was stuck)")
        autopublished += 1

    report.append(f"SUMMARY: {len(stores)} stores scanned, {counts_fixed} product_count fixes, {autopublished} autopublished")
    return {"reconcile_stale_store_product_counts": report}
