"""Standalone runner for the demo_stores seed.

Usage (from the backend/ directory):
    python run_demo_seed.py
"""
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")

# Allow running from project root (python backend/run_demo_seed.py)
sys.path.insert(0, str(Path(__file__).parent))

from seeds.demo_stores import up  # noqa: E402


async def main():
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("Error: MONGO_URL and DB_NAME must be set in .env")
        sys.exit(1)
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    result = await up(db)
    client.close()
    print(f"Done: {result['merchants']} merchants, {result['stores']} stores, {result['products']} products")


if __name__ == "__main__":
    asyncio.run(main())
