"""MongoDB schema-hardening migrations.

Each migration is an idempotent Python module exposing an `async def up(db)`
coroutine. The runner (`migrations.run`) executes pending migrations in
order, tracks state in the `_migrations` collection, and never re-runs a
completed one.

This is Mongo's analogue to Alembic — no DDL, just create_index + collMod
operations packaged as versioned scripts so the prod cluster's state is
reproducible from a single command.
"""
