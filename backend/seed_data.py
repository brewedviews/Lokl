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
        {"id": "l2-women-dresses",    "name": "Dresses",               "slug": "dresses",      "order": 1},
        {"id": "l2-women-tops",       "name": "Tops",                  "slug": "tops",         "order": 2},
        {"id": "l2-women-bottoms",    "name": "Bottoms",               "slug": "bottoms",      "order": 3},
        {"id": "l2-women-coords",     "name": "Co-ord Sets",           "slug": "coords",       "order": 4},
        {"id": "l2-women-jumpsuits",  "name": "Jumpsuits & Playsuits", "slug": "jumpsuits",    "order": 5},
        {"id": "l2-women-formals",    "name": "Formals",               "slug": "formals",      "order": 6},
        {"id": "l2-women-activewear", "name": "Active Wear",           "slug": "activewear",   "order": 7},
        {"id": "l2-women-sleepwear",  "name": "Sleepwear",             "slug": "sleepwear",    "order": 8},
        {"id": "l2-women-sweaters",   "name": "Sweaters & Cardigans",  "slug": "sweaters",     "order": 9},
        {"id": "l2-women-jackets",    "name": "Jackets & Coats",       "slug": "jackets",      "order": 10},
        {"id": "l2-women-sarees",     "name": "Sarees & Dupattas",     "slug": "sarees",       "order": 11},
        {"id": "l2-women-kurtas",     "name": "Kurtas & Suits",        "slug": "kurtas",       "order": 12},
    ],
    "l1-men": [
        {"id": "l2-men-tshirts",      "name": "T-Shirts",              "slug": "tshirts",      "order": 1},
        {"id": "l2-men-shirts",       "name": "Shirts",                "slug": "shirts",       "order": 2},
        {"id": "l2-men-jeans",        "name": "Jeans",                 "slug": "jeans",        "order": 3},
        {"id": "l2-men-trousers",     "name": "Trousers",              "slug": "trousers",     "order": 4},
        {"id": "l2-men-shorts",       "name": "Shorts",                "slug": "shorts",       "order": 5},
        {"id": "l2-men-polos",        "name": "Polos",                 "slug": "polos",        "order": 6},
        {"id": "l2-men-formals",      "name": "Formals",               "slug": "formals",      "order": 7},
        {"id": "l2-men-activewear",   "name": "Active Wear",           "slug": "activewear",   "order": 8},
        {"id": "l2-men-sweaters",     "name": "Sweaters & Hoodies",    "slug": "sweaters",     "order": 9},
        {"id": "l2-men-jackets",      "name": "Jackets",               "slug": "jackets",      "order": 10},
        {"id": "l2-men-innerwear",    "name": "Inner Wear",            "slug": "innerwear",    "order": 11},
        {"id": "l2-men-winterwear",   "name": "Winterwear",            "slug": "winterwear",   "order": 12},
    ],
    "l1-ethnic": [
        {"id": "l2-ethnic-sarees",    "name": "Sarees",                "slug": "sarees",       "order": 1},
        {"id": "l2-ethnic-kurtas",    "name": "Kurtas & Kurtis",       "slug": "kurtas",       "order": 2},
        {"id": "l2-ethnic-lehengas",  "name": "Lehengas",              "slug": "lehengas",     "order": 3},
        {"id": "l2-ethnic-sherwanis", "name": "Sherwanis",             "slug": "sherwanis",    "order": 4},
        {"id": "l2-ethnic-salwar",    "name": "Salwar Suits",          "slug": "salwar",       "order": 5},
        {"id": "l2-ethnic-dupattas",  "name": "Dupattas & Stoles",     "slug": "dupattas",     "order": 6},
        {"id": "l2-ethnic-dhoti",     "name": "Dhoti & Mundu",         "slug": "dhoti",        "order": 7},
        {"id": "l2-ethnic-indowest",  "name": "Indo-Western",          "slug": "indo-western", "order": 8},
    ],
    "l1-footwear": [
        {"id": "l2-footwear-casual",  "name": "Casual Shoes",          "slug": "casual",       "order": 1},
        {"id": "l2-footwear-sports",  "name": "Sports & Running",      "slug": "sports",       "order": 2},
        {"id": "l2-footwear-formal",  "name": "Formal Shoes",          "slug": "formal",       "order": 3},
        {"id": "l2-footwear-sandals", "name": "Sandals & Slippers",    "slug": "sandals",      "order": 4},
        {"id": "l2-footwear-heels",   "name": "Heels & Wedges",        "slug": "heels",        "order": 5},
        {"id": "l2-footwear-boots",   "name": "Boots",                 "slug": "boots",        "order": 6},
        {"id": "l2-footwear-ethnic",  "name": "Ethnic Footwear",       "slug": "ethnic",       "order": 7},
        {"id": "l2-footwear-kids",    "name": "Kids Footwear",         "slug": "kids",         "order": 8},
    ],
    "l1-lingerie": [
        {"id": "l2-lingerie-bras",      "name": "Bras",                  "slug": "bras",         "order": 1},
        {"id": "l2-lingerie-briefs",    "name": "Briefs & Panties",      "slug": "briefs",       "order": 2},
        {"id": "l2-lingerie-shapewear", "name": "Shapewear",             "slug": "shapewear",    "order": 3},
        {"id": "l2-lingerie-nightwear", "name": "Sleepwear & Nightwear", "slug": "nightwear",    "order": 4},
        {"id": "l2-lingerie-thermal",   "name": "Thermal Wear",          "slug": "thermal",      "order": 5},
        {"id": "l2-lingerie-mens",      "name": "Men's Innerwear",       "slug": "mens",         "order": 6},
        {"id": "l2-lingerie-socks",     "name": "Socks & Stockings",     "slug": "socks",        "order": 7},
        {"id": "l2-lingerie-swimwear",  "name": "Swimwear",              "slug": "swimwear",     "order": 8},
    ],
    "l1-kids": [
        {"id": "l2-kids-girls",       "name": "Girls Clothing",        "slug": "girls",        "order": 1},
        {"id": "l2-kids-boys",        "name": "Boys Clothing",         "slug": "boys",         "order": 2},
        {"id": "l2-kids-infant",      "name": "Infant & Toddler",      "slug": "infant",       "order": 3},
        {"id": "l2-kids-footwear",    "name": "Kids Footwear",         "slug": "footwear",     "order": 4},
        {"id": "l2-kids-school",      "name": "School Uniforms",       "slug": "school",       "order": 5},
        {"id": "l2-kids-ethnic",      "name": "Kids Ethnic Wear",      "slug": "ethnic",       "order": 6},
        {"id": "l2-kids-accessories", "name": "Kids Accessories",      "slug": "accessories",  "order": 7},
        {"id": "l2-kids-nightwear",   "name": "Nightwear",             "slug": "nightwear",    "order": 8},
    ],
    "l1-accessories": [
        {"id": "l2-acc-bags",         "name": "Bags & Handbags",       "slug": "bags",         "order": 1},
        {"id": "l2-acc-belts",        "name": "Belts",                 "slug": "belts",        "order": 2},
        {"id": "l2-acc-sunglasses",   "name": "Sunglasses",            "slug": "sunglasses",   "order": 3},
        {"id": "l2-acc-watches",      "name": "Watches",               "slug": "watches",      "order": 4},
        {"id": "l2-acc-jewellery",    "name": "Jewellery",             "slug": "jewellery",    "order": 5},
        {"id": "l2-acc-scarves",      "name": "Scarves & Stoles",      "slug": "scarves",      "order": 6},
        {"id": "l2-acc-caps",         "name": "Caps & Hats",           "slug": "caps",         "order": 7},
        {"id": "l2-acc-wallets",      "name": "Wallets",               "slug": "wallets",      "order": 8},
    ],
    "l1-beauty": [
        {"id": "l2-beauty-skincare",  "name": "Skincare",              "slug": "skincare",     "order": 1},
        {"id": "l2-beauty-haircare",  "name": "Haircare",              "slug": "haircare",     "order": 2},
        {"id": "l2-beauty-makeup",    "name": "Makeup",                "slug": "makeup",       "order": 3},
        {"id": "l2-beauty-fragrance", "name": "Fragrances",            "slug": "fragrances",   "order": 4},
        {"id": "l2-beauty-nails",     "name": "Nail Care",             "slug": "nails",        "order": 5},
        {"id": "l2-beauty-grooming",  "name": "Men's Grooming",        "slug": "grooming",     "order": 6},
        {"id": "l2-beauty-hygiene",   "name": "Personal Hygiene",      "slug": "hygiene",      "order": 7},
    ],
    "l1-sports": [
        {"id": "l2-sports-activewear","name": "Activewear",            "slug": "activewear",   "order": 1},
        {"id": "l2-sports-shoes",     "name": "Sports Shoes",          "slug": "shoes",        "order": 2},
        {"id": "l2-sports-gym",       "name": "Gym & Fitness",         "slug": "gym",          "order": 3},
        {"id": "l2-sports-yoga",      "name": "Yoga & Pilates",        "slug": "yoga",         "order": 4},
        {"id": "l2-sports-cricket",   "name": "Cricket",               "slug": "cricket",      "order": 5},
        {"id": "l2-sports-football",  "name": "Football",              "slug": "football",     "order": 6},
        {"id": "l2-sports-outdoor",   "name": "Outdoor & Trekking",    "slug": "outdoor",      "order": 7},
        {"id": "l2-sports-acc",       "name": "Sports Accessories",    "slug": "accessories",  "order": 8},
    ],
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
