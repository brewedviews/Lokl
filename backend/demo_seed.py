"""Demo-data seeder for Lokl — 10 Bhilai stores + 50 products covering all L1/L2.

Run: `python -m demo_seed` (idempotent — wipes & re-seeds demo docs only).

Stores are spread across real Bhilai areas. Each merchant has KYC approved,
storefront published, paused=false. Products carry image URLs (no base64 in
demo) plus realistic stock + sizing matched to category.
"""
import asyncio
import os
import random
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from motor.motor_asyncio import AsyncIOMotorClient
from auth import hash_password

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

NOW = datetime.now(timezone.utc).isoformat()

# Bhilai localities (real)
BHILAI_AREAS = [
    "Sector 1", "Sector 6", "Sector 10", "Civic Centre", "Smriti Nagar",
    "Nehru Nagar", "Supela", "Power House", "Junwani", "Kohka",
]

STORES = [
    {"slug": "anjali-store",       "name": "Anjali Store",          "area": "Sector 10",   "specialty": "Designer kurtas & sarees",
     "banner": "https://images.unsplash.com/photo-1610189012906-4c0aa9b9781e?w=1200&q=80",
     "tagline": "Curated ethnic wear for modern women", "story": "Family-run store since 1998, hand-picked from Surat, Banaras & Jaipur."},
    {"slug": "menscape",              "name": "Menscape",                 "area": "Civic Centre","specialty": "Men's formal & casual",
     "banner": "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=1200&q=80",
     "tagline": "Sharp wardrobe essentials for the Bhilai man", "story": "Stocked with brands from Mumbai & Bengaluru — trial at your doorstep."},
    {"slug": "step-sole",             "name": "Step & Sole",              "area": "Sector 6",    "specialty": "Footwear for the family",
     "banner": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1200&q=80",
     "tagline": "Sneakers, heels, sandals — all under one roof", "story": "200+ models from leading brands & local artisans."},
    {"slug": "street-bazaar",         "name": "Street Bazaar",            "area": "Supela",      "specialty": "Streetwear & graphic tees",
     "banner": "https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=1200&q=80",
     "tagline": "Drop-fresh streetwear without the metro markup", "story": "Curated drops every Friday."},
    {"slug": "little-stars",          "name": "Little Stars",             "area": "Smriti Nagar","specialty": "Kids & toddler clothing",
     "banner": "https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=1200&q=80",
     "tagline": "Soft fabrics, bright styles, happy kids", "story": "All certified safe dyes & breathable fabrics."},
    {"slug": "shringar-accessories",  "name": "Shringaar Accessories",    "area": "Nehru Nagar", "specialty": "Bags, jewelry & sunglasses",
     "banner": "https://images.unsplash.com/photo-1492707892479-7bc8d5a4ee93?w=1200&q=80",
     "tagline": "Finish your look", "story": "Imported & artisan accessories."},
    {"slug": "glow-co",               "name": "Glow & Co.",               "area": "Sector 1",    "specialty": "Beauty & skincare",
     "banner": "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=1200&q=80",
     "tagline": "K-Beauty, India-clean", "story": "Cruelty-free, derm-tested."},
    {"slug": "techworld-bhilai",      "name": "TechWorld Bhilai",         "area": "Power House", "specialty": "Mobiles, laptops & gadgets",
     "banner": "https://images.unsplash.com/photo-1498049794561-7780e7231661?w=1200&q=80",
     "tagline": "Authorised dealer · 1-yr warranty on all", "story": "Latest mobiles, laptops, audio."},
    {"slug": "homeplus-appliances",   "name": "HomePlus Appliances",      "area": "Junwani",     "specialty": "Large & kitchen appliances",
     "banner": "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1200&q=80",
     "tagline": "Make every home a smart home", "story": "Free installation across Bhilai."},
    {"slug": "playfield-sports",      "name": "Playfield Sports",         "area": "Kohka",       "specialty": "Sports gear & fitness",
     "banner": "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=1200&q=80",
     "tagline": "Gear up. Show up. Win.", "story": "Cricket, badminton, cycling, gym — official brands."},
]

# 50 products mapping
APPAREL_SIZES = ["S", "M", "L", "XL"]
FOOTWEAR_SIZES_M = ["7", "8", "9", "10", "11"]
FOOTWEAR_SIZES_W = ["5", "6", "7", "8"]
KIDS_SIZES = ["2-3Y", "3-4Y", "5-6Y", "7-8Y"]


def apparel_stock(sizes):
    return {s: random.randint(2, 8) for s in sizes}


def one_size_stock(n=10):
    return {"OS": n}


# (store_slug, name, l1, l2|None, gender|None, price, mrp, image, sizes_or_None, stock_or_None)
PRODUCTS = [
    # ── Anjali Store — Women ── 6 products
    ("anjali-store", "Anarkali Kurta Set",      "l1-women", "l2-w-ethnic",     None, 2799, 3999, "https://images.unsplash.com/photo-1610189012906-4c0aa9b9781e?w=600&q=80", APPAREL_SIZES, None),
    ("anjali-store", "Banarasi Silk Saree",     "l1-women", "l2-w-ethnic",     None, 4499, 6999, "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=600&q=80", None, one_size_stock(8)),
    ("anjali-store", "Cotton A-line Dress",     "l1-women", "l2-w-dresses",    None, 1499, 2299, "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=600&q=80", APPAREL_SIZES, None),
    ("anjali-store", "Floral Maxi Dress",       "l1-women", "l2-w-dresses",    None, 1899, 2799, "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=600&q=80", APPAREL_SIZES, None),
    ("anjali-store", "Linen Co-ord Set",        "l1-women", "l2-w-topwear",    None, 2299, 3299, "https://images.unsplash.com/photo-1564257631407-4deb1f99d992?w=600&q=80", APPAREL_SIZES, None),
    ("anjali-store", "Lehenga Choli Festive",   "l1-women", "l2-w-ethnic",     None, 5999, 8999, "https://images.unsplash.com/photo-1610189012906-4c0aa9b9781e?w=600&q=80&fit=crop", APPAREL_SIZES, None),

    # ── Menscape — Men ── 6 products
    ("menscape",       "Slim-fit Cotton Shirt",   "l1-men",   "l2-m-shirt",      None, 1199, 1799, "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=600&q=80", APPAREL_SIZES, None),
    ("menscape",       "Linen Casual Shirt",      "l1-men",   "l2-m-shirt",      None, 1399, 2099, "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&q=80", APPAREL_SIZES, None),
    ("menscape",       "Graphic Tee Pack of 2",   "l1-men",   "l2-m-tshirt",     None, 899,  1399, "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&q=80&fit=crop", APPAREL_SIZES, None),
    ("menscape",       "Chino Trousers",          "l1-men",   "l2-m-pants",      None, 1499, 2199, "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=600&q=80", APPAREL_SIZES, None),
    ("menscape",       "Slim Tapered Jeans",      "l1-men",   "l2-m-jeans",      None, 1799, 2599, "https://images.unsplash.com/photo-1542272604-787c3835535d?w=600&q=80", APPAREL_SIZES, None),
    ("menscape",       "Kurta Pajama Set",        "l1-men",   "l2-m-ethnic",     None, 1999, 2999, "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=600&q=80&fit=crop", APPAREL_SIZES, None),

    # ── Step & Sole — Footwear ── 6 products
    ("step-sole",      "Classic White Sneakers",  "l1-footwear", None, "unisex", 1599, 2299, "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&q=80", FOOTWEAR_SIZES_M, None),
    ("step-sole",      "Running Sport Shoes",     "l1-footwear", None, "men",    1999, 2999, "https://images.unsplash.com/photo-1556906781-9a412961c28c?w=600&q=80", FOOTWEAR_SIZES_M, None),
    ("step-sole",      "Block Heel Sandals",      "l1-footwear", None, "women",  1299, 1899, "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600&q=80", FOOTWEAR_SIZES_W, None),
    ("step-sole",      "Leather Brogues",         "l1-footwear", None, "men",    2499, 3499, "https://images.unsplash.com/photo-1614252369475-531eba835eb1?w=600&q=80", FOOTWEAR_SIZES_M, None),
    ("step-sole",      "Ballerina Flats",         "l1-footwear", None, "women",  999,  1499, "https://images.unsplash.com/photo-1573100925118-870b8efc799d?w=600&q=80", FOOTWEAR_SIZES_W, None),
    ("step-sole",      "Kids School Shoes",       "l1-footwear", None, "kids",   799,  1199, "https://images.unsplash.com/photo-1551107696-a4b0c5a0d9a2?w=600&q=80", ["1","2","3","4"], None),

    # ── Street Bazaar — Streetwear ── 5 products
    ("street-bazaar",  "Oversized Graphic Hoodie","l1-streetwear", None, "unisex", 1499, 2199, "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=600&q=80", APPAREL_SIZES, None),
    ("street-bazaar",  "Cargo Pants",             "l1-streetwear", None, "men",    1399, 1999, "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=600&q=80", APPAREL_SIZES, None),
    ("street-bazaar",  "Bomber Jacket",           "l1-streetwear", None, "unisex", 2299, 3299, "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=600&q=80", APPAREL_SIZES, None),
    ("street-bazaar",  "Tie-Dye Tee",             "l1-streetwear", None, "unisex", 699,  999,  "https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=600&q=80", APPAREL_SIZES, None),
    ("street-bazaar",  "Distressed Denim Jacket", "l1-streetwear", None, "unisex", 2599, 3699, "https://images.unsplash.com/photo-1543087903-1ac2ec7aa8c5?w=600&q=80", APPAREL_SIZES, None),

    # ── Little Stars — Kids ── 5 products
    ("little-stars",   "Rainbow Tee & Shorts Set","l1-kids",     None, "kids", 599,  899,  "https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=600&q=80", KIDS_SIZES, None),
    ("little-stars",   "Princess Frock",          "l1-kids",     None, "kids", 899,  1299, "https://images.unsplash.com/photo-1518831959646-742c3b6dd5c4?w=600&q=80", KIDS_SIZES, None),
    ("little-stars",   "Dino Print Pyjama Set",   "l1-kids",     None, "kids", 499,  799,  "https://images.unsplash.com/photo-1545558014-8692077e9b5c?w=600&q=80", KIDS_SIZES, None),
    ("little-stars",   "Denim Dungarees",         "l1-kids",     None, "kids", 999,  1499, "https://images.unsplash.com/photo-1602610170902-7bc8ea08e8b1?w=600&q=80", KIDS_SIZES, None),
    ("little-stars",   "Hooded Sweatshirt",       "l1-kids",     None, "kids", 749,  1099, "https://images.unsplash.com/photo-1503944583220-79d8926ad5e2?w=600&q=80", KIDS_SIZES, None),

    # ── Shringaar Accessories ── 5 products
    ("shringar-accessories", "Tan Leather Handbag",       "l1-accessories", None, "women",  1899, 2799, "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=600&q=80", None, one_size_stock(12)),
    ("shringar-accessories", "Polarized Sunglasses",      "l1-accessories", None, "unisex", 999,  1499, "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=600&q=80", None, one_size_stock(20)),
    ("shringar-accessories", "Statement Earrings",        "l1-accessories", None, "women",  599,  899,  "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=600&q=80", None, one_size_stock(15)),
    ("shringar-accessories", "Mens Leather Wallet",       "l1-accessories", None, "men",    899,  1299, "https://images.unsplash.com/photo-1627123424574-724758594e93?w=600&q=80", None, one_size_stock(18)),
    ("shringar-accessories", "Silk Scarf",                "l1-accessories", None, "women",  699,  999,  "https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=600&q=80", None, one_size_stock(10)),

    # ── Glow & Co. — Beauty ── 5 products
    ("glow-co",        "Vitamin C Serum",         "l1-beauty",   None, "women",  1499, 1999, "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600&q=80", None, one_size_stock(25)),
    ("glow-co",        "Hyaluronic Acid Moisturizer","l1-beauty",None, "unisex", 1299, 1799, "https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?w=600&q=80", None, one_size_stock(20)),
    ("glow-co",        "Matte Lipstick Set",      "l1-beauty",   None, "women",  999,  1499, "https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=600&q=80", None, one_size_stock(15)),
    ("glow-co",        "Sunscreen SPF 50",        "l1-beauty",   None, "unisex", 699,  999,  "https://images.unsplash.com/photo-1556227703-7b5e2f9d6d4f?w=600&q=80", None, one_size_stock(30)),
    ("glow-co",        "Eyeshadow Palette",       "l1-beauty",   None, "women",  1799, 2499, "https://images.unsplash.com/photo-1583241800698-9c2c87a06f30?w=600&q=80", None, one_size_stock(10)),

    # ── TechWorld — Electronics (mobile/laptop/audio/wearable) ── 6 products
    ("techworld-bhilai", "Smartphone 5G 128GB",      "l1-electronics", "l2-e-mobiles",   None, 24999, 28999, "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&q=80", None, one_size_stock(10)),
    ("techworld-bhilai", "Laptop 14\" i5/16GB",       "l1-electronics", "l2-e-laptops",   None, 59999, 69999, "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&q=80", None, one_size_stock(5)),
    ("techworld-bhilai", "Wireless ANC Headphones", "l1-electronics", "l2-e-audio",     None, 4999,  7999,  "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80", None, one_size_stock(12)),
    ("techworld-bhilai", "Smartwatch Series 7",     "l1-electronics", "l2-e-wearables", None, 12999, 16999, "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80", None, one_size_stock(8)),
    ("techworld-bhilai", "Bluetooth Speaker",       "l1-electronics", "l2-e-audio",     None, 2999,  3999,  "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=600&q=80", None, one_size_stock(15)),
    ("techworld-bhilai", "Gaming Controller",       "l1-electronics", "l2-e-gaming",    None, 3499,  4499,  "https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?w=600&q=80", None, one_size_stock(10)),

    # ── HomePlus — Appliances ── 5 products
    ("homeplus-appliances", "55\" Smart 4K TV",        "l1-electronics", "l2-e-tv",            None, 34999, 44999, "https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=600&q=80", None, one_size_stock(4)),
    ("homeplus-appliances", "Front-load Washing Machine","l1-electronics","l2-e-large-appl",   None, 28999, 36999, "https://images.unsplash.com/photo-1626806787461-102c1a59f1d6?w=600&q=80", None, one_size_stock(6)),
    ("homeplus-appliances", "Double-door Refrigerator","l1-electronics", "l2-e-large-appl",    None, 32999, 41999, "https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?w=600&q=80", None, one_size_stock(5)),
    ("homeplus-appliances", "Microwave Oven 25L",      "l1-electronics", "l2-e-kitchen-appl",  None, 9999,  12999, "https://images.unsplash.com/photo-1574269909862-7e1d70bb8078?w=600&q=80", None, one_size_stock(10)),
    ("homeplus-appliances", "Air Fryer 4.5L",          "l1-electronics", "l2-e-small-appl",    None, 5999,  7999,  "https://images.unsplash.com/photo-1647467663474-1a45a37b8b0a?w=600&q=80", None, one_size_stock(12)),

    # ── Playfield Sports ── 6 products
    ("playfield-sports", "Cricket Bat — English Willow","l1-sports", "l2-s-cricket",  None, 3999, 5999, "https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=600&q=80", None, one_size_stock(8)),
    ("playfield-sports", "Football Match-grade",         "l1-sports", "l2-s-football", None, 1499, 1999, "https://images.unsplash.com/photo-1551958219-acbc608c6377?w=600&q=80", None, one_size_stock(15)),
    ("playfield-sports", "Badminton Racquet Pack",       "l1-sports", "l2-s-badminton",None, 2499, 3499, "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=600&q=80", None, one_size_stock(10)),
    ("playfield-sports", "Yoga Mat 6mm",                 "l1-sports", "l2-s-yoga",     None, 999,  1499, "https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=600&q=80", None, one_size_stock(25)),
    ("playfield-sports", "Dumbbell Pair 5kg",            "l1-sports", "l2-s-fitness",  None, 1799, 2299, "https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=600&q=80", None, one_size_stock(20)),
    ("playfield-sports", "Cycling Helmet",               "l1-sports", "l2-s-cycling",  None, 1999, 2799, "https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=600&q=80", None, one_size_stock(12)),
]


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # Wipe existing demo docs (anything we own)
    demo_emails = [f"{s['slug']}@lokl.demo" for s in STORES]
    demo_mids = [f"mer-demo-{s['slug']}" for s in STORES]
    demo_sids = [f"store-m-{m}" for m in demo_mids]
    await db.merchants.delete_many({"email": {"$in": demo_emails}})
    await db.stores.delete_many({"id": {"$in": demo_sids}})
    await db.products.delete_many({"merchant_id": {"$in": demo_mids}})

    # Re-create stores
    slug_to_mid = {}
    slug_to_sid = {}
    # Coordinates for Bhilai (approx)
    BHILAI_LAT, BHILAI_LNG = 21.1938, 81.3509
    for s in STORES:
        mid = f"mer-demo-{s['slug']}"
        sid = f"store-m-{mid}"
        slug_to_mid[s["slug"]] = mid
        slug_to_sid[s["slug"]] = sid
        rating = round(random.uniform(4.2, 4.9), 1)
        reviews = random.randint(40, 320)
        distance_km = round(random.uniform(1.0, 7.5), 1)
        eta_min = random.choice([30, 35, 40, 45, 50])

        merchant_doc = {
            "id": mid,
            "email": f"{s['slug']}@lokl.demo",
            "password_hash": hash_password("Demo@2026"),
            "store_name": s["name"],
            "owner_name": f"{s['name']} Owner",
            "phone": f"9{random.randint(700000000, 999999999)}",
            "city": "Bhilai",
            "business_address": f"{s['area']}, Bhilai 490006",
            "business_category": s["specialty"],
            "business_type": "Pvt Ltd",
            "pan_number": f"DEMO{random.randint(1000,9999)}D",
            "gst_number": f"22DEMO{random.randint(1000,9999)}D1Z5",
            "bank_account_number": str(random.randint(10000000, 99999999)),
            "bank_ifsc": "SBIN0001234",
            "account_holder_name": f"{s['name']} Pvt Ltd",
            "created_at": NOW,
            "role": "merchant",
            "kyc_status": "approved",
            "kyc_submitted_at": NOW,
            "approved_at": NOW,
            "published": True,
            "paused": False,
            "product_count": 0,
            "rating": rating,
            "reviews": reviews,
            "distance_km": distance_km,
            "eta_min": eta_min,
            "image": s["banner"],
            "storefront": {
                "tagline": s["tagline"],
                "story":   s["story"],
                "banner":  s["banner"],
                "specialties": [s["specialty"]],
            },
            "notifications": [],
        }
        await db.merchants.insert_one(merchant_doc)

        # Public storefront doc (consumed by /api/stores, /api/products)
        store_doc = {
            "id": sid,
            "merchant_id": mid,
            "name": s["name"],
            "slug": s["slug"],
            "area": s["area"],
            "address": f"{s['area']}, Bhilai 490006",
            "city": "Bhilai",
            "tagline": s["tagline"],
            "story": s["story"],
            "banner": s["banner"],
            "image": s["banner"],
            "specialties": [s["specialty"]],
            "lat": BHILAI_LAT + random.uniform(-0.05, 0.05),
            "lng": BHILAI_LNG + random.uniform(-0.05, 0.05),
            "distance_km": distance_km,
            "eta_min": eta_min,
            "rating": rating,
            "reviews": reviews,
            "trusted": True,
            "kyc_status": "approved",
            "published": True,
            "paused": False,
            "product_count": 0,  # updated after products inserted
            "created_at": NOW,
            "live_at": NOW,
        }
        await db.stores.insert_one(store_doc)

    # Re-create products
    for store_slug, name, l1, l2, gender, price, mrp, image, sizes, stock in PRODUCTS:
        mid = slug_to_mid[store_slug]
        sid = slug_to_sid[store_slug]
        if stock is None:
            stock = apparel_stock(sizes) if sizes else one_size_stock(10)
            sz = sizes if sizes else list(stock.keys())
        else:
            sz = sizes if sizes else list(stock.keys())
        pid = f"prod-demo-{uuid.uuid4().hex[:8]}"
        await db.products.insert_one({
            "id": pid,
            "merchant_id": mid,
            "store_id": sid,
            "name": name,
            "description": f"{name} — curated by {next(s['name'] for s in STORES if s['slug']==store_slug)}.",
            "l1_id": l1, "l2_id": l2, "gender": gender,
            "price": float(price), "mrp": float(mrp),
            "image": image,
            "sizes": sz, "stock": stock,
            "created_at": NOW,
            "rating": round(random.uniform(4.0, 4.9), 1),
            "paused": False,
        })

    # Update product_count per merchant + store
    for slug, mid in slug_to_mid.items():
        sid = slug_to_sid[slug]
        cnt = await db.products.count_documents({"store_id": sid, "paused": {"$ne": True}})
        await db.merchants.update_one({"id": mid}, {"$set": {"product_count": cnt}})
        await db.stores.update_one({"id": sid}, {"$set": {"product_count": cnt}})

    cnt_stores = await db.merchants.count_documents({"email": {"$regex": "@lokl.demo$"}})
    cnt_products = await db.products.count_documents({"id": {"$regex": "^prod-demo-"}})
    print(f"✓ Seeded {cnt_stores} stores · {cnt_products} products")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
