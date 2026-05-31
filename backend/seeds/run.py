"""Seed runner. Usage:
    python -m seeds.run bhilai_config     # run a single seed by name
    python -m seeds.run --all             # run every seed in this package
"""
import asyncio, importlib, os, sys, pkgutil
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient


async def main():
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    args = [a for a in sys.argv[1:] if a]
    if not args:
        print("Usage: python -m seeds.run <seed_name> | --all"); return
    if args[0] == "--all":
        names = [m.name for m in pkgutil.iter_modules([str(Path(__file__).parent)])
                 if m.name not in ("run", "__init__")]
    else:
        names = args
    for name in names:
        mod = importlib.import_module(f"seeds.{name}")
        result = await mod.up(db)
        print(f"  ✓ {name}: {result}")
    cli.close()


if __name__ == "__main__":
    asyncio.run(main())
