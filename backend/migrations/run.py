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


def _discover():
    """Return migrations in lexical order: ('001_initial_…', module)."""
    here = Path(__file__).parent
    out = []
    for m in pkgutil.iter_modules([str(here)]):
        if m.name in ("run", "__init__"): continue
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
