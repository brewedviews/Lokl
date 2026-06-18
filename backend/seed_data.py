"""L1/L2 category taxonomy and seed helpers."""
from datetime import datetime, timezone

NOW = datetime.now(timezone.utc).isoformat()

# Level-1 categories — fixed, top of nav
L1_CATEGORIES = [
    {"id": "l1-women",    "name": "Women",               "slug": "women",      "order": 1,
     "image": "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&q=80",
     "gender_default": "women"},
    {"id": "l1-men",      "name": "Men",                 "slug": "men",        "order": 2,
     "image": "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=600&q=80",
     "gender_default": "men"},
    {"id": "l1-ethnic",   "name": "Ethnic Wear",         "slug": "ethnic",     "order": 3,
     "image": "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=600&q=80",
     "gender_default": "unisex"},
    {"id": "l1-footwear", "name": "Footwear",            "slug": "footwear",   "order": 4,
     "image": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&q=80",
     "gender_default": "unisex"},
    {"id": "l1-lingerie", "name": "Lingerie & Innerwear","slug": "lingerie",   "order": 5,
     "image": "https://images.unsplash.com/photo-1604176424472-17cd740f6974?w=600&q=80",
     "gender_default": "women"},
    {"id": "l1-kids",     "name": "Kids",                "slug": "kids",       "order": 6,
     "image": "https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=600&q=80",
     "gender_default": "kids"},
    {"id": "l1-accessories", "name": "Accessories",      "slug": "accessories","order": 7,
     "image": "https://images.unsplash.com/photo-1492707892479-7bc8d5a4ee93?w=600&q=80",
     "gender_default": "unisex"},
    {"id": "l1-beauty",   "name": "Beauty",              "slug": "beauty",     "order": 8,
     "image": "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&q=80",
     "gender_default": "unisex"},
    {"id": "l1-sports",   "name": "Sports",              "slug": "sports",     "order": 9,
     "image": "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=600&q=80",
     "gender_default": "unisex"},
]

# Level-2 sub-categories
L2_BY_L1 = {
    "l1-women": [
        {"id": "l2-women-dresses",    "name": "Dresses",     "slug": "dresses",    "order": 1},
        {"id": "l2-women-tops",       "name": "Tops",        "slug": "tops",       "order": 2},
        {"id": "l2-women-bottoms",    "name": "Bottoms",     "slug": "bottoms",    "order": 3},
        {"id": "l2-women-formals",    "name": "Formals",     "slug": "formals",    "order": 4},
        {"id": "l2-women-activewear", "name": "Active Wear", "slug": "activewear", "order": 5},
        {"id": "l2-women-sleepwear",  "name": "Sleepwear",   "slug": "sleepwear",  "order": 6},
        {"id": "l2-women-footwear",   "name": "Footwear",    "slug": "footwear",   "order": 7},
        {"id": "l2-women-ethnic",     "name": "Ethnic Wear", "slug": "ethnic-wear","order": 8},
        {"id": "l2-women-lingerie",   "name": "Lingerie",    "slug": "lingerie",   "order": 9},
    ],
    "l1-men": [
        {"id": "l2-men-tshirts",      "name": "T-Shirts",    "slug": "tshirts",    "order": 1},
        {"id": "l2-men-jeans",        "name": "Jeans",       "slug": "jeans",      "order": 2},
        {"id": "l2-men-shirts",       "name": "Shirts",      "slug": "shirts",     "order": 3},
        {"id": "l2-men-innerwear",    "name": "Inner Wear",  "slug": "innerwear",  "order": 4},
        {"id": "l2-men-activewear",   "name": "Active Wear", "slug": "activewear", "order": 5},
        {"id": "l2-men-footwear",     "name": "Footwear",    "slug": "footwear",   "order": 6},
        {"id": "l2-men-ethnic",       "name": "Ethnic Wear", "slug": "ethnic-wear","order": 7},
        {"id": "l2-men-polos",        "name": "Polos",       "slug": "polos",      "order": 8},
        {"id": "l2-men-trousers",     "name": "Trousers",    "slug": "trousers",   "order": 9},
    ],
    "l1-ethnic": [
        {"id": "l2-ethnic-women", "name": "Women", "slug": "women", "order": 1},
        {"id": "l2-ethnic-men",   "name": "Men",   "slug": "men",   "order": 2},
    ],
    "l1-footwear": [
        {"id": "l2-footwear-women", "name": "Women", "slug": "women", "order": 1},
        {"id": "l2-footwear-men",   "name": "Men",   "slug": "men",   "order": 2},
    ],
    "l1-lingerie": [
        {"id": "l2-lingerie-women", "name": "Women", "slug": "women", "order": 1},
        {"id": "l2-lingerie-men",   "name": "Men",   "slug": "men",   "order": 2},
    ],
    # No L2 for: Kids, Accessories, Beauty, Sports
}

GENDERS = ["women", "men", "unisex", "kids"]


def build_seed_docs():
    """Returns (categories, l2_subs)"""
    cats = [{**c, "created_at": NOW} for c in L1_CATEGORIES]
    l1_slug_map = {c["id"]: c["slug"] for c in L1_CATEGORIES}
    l2s = []
    for l1_id, subs in L2_BY_L1.items():
        for s in subs:
            l2s.append({
                **s,
                "l1_id": l1_id,
                "l1_slug": l1_slug_map.get(l1_id, ""),
                "created_at": NOW,
            })
    return cats, l2s
