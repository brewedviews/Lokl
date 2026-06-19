import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os

async def main():
    client = AsyncIOMotorClient(os.environ.get('MONGO_URL', 'mongodb://localhost:27017'))
    db = client['bharat_fashion_os']

    cats = await db.categories.find({}, {'_id': 0, 'id': 1, 'name': 1, 'slug': 1}).to_list(20)
    print('CATEGORIES:', cats)

    subs = await db.subcategories.find({}, {'_id': 0, 'id': 1, 'name': 1, 'slug': 1, 'l1_id': 1, 'l1_slug': 1}).to_list(30)
    print('SUBCATEGORIES:', subs)

    prod = await db.products.find_one({}, {'_id': 0, 'name': 1, 'category': 1, 'subcategory': 1, 'l1_id': 1, 'l2_id': 1, 'category_id': 1})
    print('SAMPLE PRODUCT:', prod)

    pipeline = [{'$group': {'_id': '$category', 'count': {'$sum': 1}}}]
    cats_used = await db.products.aggregate(pipeline).to_list(20)
    print('PRODUCT CATEGORY DISTRIBUTION:', cats_used)

    client.close()

asyncio.run(main())
