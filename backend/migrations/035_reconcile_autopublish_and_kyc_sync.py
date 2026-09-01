"""Migration 035 — reconcile store publish state (both directions) and
resync every store's stale `kyc_status` snapshot.

Root cause (audit, 2026-09): `_maybe_autopublish_store()` in server.py is
the canonical "does this store's published state match its merchant's
current KYC + eligibility" reconciliation function — but until this fix
it was wired into product/storefront mutations only, NOT into `POST
/admin/merchants/{mid}/approve` (KYC approval), `PATCH
/merchant/products/{pid}` (the fast pause/unpause toggle), `POST
/admin/products/{pid}/unpause`, or ANY endpoint that moves KYC away from
"approved" (`admin_reject`, `admin_hold`, `kyc_submit`,
`merchant_kyc_resubmit`). Two symptoms of the same missing-trigger bug
class:
  - A merchant whose storefront + unpaused products already existed at
    the moment their KYC got approved — a completely ordinary onboarding
    order, not an edge case — got permanently stuck at `published: False`
    regardless of how many real, eligible products they had, because
    nothing was ever going to call the check again unless some unrelated
    later product mutation happened to touch that same store.
  - The mirror image: a merchant whose store was already live, then had
    their KYC rejected/put on hold, stayed fully visible to customers
    indefinitely — nothing ever re-checked whether a live store's KYC
    status was still current.
Migration 033 already backfilled the first symptom once; it does not
re-run, so any merchant approved (or any product unpaused via the two
fast-toggle paths above) since 033 shipped could be stuck the same way
again, and the second symptom was never backfilled at all — this
migration covers both, for every trigger point fixed in server.py.

A second, related gap this migration also closes: `store.kyc_status` is a
denormalized snapshot of `merchant.kyc_status` — `_visible_store_filter()`
(every customer-facing store/product listing) checks it directly on the
store document rather than joining against merchants (deliberate: a plain
Mongo filter dict on every listing query, not a $lookup aggregation, to
avoid a real performance regression across all of them). That snapshot
was previously only ever written once, at whatever moment the storefront
document was created/last saved — approving OR revoking KYC afterward
never touched it. A store's `kyc_status` snapshot can therefore be stale
independent of whether it's published, and this migration corrects every
stale one it finds, not just the ones blocking a publish.

Per project convention (confirmed: no existing migration imports from
server.py — it's a heavyweight FastAPI module with side effects at import
time, and migrations are meant to be self-contained scripts), the
eligibility conditions are duplicated here rather than imported —
identical intent to `_maybe_autopublish_store`'s own logic, mirroring
migration 033's own stated rationale for doing the same. If that function
is ever changed, this migration's copy does not need to match forever —
it only needs to have been correct for the one-time backfill it performs
at the moment it runs.

This migration does exactly three things per existing, non-deleted store,
and nothing else:

  1. Recompute `product_count` from the real, current
     `db.products.count_documents({"store_id": ..., "paused": {"$ne":
     True}})`. A store whose stored value already matches reality is left
     untouched (no write) — same as migration 033.

  2. Sync `store.kyc_status` to the owning merchant's CURRENT
     `kyc_status`, regardless of the store's published state. Never
     touches any other store field in this step.

  3. Reconcile `published` in BOTH directions, mirroring
     `_maybe_autopublish_store()` exactly:
       - published=True but the merchant's KYC is no longer "approved" ->
         flip to published=False. Nothing else about the store changes —
         no product, storefront content, product_count, or live_at is
         touched or deleted; a later re-approval re-runs this same logic
         (via the live function, or a future re-run of this migration)
         and re-publishes if the store still qualifies.
       - published=False but KYC is approved, the store isn't paused, and
         it has >=1 unpaused product -> flip to published=True (stamping
         `live_at`) and push the same "Your store is live on Lokl"
         notification a real autopublish event would.
       - Any other combination is already consistent — left untouched.

Matches the live function's own contract exactly (identical guarantees to
migration 033, extended for the reverse direction):
  - NEVER touches the `paused` (admin-suspended) field itself, and NEVER
    publishes a currently-paused store even if every other condition is
    met — mirrors `_maybe_autopublish_store()`'s own explicit guard
    (published is meant to record "has genuinely gone live"; doing that
    behind an active suspension is confusing state for no operational
    benefit). Step 1 (product_count) and step 2 (kyc_status sync) still
    run for a paused store — pure data hygiene, no visibility consequence
    either way — only step 3 (the publish flip) skips it.
  - Soft-deleted stores are excluded from all three steps by the query
    itself (see below), not by a per-step check.
  - Never touches banner, tagline, bank details, area, timing, or any
    other store/merchant field.
  - Soft-deleted stores (`is_deleted: True`) are excluded entirely from
    all three steps — this backfill only reconciles active stores.

Idempotent by construction: a store whose product_count, kyc_status, and
published state already match reality produces zero writes on a re-run.
Safe to run any number of times.
"""
from datetime import datetime, timezone

VERSION = "035_reconcile_autopublish_and_kyc_sync"


async def up(db) -> dict:
    report: list[str] = []
    counts_fixed = 0
    kyc_synced = 0
    autopublished = 0
    unpublished = 0

    stores = await db.stores.find(
        {"is_deleted": {"$ne": True}},
        {"_id": 0, "id": 1, "merchant_id": 1, "product_count": 1, "published": 1, "kyc_status": 1, "paused": 1},
    ).to_list(None)

    for s in stores:
        store_id = s.get("id")
        merchant_id = s.get("merchant_id")
        if not store_id or not merchant_id:
            continue

        # ---- Step 1: product_count ----
        real_count = await db.products.count_documents({"store_id": store_id, "paused": {"$ne": True}})
        stored_count = s.get("product_count")
        if stored_count != real_count:
            await db.stores.update_one({"id": store_id}, {"$set": {"product_count": real_count}})
            report.append(f"{store_id}: product_count {stored_count!r} -> {real_count} (stale counter)")
            counts_fixed += 1

        m = await db.merchants.find_one({"id": merchant_id}, {"_id": 0, "kyc_status": 1})
        if not m:
            continue
        merchant_kyc = m.get("kyc_status")

        # ---- Step 2: kyc_status snapshot sync (independent of published state) ----
        if s.get("kyc_status") != merchant_kyc:
            await db.stores.update_one({"id": store_id}, {"$set": {"kyc_status": merchant_kyc}})
            report.append(f"{store_id}: kyc_status {s.get('kyc_status')!r} -> {merchant_kyc!r} (stale snapshot)")
            kyc_synced += 1

        # ---- Step 3: publish-state reconciliation, same invariant as
        # _maybe_autopublish_store — BOTH directions ----
        if s.get("published") and merchant_kyc != "approved":
            # Reverse direction: a store that's live but whose merchant's
            # KYC is no longer approved (rejected/held/resubmitted since
            # this store went live, with nothing ever re-checking it).
            # Only the flag changes — product_count/live_at/products/
            # storefront content are all left exactly as they are, same
            # as the live function's own contract.
            await db.stores.update_one({"id": store_id}, {"$set": {"published": False}})
            report.append(f"{store_id}: published True -> False (KYC no longer approved: {merchant_kyc!r}, was stuck live)")
            unpublished += 1
            continue

        if s.get("published"):
            continue  # already live and still KYC-approved — nothing to do
        if s.get("paused"):
            continue  # admin-suspended — mirrors _maybe_autopublish_store's own guard
        if merchant_kyc != "approved":
            continue
        if real_count < 1:
            continue

        now = datetime.now(timezone.utc).isoformat()
        await db.stores.update_one({"id": store_id}, {"$set": {
            "published": True,
            "kyc_status": "approved",
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

    report.append(
        f"SUMMARY: {len(stores)} stores scanned, {counts_fixed} product_count fixes, "
        f"{kyc_synced} kyc_status syncs, {autopublished} autopublished, {unpublished} unpublished (KYC no longer approved)"
    )
    return {"reconcile_autopublish_and_kyc_sync": report}
