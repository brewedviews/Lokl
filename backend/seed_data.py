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
     "image": "https://images.unsplash.com/photo-1611923134239-b9be5816e23d?w=600&auto=format&fit=crop&q=80"},
    {"id": "l1-beauty",      "name": "Beauty",      "slug": "beauty",      "order": 7,
     "image": "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&auto=format&fit=crop&q=80"},
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
