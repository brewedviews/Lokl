"""Migration 007 — fix merchants.email unique index to be sparse.

The original index (migration 001) was unique but NOT sparse, so every
merchant with a null/missing email (the register form is phone-only and
never collects one) collided on the same {email: null} key after the very
first such document was inserted — an uncaught DuplicateKeyError on every
registration since. This drops the old non-sparse index and recreates it
sparse, matching the phone_canonical index's already-correct pattern.

This has to be its own migration rather than a patch to 001: the runner
tracks applied versions by filename in the `_migrations` collection, and
001 is already marked applied on any live deployment — editing its spec
alone would never re-execute against an existing database.
"""
from pymongo import ASCENDING
from pymongo.errors import OperationFailure

VERSION = "007_merchants_email_index_sparse"

INDEX_NAME = "idx_merchants_email_unique"


async def up(db):
    report = {"indexes": []}
    existing = await db.merchants.index_information()
    idx = existing.get(INDEX_NAME)

    if idx is not None and idx.get("sparse"):
        report["indexes"].append(f"merchants.{INDEX_NAME}: already sparse, no-op")
        return report

    if idx is not None:
        try:
            await db.merchants.drop_index(INDEX_NAME)
            report["indexes"].append(f"merchants.{INDEX_NAME}: dropped (was non-sparse)")
        except OperationFailure as e:
            report["indexes"].append(f"merchants.{INDEX_NAME}: drop skipped ({e})")

    await db.merchants.create_index(
        [("email", ASCENDING)], unique=True, sparse=True, name=INDEX_NAME,
    )
    report["indexes"].append(f"merchants.{INDEX_NAME}: created sparse")
    return report
