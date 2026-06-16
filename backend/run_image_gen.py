"""Standalone runner for the generate_product_images seed.

Usage (from the backend/ directory):
    MONGO_URL=... DB_NAME=... TOGETHER_API_KEY=... \\
    CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... CLOUDINARY_API_SECRET=... \\
    python run_image_gen.py
"""
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")

# Ensure backend/ is on the path so seeds.* and services.* resolve correctly.
sys.path.insert(0, str(Path(__file__).parent))

from seeds.generate_product_images import up  # noqa: E402


async def main():
    for var in ("MONGO_URL", "CLOUDINARY_CLOUD_NAME",
                "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"):
        if not os.environ.get(var):
            print(f"Error: {var} is not set")
            sys.exit(1)

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "bharat_fashion_os")]

    result = await up(
        db,
        together_api_key=os.environ.get("TOGETHER_API_KEY"),
        cloudinary_env={
            "cloud_name": os.environ["CLOUDINARY_CLOUD_NAME"],
            "api_key":    os.environ["CLOUDINARY_API_KEY"],
            "api_secret": os.environ["CLOUDINARY_API_SECRET"],
        },
    )
    client.close()
    print(f"Result: {result}")


if __name__ == "__main__":
    asyncio.run(main())
