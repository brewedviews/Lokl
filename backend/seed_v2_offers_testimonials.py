"""Seed initial offers + testimonials for Lokl V2 homepage."""
import asyncio, os, uuid
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

OFFERS = [
    {"title": "Summer Fashion Sale", "subtitle": "Up to 40% off",
     "cta_label": "Shop now", "cta_link": "/products", "background": "#0A1F5C",
     "image": "https://images.unsplash.com/photo-1618375601660-3e6842f5b791?w=800&q=80", "rank": 10},
    {"title": "Women's Collection", "subtitle": "Starting ₹499",
     "cta_label": "Explore", "cta_link": "/products?gender=women", "background": "#F59E0B",
     "image": "https://images.unsplash.com/photo-1612782809364-17727da6669c?w=800&q=80", "rank": 20},
    {"title": "Footwear Fest", "subtitle": "Flat 20% off",
     "cta_label": "Step in", "cta_link": "/products?l1=l1-footwear", "background": "#10B981",
     "image": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=80", "rank": 30},
    {"title": "Kids Fashion Week", "subtitle": "Buy 2 Get 1",
     "cta_label": "Shop kids", "cta_link": "/products?l1=l1-kids", "background": "#EF4444",
     "image": "https://images.unsplash.com/photo-1503944583220-79d8926ad5e2?w=800&q=80", "rank": 40},
]

TESTIMONIALS = [
    {"name": "Priya S.", "city": "Bhilai", "rating": 5,
     "quote": "Delivery was faster than expected — got my Saturday outfit in 38 minutes!",
     "avatar": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80", "rank": 10},
    {"name": "Ritika M.", "city": "Bhilai", "rating": 5,
     "quote": "Loved the doorstep trial — kept the kurti, returned the one that didn't fit.",
     "avatar": "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&q=80", "rank": 20},
    {"name": "Karan T.", "city": "Bhilai", "rating": 5,
     "quote": "Better than any mall trip. Five stores, one delivery, paid cash. Magic.",
     "avatar": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&q=80", "rank": 30},
    {"name": "Anjali V.", "city": "Bhilai", "rating": 4,
     "quote": "Found a beautiful saree from a boutique I'd never have walked into. Lokl gets it.",
     "avatar": "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&q=80", "rank": 40},
]


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    if await db.offers.count_documents({}) == 0:
        for o in OFFERS:
            await db.offers.insert_one({
                "id": f"off-{uuid.uuid4().hex[:8]}", **o, "published": True,
                "expires_at": None, "created_at": datetime.now(timezone.utc).isoformat(),
            })
        print(f"Seeded {len(OFFERS)} offers")
    else:
        print("Offers already seeded")
    if await db.testimonials.count_documents({}) == 0:
        for t in TESTIMONIALS:
            await db.testimonials.insert_one({
                "id": f"tes-{uuid.uuid4().hex[:8]}", **t, "published": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        print(f"Seeded {len(TESTIMONIALS)} testimonials")
    else:
        print("Testimonials already seeded")


if __name__ == "__main__":
    asyncio.run(main())
