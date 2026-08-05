"""Migration 007 — fix merchants.email unique index to be a PARTIAL index
(not sparse).

Originally this migration rebuilt the index as sparse=True, on the mistaken
assumption that sparse would exclude null-email merchant docs (the register
form is phone-only and never collects email). That assumption was wrong:
sparse indexes only exclude documents where the field is entirely ABSENT —
a document with `email` explicitly set to null (exactly what the register
endpoint wrote) is still indexed, so registrations kept colliding on
{email: null} even after the sparse rebuild.

The correct fix — a PARTIAL unique index filtered on
{email: {$type: "string"}}, which only indexes documents whose email is an
actual string, correctly excluding both null and absent — was applied
manually in Atlas against prod. But every automated run of this migration
still tried to drop that good partial index and rebuild it as sparse,
which immediately hit E11000 on the existing {email: null} duplicates and
crashed — uncaught, since only drop_index was wrapped in try/except. With
no per-migration error isolation in migrations/run.py, that crash aborted
the entire batch, silently blocking 008/009/010 on every boot. This
migration never successfully completed against prod (it always errored out
before reaching the `_migrations` insert), so it was never recorded as
applied — safe to correct in place rather than needing a new migration
file.

Corrected here to match the partial-index fix (same logic as migration 008,
which exists separately only because it couldn't assume 007 hadn't already
been marked applied on some other deployment). Idempotent: no-ops if the
index already has the correct partialFilterExpression; drops and recreates
as partial if it's missing, sparse, or any other shape. Never builds a
sparse index — that was the bug.
"""
from pymongo import ASCENDING
from pymongo.errors import OperationFailure

VERSION = "007_merchants_email_index_sparse"

INDEX_NAME = "idx_merchants_email_unique"
PARTIAL_FILTER = {"email": {"$type": "string"}}


async def up(db):
    report = {"indexes": []}
    existing = await db.merchants.index_information()
    idx = existing.get(INDEX_NAME)

    if idx is not None and idx.get("partialFilterExpression") == PARTIAL_FILTER:
        report["indexes"].append(f"merchants.{INDEX_NAME}: already correct (partial), no-op")
        return report

    if idx is not None:
        try:
            await db.merchants.drop_index(INDEX_NAME)
            report["indexes"].append(f"merchants.{INDEX_NAME}: dropped (was {idx})")
        except OperationFailure as e:
            report["indexes"].append(f"merchants.{INDEX_NAME}: drop skipped ({e})")

    await db.merchants.create_index(
        [("email", ASCENDING)], unique=True,
        partialFilterExpression=PARTIAL_FILTER, name=INDEX_NAME,
    )
    report["indexes"].append(f"merchants.{INDEX_NAME}: created partial ({PARTIAL_FILTER})")
    return report
