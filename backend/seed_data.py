"""Seed demo data: cities, stores, products, categories."""
from datetime import datetime, timezone
import uuid

NOW = datetime.now(timezone.utc).isoformat()

CATEGORIES = [
    {"id": "cat-women", "name": "Women", "slug": "women", "image": "https://images.unsplash.com/photo-1610189012906-4c0aa9b9781e?w=600&auto=format&fit=crop&q=80"},
    {"id": "cat-men", "name": "Men", "slug": "men", "image": "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=600&auto=format&fit=crop&q=80"},
    {"id": "cat-ethnic", "name": "Ethnic Wear", "slug": "ethnic", "image": "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=600&auto=format&fit=crop&q=80"},
    {"id": "cat-footwear", "name": "Footwear", "slug": "footwear", "image": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80"},
    {"id": "cat-street", "name": "Streetwear", "slug": "streetwear", "image": "https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=600&auto=format&fit=crop&q=80"},
    {"id": "cat-acc", "name": "Accessories", "slug": "accessories", "image": "https://images.unsplash.com/photo-1611923134239-b9be5816e23d?w=600&auto=format&fit=crop&q=80"},
    {"id": "cat-kids", "name": "Kids", "slug": "kids", "image": "https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=600&auto=format&fit=crop&q=80"},
    {"id": "cat-beauty", "name": "Beauty", "slug": "beauty", "image": "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&auto=format&fit=crop&q=80"},
]

STORES = [
    {
        "id": "store-1", "name": "Bunto Boutique", "tagline": "Handpicked ethnic luxury",
        "city": "Jaipur", "locality": "Bapu Bazaar",
        "lat": 26.9124, "lng": 75.7873, "distance_km": 1.2, "eta_min": 35,
        "rating": 4.8, "reviews": 412, "trusted": True,
        "logo": "https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?w=240&auto=format&fit=crop&q=80",
        "banner": "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&auto=format&fit=crop&q=80",
        "story": "A 3rd-generation boutique reimagining Jaipur's heritage textiles for Gen-Z India.",
        "specialties": ["Block Print", "Bandhani", "Festive"],
        "timing": "10am - 9pm",
    },
    {
        "id": "store-2", "name": "Threadhouse Co.", "tagline": "Streetwear, Bharat-edition",
        "city": "Jaipur", "locality": "C-Scheme",
        "lat": 26.9100, "lng": 75.8000, "distance_km": 2.4, "eta_min": 45,
        "rating": 4.6, "reviews": 281, "trusted": True,
        "logo": "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=240&auto=format&fit=crop&q=80",
        "banner": "https://images.unsplash.com/photo-1555529771-835f59fc5efe?w=1200&auto=format&fit=crop&q=80",
        "story": "Hand-printed oversized tees that mix kitsch Bharat motifs with global drops.",
        "specialties": ["Oversized Tees", "Drops", "Cargos"],
        "timing": "11am - 10pm",
    },
    {
        "id": "store-3", "name": "Saree Story", "tagline": "Weaves with a soul",
        "city": "Jaipur", "locality": "MI Road",
        "lat": 26.9200, "lng": 75.8100, "distance_km": 0.9, "eta_min": 28,
        "rating": 4.9, "reviews": 612, "trusted": True,
        "logo": "https://images.unsplash.com/photo-1610189012906-4c0aa9b9781e?w=240&auto=format&fit=crop&q=80",
        "banner": "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=1200&auto=format&fit=crop&q=80",
        "story": "Curated handloom sarees from Banaras, Chanderi, Maheshwar — delivered in 45 minutes.",
        "specialties": ["Sarees", "Handloom", "Bridal"],
        "timing": "10am - 8pm",
    },
    {
        "id": "store-4", "name": "Kicks Republic", "tagline": "Sneakers for the streets of Bharat",
        "city": "Jaipur", "locality": "Vaishali Nagar",
        "lat": 26.9300, "lng": 75.7500, "distance_km": 3.6, "eta_min": 50,
        "rating": 4.5, "reviews": 189, "trusted": False,
        "logo": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=240&auto=format&fit=crop&q=80",
        "banner": "https://images.unsplash.com/photo-1460353581641-37baddab0fa2?w=1200&auto=format&fit=crop&q=80",
        "story": "The most-stocked sneaker store in Tier-2 India.",
        "specialties": ["Sneakers", "Limited drops"],
        "timing": "11am - 11pm",
    },
    {
        "id": "store-5", "name": "Maya Modern", "tagline": "Quiet luxury for everyday women",
        "city": "Jaipur", "locality": "Civil Lines",
        "lat": 26.9180, "lng": 75.8050, "distance_km": 1.8, "eta_min": 40,
        "rating": 4.7, "reviews": 322, "trusted": True,
        "logo": "https://images.unsplash.com/photo-1569810020669-aa9d38003ea7?w=240&auto=format&fit=crop&q=80",
        "banner": "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1200&auto=format&fit=crop&q=80",
        "story": "Minimal silhouettes in raw cotton, linen and silk — designed in Jaipur.",
        "specialties": ["Co-ords", "Linen", "Minimal"],
        "timing": "10am - 9pm",
    },
    {
        "id": "store-6", "name": "Junglee Boys", "tagline": "Bold menswear, badass fits",
        "city": "Jaipur", "locality": "Malviya Nagar",
        "lat": 26.8500, "lng": 75.8200, "distance_km": 4.1, "eta_min": 55,
        "rating": 4.4, "reviews": 156, "trusted": False,
        "logo": "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=240&auto=format&fit=crop&q=80",
        "banner": "https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=1200&auto=format&fit=crop&q=80",
        "story": "Editorial menswear made for the new Indian gentleman.",
        "specialties": ["Shirts", "Blazers", "Tailoring"],
        "timing": "11am - 9pm",
    },
]

PRODUCTS = [
    # store-1 Bunto Boutique
    {"name": "Hand-Block Indigo Kurta", "price": 1899, "mrp": 3499, "store_id": "store-1", "category_id": "cat-ethnic",
     "image": "https://images.unsplash.com/photo-1610189012906-4c0aa9b9781e?w=800&auto=format&fit=crop&q=80",
     "sizes": ["S", "M", "L", "XL"], "rating": 4.8, "ai_enhanced": True, "try_at_doorstep": True,
     "description": "Hand-block printed in pure cotton — perfect for festive days and chill evenings."},
    {"name": "Bandhani Anarkali Set", "price": 4299, "mrp": 6999, "store_id": "store-1", "category_id": "cat-ethnic",
     "image": "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=800&auto=format&fit=crop&q=80",
     "sizes": ["S", "M", "L"], "rating": 4.9, "ai_enhanced": True, "try_at_doorstep": True,
     "description": "Traditional Bandhani tie-dye on a flowy Anarkali set — comes with dupatta."},
    # store-2 Threadhouse
    {"name": "Oversized 'Apna Time' Tee", "price": 899, "mrp": 1499, "store_id": "store-2", "category_id": "cat-street",
     "image": "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&auto=format&fit=crop&q=80",
     "sizes": ["M", "L", "XL", "XXL"], "rating": 4.6, "ai_enhanced": True, "try_at_doorstep": False,
     "description": "240GSM oversized fit with screen-printed graphic. Bharat-core streetwear."},
    {"name": "Wide-Leg Cargo Pants", "price": 1499, "mrp": 2299, "store_id": "store-2", "category_id": "cat-street",
     "image": "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=800&auto=format&fit=crop&q=80",
     "sizes": ["28", "30", "32", "34"], "rating": 4.5, "ai_enhanced": False, "try_at_doorstep": False,
     "description": "Six-pocket wide-leg cargos in earthy olive cotton-twill."},
    # store-3 Saree Story
    {"name": "Chanderi Silk Saree", "price": 5499, "mrp": 8999, "store_id": "store-3", "category_id": "cat-ethnic",
     "image": "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&auto=format&fit=crop&q=80",
     "sizes": ["Free Size"], "rating": 4.9, "ai_enhanced": True, "try_at_doorstep": True,
     "description": "Handwoven Chanderi silk in soft sunrise tones — timeless bridal-mode essential."},
    {"name": "Banarasi Bridal Saree", "price": 12999, "mrp": 19999, "store_id": "store-3", "category_id": "cat-ethnic",
     "image": "https://images.unsplash.com/photo-1610189011245-3f44e6f3da33?w=800&auto=format&fit=crop&q=80",
     "sizes": ["Free Size"], "rating": 5.0, "ai_enhanced": True, "try_at_doorstep": True,
     "description": "Pure zari Banarasi for your big day — heirloom-grade handloom craft."},
    # store-4 Kicks
    {"name": "Court Sneakers — Bone", "price": 3499, "mrp": 4999, "store_id": "store-4", "category_id": "cat-footwear",
     "image": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&auto=format&fit=crop&q=80",
     "sizes": ["7", "8", "9", "10", "11"], "rating": 4.5, "ai_enhanced": False, "try_at_doorstep": True,
     "description": "Classic low-top court sneakers in bone leather — perfect daily fit."},
    {"name": "Chunky Trail Runners", "price": 4299, "mrp": 6499, "store_id": "store-4", "category_id": "cat-footwear",
     "image": "https://images.unsplash.com/photo-1460353581641-37baddab0fa2?w=800&auto=format&fit=crop&q=80",
     "sizes": ["7", "8", "9", "10"], "rating": 4.6, "ai_enhanced": True, "try_at_doorstep": True,
     "description": "Chunky trail-runner silhouette, all-terrain grip, statement piece."},
    # store-5 Maya
    {"name": "Linen Co-ord Set", "price": 2899, "mrp": 4499, "store_id": "store-5", "category_id": "cat-women",
     "image": "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&auto=format&fit=crop&q=80",
     "sizes": ["XS", "S", "M", "L"], "rating": 4.7, "ai_enhanced": True, "try_at_doorstep": True,
     "description": "Pure linen co-ord set in oat — relaxed silhouette, quiet-luxury aesthetic."},
    {"name": "Raw Cotton Slip Dress", "price": 1999, "mrp": 3299, "store_id": "store-5", "category_id": "cat-women",
     "image": "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=800&auto=format&fit=crop&q=80",
     "sizes": ["XS", "S", "M"], "rating": 4.8, "ai_enhanced": True, "try_at_doorstep": True,
     "description": "Bias-cut raw cotton slip in muted clay — your new favourite summer dress."},
    # store-6 Junglee Boys
    {"name": "Tailored Linen Shirt", "price": 1799, "mrp": 2799, "store_id": "store-6", "category_id": "cat-men",
     "image": "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=800&auto=format&fit=crop&q=80",
     "sizes": ["S", "M", "L", "XL"], "rating": 4.5, "ai_enhanced": True, "try_at_doorstep": False,
     "description": "Italian-fit linen shirt in burnt sienna — versatile workwear staple."},
    {"name": "Editorial Wool Blazer", "price": 5999, "mrp": 8999, "store_id": "store-6", "category_id": "cat-men",
     "image": "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=800&auto=format&fit=crop&q=80",
     "sizes": ["S", "M", "L"], "rating": 4.7, "ai_enhanced": True, "try_at_doorstep": True,
     "description": "Unstructured wool-blend blazer in espresso — built in Jaipur, styled for any city."},
]


def build_seed_docs():
    """Return (categories, stores, products) as dicts ready for MongoDB."""
    stores = []
    for s in STORES:
        stores.append({**s, "created_at": NOW})

    products = []
    for p in PRODUCTS:
        store = next(s for s in STORES if s["id"] == p["store_id"])
        products.append({
            "id": f"prod-{uuid.uuid4().hex[:8]}",
            **p,
            "store_name": store["name"],
            "store_city": store["city"],
            "store_distance_km": store["distance_km"],
            "store_eta_min": store["eta_min"],
            "created_at": NOW,
        })

    return CATEGORIES, stores, products
