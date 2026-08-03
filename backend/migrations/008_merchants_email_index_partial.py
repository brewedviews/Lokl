"""Migration 008 — fix merchants.email unique index to be a PARTIAL index,
not sparse.

Migration 007 made the index sparse=True, on the assumption that sparse
would exclude the null-email documents the register endpoint writes. That
assumption was wrong: sparse indexes only exclude documents where the field
is entirely ABSENT — a document with the field explicitly present and set to
null (which is exactly what `{"email": None}` in the insert doc produces)
is still indexed. So every merchant past the first with a null email kept
colliding on {email: null} even after 007 — confirmed against real
production MongoDB, not just locally.

A partial index filtered on {"$type": "string"} only indexes documents whose
email is an actual string, correctly excluding both null and (once the
register endpoint stops setting the key at all — see the accompanying
server.py change) absent email fields, while still enforcing uniqueness
among real email addresses.

Its own migration rather than editing 001/007 in place, for the same reason
007 had to be separate: the runner tracks applied versions by filename, and
001/007 are already marked applied on any live deployment.
"""
from pymongo import ASCENDING
from pymongo.errors import OperationFailure

VERSION = "008_merchants_email_index_partial"

INDEX_NAME = "idx_merchants_email_unique"
PARTIAL_FILTER = {"email": {"$type": "string"}}


async def up(db):
    report = {"indexes": []}
    existing = await db.merchants.index_information()
    idx = existing.get(INDEX_NAME)

    if idx is not None and idx.get("partialFilterExpression") == PARTIAL_FILTER:
        report["indexes"].append(f"merchants.{INDEX_NAME}: already partial, no-op")
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
