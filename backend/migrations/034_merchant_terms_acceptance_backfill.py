"""Migration 034 — backfill `terms_accepted`/`terms_version`/`terms_accepted_at`
on existing merchants.

Context: server.py's register() handler now requires explicit, gated consent
to the Merchant Terms & Agreement (MERCHANT_TERMS_VERSION) and stamps
`terms_accepted`/`terms_version`/`terms_accepted_at` on every NEW signup.
Merchants who registered before this shipped have none of those fields —
this migration backfills them so every merchant document has a consistent
shape (admin's Overview tab reads `terms_accepted` unconditionally) without
retroactively claiming a legal acceptance that never happened.

Pre-existing merchants are backfilled as `terms_accepted: False,
terms_version: None, terms_accepted_at: None` — i.e. explicitly "not yet
accepted the current agreement", not silently marked as having agreed to
something they never saw. Product/ops can decide separately whether to
prompt these merchants for an in-app re-acceptance; this migration only
makes the field present and honest, mirroring migration 030's own idiom
(idempotent, individually error-isolated, a `report` list returned rather
than raised exceptions).

Per project convention (confirmed: no existing migration imports from
server.py), MERCHANT_TERMS_VERSION is not imported — pre-existing merchants
get `terms_version: None` regardless of what server.py's constant currently
holds, since they didn't accept any version.
"""
VERSION = "034_merchant_terms_acceptance_backfill"


async def _backfill_terms_acceptance(db, report: list) -> None:
    try:
        cursor = db.merchants.find({}, {"_id": 0, "id": 1, "terms_accepted": 1})
        total, updated = 0, 0
        async for m in cursor:
            total += 1
            if "terms_accepted" in m:
                continue
            await db.merchants.update_one(
                {"id": m["id"]},
                {"$set": {"terms_accepted": False, "terms_version": None, "terms_accepted_at": None}},
            )
            updated += 1
        report.append(f"merchants.terms_accepted backfill: {updated}/{total} document(s) updated")
    except Exception as e:  # pragma: no cover — defensive, see migration 013's own rationale
        report.append(f"merchants.terms_accepted backfill: FAILED (unexpected {type(e).__name__}: {str(e)[:160]})")


async def up(db) -> dict:
    report: list[str] = []
    await _backfill_terms_acceptance(db, report)
    return {"terms_accepted": report}
