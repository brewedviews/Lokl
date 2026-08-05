"""Migration runner. Discovers `001_*.py`, `002_*.py`, … in this package and
runs each `up(db)` exactly once, tracking applied versions in the
`_migrations` Mongo collection.

Usage:
    cd /app/backend
    python -m migrations.run                 # run all pending
    python -m migrations.run --status        # show applied + pending
"""
import asyncio
import importlib
import os
import pkgutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient


# Standalone operational scripts that live in this package but do NOT
# implement the migration interface (VERSION + async up(db)) — they're
# run directly (`python -m migrations.NNN_name ...`), not via this runner.
# _discover() must skip them: pkgutil.iter_modules() matches any .py file
# here regardless of interface, and _run() below has no per-module error
# isolation, so one of these getting swept in as a "pending migration"
# raises AttributeError on `mod.up` and silently aborts every migration
# after it in sort order for every future run. Confirmed 006_cloudinary_cleanup
# did exactly this — it blocked 007/008/009 from ever applying to prod.
_NOT_MIGRATIONS = {"006_cloudinary_cleanup"}


def _discover():
    """Return migrations in lexical order: ('001_initial_…', module)."""
    here = Path(__file__).parent
    out = []
    for m in pkgutil.iter_modules([str(here)]):
        if m.name in ("run", "__init__") or m.name in _NOT_MIGRATIONS: continue
        out.append(m.name)
    out.sort()
    return out


async def _applied(db):
    return {d["version"] async for d in db["_migrations"].find({}, {"_id": 0, "version": 1})}


async def _run(db):
    pending = _discover()
    done = await _applied(db)
    summary = []
    for name in pending:
        if name in done:
            print(f"  ✓ {name} (already applied)")
            continue
        mod = importlib.import_module(f"migrations.{name}")
        if not (hasattr(mod, "up") and callable(mod.up)):
            # Not a real migration (no async up(db)) — skip it instead of
            # crashing the whole batch and silently blocking every module
            # that sorts after it. See _NOT_MIGRATIONS above for why this
            # guard exists.
            print(f"  ⚠ {name}: no up(db) — not a migration, skipping")
            continue
        version = getattr(mod, "VERSION", name)
        print(f"  → applying {version} …")
        report = await mod.up(db)
        await db["_migrations"].insert_one({
            "version": version,
            "applied_at": datetime.now(timezone.utc).isoformat(),
            "report": report,
        })
        summary.append((version, report))
        print(f"    ✓ {version} done")
    return summary


async def _status(db):
    done = await _applied(db)
    for n in _discover():
        flag = "✓ applied" if n in done else "○ pending"
        print(f"  {flag}   {n}")


async def main():
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    try:
        if "--status" in sys.argv:
            await _status(db)
        else:
            print(f"Migrations target: {os.environ['DB_NAME']}")
            results = await _run(db)
            for v, r in results:
                print(f"\n[{v}] summary:")
                for section, lines in r.items():
                    print(f"  {section}: {len(lines)} ops")
                    for ln in lines[:5]:
                        print(f"    · {ln}")
                    if len(lines) > 5:
                        print(f"    … (+{len(lines) - 5} more)")
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
