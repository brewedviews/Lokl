"""L1/L2 category taxonomy and seed helpers."""
from datetime import datetime, timezone

NOW = datetime.now(timezone.utc).isoformat()

# Level-1 categories — fixed, top of nav
L1_CATEGORIES = [
    {"id": "l1-women",       "name": "Women",       "slug": "women",       "order": 1,
     "image": "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=600&auto=format&fit=crop&q=80"},
    {"id": "l1-men",         "name": "Men",         "slug": "men",         "order": 2,
     "image": "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=600&auto=format&fit=crop&q=80"},
    {"id": "l1-footwear",    "name": "Footwear",    "slug": "footwear",    "order": 3,
     "image": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80"},
    {"id": "l1-streetwear",  "name": "Streetwear",  "slug": "streetwear",  "order": 4,
     "image": "https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=600&auto=format&fit=crop&q=80"},
    {"id": "l1-kids",        "name": "Kids",        "slug": "kids",        "order": 5,
     "image": "https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=600&auto=format&fit=crop&q=80"},
    {"id": "l1-accessories", "name": "Accessories", "slug": "accessories", "order": 6,
     "image": "https://images.unsplash.com/photo-1492707892479-7bc8d5a4ee93?w=600&auto=format&fit=crop&q=80"},
    {"id": "l1-beauty",      "name": "Beauty",      "slug": "beauty",      "order": 7,
     "image": "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&auto=format&fit=crop&q=80"},
    {"id": "l1-electronics", "name": "Electronics", "slug": "electronics", "order": 8,
     "image": "https://images.unsplash.com/photo-1498049794561-7780e7231661?w=600&auto=format&fit=crop&q=80"},
    {"id": "l1-sports",      "name": "Sports",      "slug": "sports",      "order": 9,
     "image": "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=600&auto=format&fit=crop&q=80"},
]

# Level-2 sub-categories — only for Women and Men
L2_BY_L1 = {
    "l1-women": [
        {"id": "l2-w-topwear",    "name": "Top wear",     "slug": "topwear",
         "image": "https://images.unsplash.com/photo-1564257631407-4deb1f99d992?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-w-bottomwear", "name": "Bottom wear",  "slug": "bottomwear",
         "image": "https://images.unsplash.com/photo-1551803091-e20673f15770?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-w-dresses",    "name": "Dresses",      "slug": "dresses",
         "image": "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-w-ethnic",     "name": "Ethnic wear",  "slug": "ethnic",
         "image": "https://images.unsplash.com/photo-1610189012906-4c0aa9b9781e?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-w-athleisure", "name": "Athleisure",   "slug": "athleisure",
         "image": "https://images.unsplash.com/photo-1518611012118-696072aa579a?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-w-lingerie",   "name": "Lingerie",     "slug": "lingerie",
         "image": "https://images.unsplash.com/photo-1571513722275-4b41940f54b8?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-w-sleepwear",  "name": "Sleepwear",    "slug": "sleepwear",
         "image": "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-w-formals",    "name": "Formals",      "slug": "formals",
         "image": "https://images.unsplash.com/photo-1551803091-e20673f15770?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-w-footwear",   "name": "Footwear",     "slug": "w-footwear",
         "image": "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&auto=format&fit=crop&q=80"},
    ],
    "l1-men": [
        {"id": "l2-m-shirt",      "name": "Shirts",        "slug": "shirts",
         "image": "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-m-tshirt",     "name": "T-shirts",      "slug": "tshirts",
         "image": "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-m-pants",      "name": "Pants & Trousers", "slug": "pants",
         "image": "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-m-ethnic",     "name": "Ethnic wear",   "slug": "ethnic",
         "image": "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-m-jeans",      "name": "Jeans",         "slug": "jeans",
         "image": "https://images.unsplash.com/photo-1542272604-787c3835535d?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-m-shorts",     "name": "Shorts",        "slug": "shorts",
         "image": "https://images.unsplash.com/photo-1591195853828-11db59a44f6b?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-m-activewear", "name": "Active wear",   "slug": "activewear",
         "image": "https://images.unsplash.com/photo-1483721310020-03333e577078?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-m-innerwear",  "name": "Inner wear",    "slug": "innerwear",
         "image": "https://images.unsplash.com/photo-1602810316693-3667c854239a?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-m-footwear",   "name": "Footwear",      "slug": "m-footwear",
         "image": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&auto=format&fit=crop&q=80"},
    ],
    "l1-electronics": [
        {"id": "l2-e-mobiles",       "name": "Mobiles & Tablets", "slug": "mobiles",
         "image": "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-e-laptops",       "name": "Laptops & Computers", "slug": "laptops",
         "image": "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-e-audio",         "name": "Headphones & Audio", "slug": "audio",
         "image": "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-e-wearables",     "name": "Smartwatches & Wearables", "slug": "wearables",
         "image": "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-e-cameras",       "name": "Cameras", "slug": "cameras",
         "image": "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-e-tv",            "name": "TV & Home Entertainment", "slug": "tv",
         "image": "https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-e-large-appl",    "name": "Large Appliances", "slug": "large-appliances",
         "image": "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-e-kitchen-appl",  "name": "Kitchen Appliances", "slug": "kitchen-appliances",
         "image": "https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-e-small-appl",    "name": "Small Appliances", "slug": "small-appliances",
         "image": "https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-e-personal-care", "name": "Personal Care Appliances", "slug": "personal-care",
         "image": "https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-e-accessories",   "name": "Mobile & Computer Accessories", "slug": "e-accessories",
         "image": "https://images.unsplash.com/photo-1625948515291-69613efd103f?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-e-gaming",        "name": "Gaming", "slug": "gaming",
         "image": "https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?w=400&auto=format&fit=crop&q=80"},
    ],
    "l1-sports": [
        {"id": "l2-s-fitness",       "name": "Gym & Fitness", "slug": "fitness",
         "image": "https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-s-yoga",          "name": "Yoga", "slug": "yoga",
         "image": "https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-s-cricket",       "name": "Cricket", "slug": "cricket",
         "image": "https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-s-football",      "name": "Football", "slug": "football",
         "image": "https://images.unsplash.com/photo-1551958219-acbc608c6377?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-s-badminton",     "name": "Badminton & Tennis", "slug": "racket",
         "image": "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-s-cycling",       "name": "Cycling", "slug": "cycling",
         "image": "https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-s-running",       "name": "Running & Athletics", "slug": "running",
         "image": "https://images.unsplash.com/photo-1571008887538-b36bb32f4571?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-s-outdoor",       "name": "Outdoor & Camping", "slug": "outdoor",
         "image": "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-s-swimming",      "name": "Swimming", "slug": "swimming",
         "image": "https://images.unsplash.com/photo-1530549387789-4c1017266635?w=400&auto=format&fit=crop&q=80"},
        {"id": "l2-s-supplements",   "name": "Sports Nutrition", "slug": "supplements",
         "image": "https://images.unsplash.com/photo-1593095948071-474c5cc2989d?w=400&auto=format&fit=crop&q=80"},
    ],
}


def build_seed_docs():
    """Returns (categories, l2_subs)"""
    cats = [{**c, "created_at": NOW} for c in L1_CATEGORIES]
    l2s = []
    for l1_id, subs in L2_BY_L1.items():
        for s in subs:
            l2s.append({**s, "l1_id": l1_id, "created_at": NOW})
    return cats, l2s


# Genders supported on L1 categories without L2 (Footwear/Streetwear/Kids/Accessories/Beauty)
GENDERS = ["women", "men", "unisex", "kids"]
