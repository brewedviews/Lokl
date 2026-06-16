"""Demo seed: 10 stores × 10 products covering all L1/L2 categories across Bhilai.

Idempotent — deletes docs with ids prefixed 'demo-' before re-inserting.
Run:  python -m seeds.run demo_stores
      python -m seeds.run --all
      python backend/run_demo_seed.py
"""
from datetime import datetime, timezone

NOW = datetime.now(timezone.utc).isoformat()

# ---------------------------------------------------------------------------
# Area lookup — exact slugs/coords from bhilai-areas.ts
# ---------------------------------------------------------------------------
_AREAS = {
    "sector_1":     {"label": "Sector 1",     "pincode": "490001", "lat": 21.2023, "lng": 81.4286},
    "sector_4":     {"label": "Sector 4",     "pincode": "490001", "lat": 21.1965, "lng": 81.4198},
    "sector_6":     {"label": "Sector 6",     "pincode": "490006", "lat": 21.2156, "lng": 81.4089},
    "sector_7":     {"label": "Sector 7",     "pincode": "490006", "lat": 21.2134, "lng": 81.4134},
    "sector_9":     {"label": "Sector 9",     "pincode": "490009", "lat": 21.1876, "lng": 81.3987},
    "supela":       {"label": "Supela",       "pincode": "490020", "lat": 21.1756, "lng": 81.3823},
    "nehru_nagar":  {"label": "Nehru Nagar",  "pincode": "490023", "lat": 21.2234, "lng": 81.4312},
    "smriti_nagar": {"label": "Smriti Nagar", "pincode": "490020", "lat": 21.1923, "lng": 81.4056},
    "risali":       {"label": "Risali",       "pincode": "490006", "lat": 21.2312, "lng": 81.3934},
    "kumhari":      {"label": "Kumhari",      "pincode": "490042", "lat": 21.2645, "lng": 81.3912},
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_W_SIZES = ["XS", "S", "M", "L", "XL"]
_M_SIZES = ["S", "M", "L", "XL", "XXL"]
_W_SHOES = ["UK3", "UK4", "UK5", "UK6", "UK7"]
_M_SHOES = ["UK6", "UK7", "UK8", "UK9", "UK10"]
_K_SIZES = ["2-3Y", "4-5Y", "6-7Y", "8-9Y", "10-11Y"]


def _rating(pid: str) -> float:
    return round(4.2 + sum(ord(c) for c in pid) % 8 * 0.1, 1)


def _mk_merchant(mid, phone, store_name, owner_name):
    p10 = phone[-10:]
    n = mid.split("-")[-1]   # "01" … "10"
    return {
        "id": mid,
        "phone": f"+91{p10}",
        "phone_canonical": p10,
        "email": f"demo{n}@shoplokl.in",
        "city": "Bhilai",
        "store_name": store_name,
        "owner_name": owner_name,
        "kyc_status": "approved",
        "kyc_submitted_at": NOW,
        "approved_at": NOW,
        "published": True,
        "storefront": None,
        "notifications": [],
        "created_at": NOW,
    }


def _mk_store(merchant_id, name, tagline, story, area_slug, banner, specialties,
              opens_at="10:00", closes_at="21:00"):
    a = _AREAS[area_slug]
    store_id = f"store-m-{merchant_id}"
    return {
        "id": store_id,
        "merchant_id": merchant_id,
        "name": name,
        "tagline": tagline,
        "story": story,
        "banner": banner,
        "banners": [banner],
        "banner_public_ids": [],
        "logo": banner,
        "logo_public_id": "",
        "city": "Bhilai",
        "area": a["label"],
        "locality": a["label"],
        "area_slug": area_slug,
        "area_label": a["label"],
        "pincode": a["pincode"],
        "address": f"{a['label']}, Bhilai, Chhattisgarh {a['pincode']}",
        "specialties": specialties,
        "timing": f"{opens_at} - {closes_at}",
        "opens_at": opens_at,
        "closes_at": closes_at,
        "lat": a["lat"],
        "lng": a["lng"],
        "location": {"type": "Point", "coordinates": [a["lng"], a["lat"]]},
        "trusted": True,
        "kyc_status": "approved",
        "published": True,
        "paused": False,
        "is_deleted": False,
        "product_count": 10,
        "online": True,
        "last_seen_at": NOW,
        "created_at": NOW,
    }


def _mk_product(store_id, merchant_id, store_name, pid, name, description,
                price, mrp, l1_id, sizes, stock_qty, image,
                l2_id="", gender="", return_eligible=True,
                badge=None, try_at_doorstep=True):
    stock = {sz: stock_qty for sz in sizes} if sizes else {"default": stock_qty}
    doc = {
        "id": pid,
        "merchant_id": merchant_id,
        "store_id": store_id,
        "store_name": store_name,
        "store_city": "Bhilai",
        "name": name,
        "description": description,
        "price": float(price),
        "mrp": float(mrp),
        "l1_id": l1_id,
        "l2_id": l2_id,
        "gender": gender,
        "image": image,
        "images": [image],
        "sizes": sizes,
        "stock": stock,
        "return_eligible": return_eligible,
        "try_at_doorstep": try_at_doorstep,
        "ai_enhanced": True,
        "rating": _rating(pid),
        "paused": False,
        "is_deleted": False,
        "needs_image": False,
        "created_at": NOW,
    }
    if badge:
        doc["badge"] = badge
    return doc


# ---------------------------------------------------------------------------
# Convenience image base
# ---------------------------------------------------------------------------
def _img(photo_id, w=600):
    return f"https://images.unsplash.com/{photo_id}?w={w}&auto=format&fit=crop&q=80"


# ---------------------------------------------------------------------------
# Store 1 — Chandni Fashion House  ·  Sector 6  ·  Women's fashion
# ---------------------------------------------------------------------------
_S1_MID = "demo-m-01"
_S1_SID = f"store-m-{_S1_MID}"
_S1_NAME = "Chandni Fashion House"

MERCHANT_01 = _mk_merchant(_S1_MID, "9111000001", _S1_NAME, "Chandni Sharma")
STORE_01 = _mk_store(
    _S1_MID, _S1_NAME,
    tagline="Ethnic to everyday — women's fashion with heart",
    story="Chandni started this boutique in 2019 out of her love for Indian textiles. Every piece is hand-picked from artisans across Rajasthan and UP.",
    area_slug="sector_6",
    banner=_img("photo-1469334031218-e382a71b716b", 1200),
    specialties=["Women", "Ethnic wear", "Western wear", "Formals"],
)

_PRODUCTS_01 = [
    ("demo-p-01-01", "Floral Chiffon Top",         "Light chiffon top with hand-printed floral motifs, relaxed fit.",                 899,  1299, "l1-women", _W_SIZES, 25, _img("photo-1564257631407-4deb1f99d992"), "l2-w-topwear",   "",        True,  "best_seller"),
    ("demo-p-01-02", "Embroidered Silk Blouse",     "Delicate silk blouse with thread embroidery at collar and cuffs.",                1199, 1799, "l1-women", _W_SIZES, 15, _img("photo-1558618666-fcd25c85cd64"), "l2-w-topwear",   "",        True,  None),
    ("demo-p-01-03", "Boho Printed Shirt",          "Bohemian print shirt in breathable viscose, ideal for casual days.",              699,  999,  "l1-women", _W_SIZES, 30, _img("photo-1596755389378-c31d21fd1273"), "l2-w-topwear",   "",        True,  "new"),
    ("demo-p-01-04", "Flare Midi Dress",            "A-line flare dress in soft georgette, hits just below the knee.",                 1499, 2199, "l1-women", _W_SIZES, 18, _img("photo-1572804013309-59a88b7e92f1"), "l2-w-dresses",   "",        True,  "best_seller"),
    ("demo-p-01-05", "Wrap Cocktail Dress",         "Classic wrap silhouette in matte crepe with V-neckline.",                        1899, 2799, "l1-women", _W_SIZES, 12, _img("photo-1508214751196-bcfd4ca60f91"), "l2-w-dresses",   "",        True,  None),
    ("demo-p-01-06", "Anarkali Suit Set",           "Three-piece Anarkali set with dupatta, pure cotton kurta with zari border.",     2299, 3499, "l1-women", _W_SIZES, 20, _img("photo-1610189012906-4c0aa9b9781e"), "l2-w-ethnic",    "",        True,  None),
    ("demo-p-01-07", "Banarasi Silk Saree",         "Authentic Banarasi silk with zari weave, comes with matching blouse piece.",     2799, 4199, "l1-women", [],       30, _img("photo-1610189012906-4c0aa9b9781e"), "l2-w-ethnic",    "",        False, "best_seller"),
    ("demo-p-01-08", "Classic White Formal Shirt",  "Crisp cotton formal shirt with French tuck-friendly cut.",                       999,  1499, "l1-women", _W_SIZES, 22, _img("photo-1551803091-e20673f15770"), "l2-w-formals",   "",        True,  None),
    ("demo-p-01-09", "Power Blazer Set",            "Tailored blazer and straight trouser in stretch fabric, office-ready.",          2499, 3799, "l1-women", _W_SIZES, 10, _img("photo-1551803091-e20673f15770"), "l2-w-formals",   "",        True,  "new"),
    ("demo-p-01-10", "Block-Heel Embellished Sandals", "Festive block-heel sandals with bead embellishments, ankle strap closure.",  1399, 1999, "l1-women", _W_SHOES, 15, _img("photo-1543163521-1bf539c55dd2"), "l2-w-footwear",  "",        True,  None),
]

# ---------------------------------------------------------------------------
# Store 2 — Sole Republic  ·  Nehru Nagar  ·  Footwear
# ---------------------------------------------------------------------------
_S2_MID = "demo-m-02"
_S2_SID = f"store-m-{_S2_MID}"
_S2_NAME = "Sole Republic"

MERCHANT_02 = _mk_merchant(_S2_MID, "9111000002", _S2_NAME, "Rahul Khanna")
STORE_02 = _mk_store(
    _S2_MID, _S2_NAME,
    tagline="Every step, perfectly fitted",
    story="Rahul curates footwear from Agra's finest cobblers and global lifestyle brands. Walk better, live better.",
    area_slug="nehru_nagar",
    banner=_img("photo-1542291026-7eec264c27ff", 1200),
    specialties=["Footwear", "Women shoes", "Men shoes", "Sneakers"],
)

_PRODUCTS_02 = [
    ("demo-p-02-01", "Canvas High-Top Sneakers",   "White canvas high-tops with rubber sole, lace-up closure.",                      999,  1499, "l1-footwear", _W_SHOES, 20, _img("photo-1543163521-1bf539c55dd2"), "", "women", True,  "best_seller"),
    ("demo-p-02-02", "Block Heel Pumps",           "Classic block heel pumps in nude faux suede, 8cm heel.",                         1499, 2199, "l1-footwear", _W_SHOES, 15, _img("photo-1543163521-1bf539c55dd2"), "", "women", True,  None),
    ("demo-p-02-03", "Woven Flat Sandals",         "Handwoven jute upper sandals with leather insole for all-day comfort.",          699,  999,  "l1-footwear", _W_SHOES, 25, _img("photo-1543163521-1bf539c55dd2"), "", "women", True,  "new"),
    ("demo-p-02-04", "Suede Ankle Boots",          "Ankle boots in soft suede with side zip and cushioned footbed.",                 2199, 3199, "l1-footwear", _W_SHOES, 10, _img("photo-1543163521-1bf539c55dd2"), "", "women", True,  None),
    ("demo-p-02-05", "Studded Slip-Ons",           "Casual slip-ons with gold stud detailing on toe cap.",                          899,  1299, "l1-footwear", _W_SHOES, 18, _img("photo-1543163521-1bf539c55dd2"), "", "women", True,  None),
    ("demo-p-02-06", "Trail Running Sneakers",     "Breathable mesh upper with cushioned midsole for daily running.",                1299, 1999, "l1-footwear", _M_SHOES, 22, _img("photo-1542291026-7eec264c27ff"), "", "men",   True,  "best_seller"),
    ("demo-p-02-07", "Leather Derby Shoes",        "Full-grain leather derby with Goodyear welt stitching.",                        2499, 3699, "l1-footwear", _M_SHOES, 12, _img("photo-1542291026-7eec264c27ff"), "", "men",   True,  None),
    ("demo-p-02-08", "Canvas Slip-Ons",            "Lightweight canvas slip-ons in navy, rubber sole.",                             799,  1199, "l1-footwear", _M_SHOES, 30, _img("photo-1542291026-7eec264c27ff"), "", "men",   True,  "new"),
    ("demo-p-02-09", "Moc-Toe Loafers",            "Leather moc-toe loafers with penny strap, work or weekend.",                    1799, 2699, "l1-footwear", _M_SHOES, 14, _img("photo-1542291026-7eec264c27ff"), "", "men",   True,  None),
    ("demo-p-02-10", "Sports Slide Sandals",       "EVA foam slide sandals with arch support and quick-dry strap.",                 899,  1299, "l1-footwear", _M_SHOES, 20, _img("photo-1542291026-7eec264c27ff"), "", "men",   True,  None),
]

# ---------------------------------------------------------------------------
# Store 3 — Diva Couture  ·  Smriti Nagar  ·  Women casual & leisure
# ---------------------------------------------------------------------------
_S3_MID = "demo-m-03"
_S3_SID = f"store-m-{_S3_MID}"
_S3_NAME = "Diva Couture"

MERCHANT_03 = _mk_merchant(_S3_MID, "9111000003", _S3_NAME, "Priya Nair")
STORE_03 = _mk_store(
    _S3_MID, _S3_NAME,
    tagline="Comfort is the new confidence",
    story="Priya believes great fashion should feel as good as it looks. Diva Couture focuses on everyday comfort without compromising on style.",
    area_slug="smriti_nagar",
    banner=_img("photo-1518611012118-696072aa579a", 1200),
    specialties=["Women", "Athleisure", "Sleepwear", "Lingerie", "Bottoms"],
)

_PRODUCTS_03 = [
    ("demo-p-03-01", "High-Rise Jeggings",          "Stretch denim jeggings with high waist, 4-way flex fabric.",                    999,  1499, "l1-women", _W_SIZES, 25, _img("photo-1594938298603-c8148c4b4043"), "l2-w-bottomwear", "", True,  "best_seller"),
    ("demo-p-03-02", "Floral Midi Skirt",            "Pleated midi skirt in chiffon with all-over floral print.",                    799,  1199, "l1-women", _W_SIZES, 20, _img("photo-1594938298603-c8148c4b4043"), "l2-w-bottomwear", "", True,  None),
    ("demo-p-03-03", "Wide-Leg Palazzo Pants",       "Breezy palazzo in viscose crepe, elasticated waist.",                         1099, 1599, "l1-women", _W_SIZES, 18, _img("photo-1594938298603-c8148c4b4043"), "l2-w-bottomwear", "", True,  "new"),
    ("demo-p-03-04", "Sports Leggings",              "High-waist 7/8 leggings with moisture-wicking fabric and pocket.",            799,  1199, "l1-women", _W_SIZES, 30, _img("photo-1518611012118-696072aa579a"), "l2-w-athleisure", "", True,  "best_seller"),
    ("demo-p-03-05", "Yoga Co-ord Set",              "Seamless crop top and legging set, 4-way stretch.",                           1499, 2199, "l1-women", _W_SIZES, 20, _img("photo-1518611012118-696072aa579a"), "l2-w-athleisure", "", True,  None),
    ("demo-p-03-06", "Active Track Suit",            "Slim-fit jacket and jogger set in French terry, thumb holes.",                 1799, 2699, "l1-women", _W_SIZES, 15, _img("photo-1518611012118-696072aa579a"), "l2-w-athleisure", "", True,  None),
    ("demo-p-03-07", "Satin Night Dress",            "V-neck satin slip dress for lounging, available in blush and ivory.",         1199, 1799, "l1-women", _W_SIZES, 18, _img("photo-1620799140408-edc6dcb6d633"), "l2-w-sleepwear",  "", False, None),
    ("demo-p-03-08", "Printed Pyjama Set",           "Cotton printed pyjama set with drawstring waist, two-piece.",                 899,  1299, "l1-women", _W_SIZES, 22, _img("photo-1620799140408-edc6dcb6d633"), "l2-w-sleepwear",  "", False, "new"),
    ("demo-p-03-09", "Lace Bralette Set",            "Soft-wire bralette and brief set in stretch lace.",                          799,  1199, "l1-women", _W_SIZES, 20, _img("photo-1571513722275-4b41940f54b8"), "l2-w-lingerie",   "", False, None),
    ("demo-p-03-10", "Comfort Bra & Brief Set",      "T-shirt bra in seamless microfibre with matching briefs, everyday fit.",     599,  899,  "l1-women", _W_SIZES, 25, _img("photo-1571513722275-4b41940f54b8"), "l2-w-lingerie",   "", False, "best_seller"),
]

# ---------------------------------------------------------------------------
# Store 4 — Streetwear Bhilai  ·  Supela  ·  Streetwear + Men casual
# ---------------------------------------------------------------------------
_S4_MID = "demo-m-04"
_S4_SID = f"store-m-{_S4_MID}"
_S4_NAME = "Streetwear Bhilai"

MERCHANT_04 = _mk_merchant(_S4_MID, "9111000004", _S4_NAME, "Aryan Mehta")
STORE_04 = _mk_store(
    _S4_MID, _S4_NAME,
    tagline="Drop culture meets Bhilai streets",
    story="Aryan brings the vibe of Mumbai's Dharavi street scene to Bhilai. Oversized, authentic, unapologetic.",
    area_slug="supela",
    banner=_img("photo-1523398002811-999ca8dec234", 1200),
    specialties=["Streetwear", "Men", "Oversized", "Graphic tees", "Denim"],
)

_PRODUCTS_04 = [
    ("demo-p-04-01", "Oversized Graphic Tee",      "Drop-shoulder tee with bold vintage print, 240gsm cotton.",                     799,  1199, "l1-streetwear", ["S","M","L","XL","2XL"], 30, _img("photo-1523398002811-999ca8dec234"), "", "unisex", True,  "best_seller"),
    ("demo-p-04-02", "Cargo Joggers",              "Utility joggers with six pockets, ribbed ankle cuffs.",                         1299, 1999, "l1-streetwear", ["S","M","L","XL","2XL"], 20, _img("photo-1523398002811-999ca8dec234"), "", "unisex", True,  None),
    ("demo-p-04-03", "Hooded Sweatshirt",          "Pullover hoodie in fleece, kangaroo pocket, unisex fit.",                       1499, 2299, "l1-streetwear", ["S","M","L","XL","2XL"], 18, _img("photo-1523398002811-999ca8dec234"), "", "unisex", True,  "new"),
    ("demo-p-04-04", "Camo Track Jacket",          "Relaxed track jacket in camo twill, contrast zipper.",                         1799, 2699, "l1-streetwear", _M_SIZES,                20, _img("photo-1523398002811-999ca8dec234"), "", "men",    True,  None),
    ("demo-p-04-05", "Tie-Dye Crop Hoodie",        "Boxy crop hoodie with spiral tie-dye, ribbed hem.",                            1199, 1799, "l1-streetwear", _W_SIZES,                15, _img("photo-1523398002811-999ca8dec234"), "", "women",  True,  "best_seller"),
    ("demo-p-04-06", "Acid-Wash Graphic Tee",      "Distressed acid-wash tee with screen-print graphic on chest.",                 699,  999,  "l1-men", _M_SIZES, 25, _img("photo-1521572163474-6864f9cf17ab"), "l2-m-tshirt",    "", True,  None),
    ("demo-p-04-07", "Half-Sleeve V-Neck Tee",     "Slim-fit V-neck in Supima cotton, breathable all day.",                       499,  699,  "l1-men", _M_SIZES, 35, _img("photo-1521572163474-6864f9cf17ab"), "l2-m-tshirt",    "", True,  "new"),
    ("demo-p-04-08", "Slim Fit Dark Wash Jeans",   "5-pocket slim jeans in dark indigo stretch denim.",                           1499, 2199, "l1-men", _M_SIZES, 20, _img("photo-1542272604-787c3835535d"), "l2-m-jeans",     "", True,  "best_seller"),
    ("demo-p-04-09", "Stretch Black Jeans",        "Skinny black jeans with stretch waistband for all-day comfort.",              1299, 1999, "l1-men", _M_SIZES, 18, _img("photo-1542272604-787c3835535d"), "l2-m-jeans",     "", True,  None),
    ("demo-p-04-10", "Printed Beach Shorts",       "Elastic-waist shorts with tropical print, quick-dry fabric.",                  699,  999,  "l1-men", _M_SIZES, 28, _img("photo-1591195853828-11db59a44f6b"), "l2-m-shorts",    "", True,  None),
]

# ---------------------------------------------------------------------------
# Store 5 — Little Stars  ·  Risali  ·  Kids clothing
# ---------------------------------------------------------------------------
_S5_MID = "demo-m-05"
_S5_SID = f"store-m-{_S5_MID}"
_S5_NAME = "Little Stars"

MERCHANT_05 = _mk_merchant(_S5_MID, "9111000005", _S5_NAME, "Sunita Patel")
STORE_05 = _mk_store(
    _S5_MID, _S5_NAME,
    tagline="Dressed for every adventure",
    story="Sunita is a mother of three who couldn't find safe, playful kids' clothing locally. She started Little Stars to bring durable, fun clothes to Bhilai's children.",
    area_slug="risali",
    banner=_img("photo-1622290291468-a28f7a7dc6a8", 1200),
    specialties=["Kids", "Baby clothes", "Ethnic kids", "Schoolwear"],
)

_PRODUCTS_05 = [
    ("demo-p-05-01", "Floral Frock",              "Cotton frock with smocking at waist and floral all-over print.",                  699,  999,  "l1-kids", _K_SIZES, 20, _img("photo-1622290291468-a28f7a7dc6a8"), "", "women",  True,  None),
    ("demo-p-05-02", "Denim Dungaree",            "Adjustable strap dungaree in soft denim, unisex cut.",                           899,  1299, "l1-kids", _K_SIZES, 18, _img("photo-1622290291468-a28f7a7dc6a8"), "", "kids",   True,  "best_seller"),
    ("demo-p-05-03", "Dino Print Tee Set",        "Half-sleeve tee with dino print, paired with shorts.",                           599,  899,  "l1-kids", _K_SIZES, 25, _img("photo-1622290291468-a28f7a7dc6a8"), "", "men",    True,  "new"),
    ("demo-p-05-04", "Sports Track Suit",         "Lightweight track jacket + jogger set for active kids.",                         999,  1499, "l1-kids", _K_SIZES, 20, _img("photo-1622290291468-a28f7a7dc6a8"), "", "kids",   True,  None),
    ("demo-p-05-05", "Princess Tulle Dress",      "Layered tulle party dress with satin bodice and bow.",                          1199, 1799, "l1-kids", _K_SIZES, 15, _img("photo-1622290291468-a28f7a7dc6a8"), "", "women",  False, "best_seller"),
    ("demo-p-05-06", "Cargo Short Set",           "Two-piece set — graphic tee and multi-pocket cargo shorts.",                    799,  1199, "l1-kids", _K_SIZES, 20, _img("photo-1622290291468-a28f7a7dc6a8"), "", "men",    True,  None),
    ("demo-p-05-07", "Chunky Knit Sweater",       "Cosy knit sweater with ribbed cuffs and hem, warm winter pick.",                899,  1299, "l1-kids", _K_SIZES, 15, _img("photo-1622290291468-a28f7a7dc6a8"), "", "kids",   True,  None),
    ("demo-p-05-08", "School Uniform Set",        "Formal shirt + trousers or skirt, wrinkle-resistant fabric.",                  1299, 1899, "l1-kids", _K_SIZES, 30, _img("photo-1622290291468-a28f7a7dc6a8"), "", "kids",   True,  "new"),
    ("demo-p-05-09", "Ethnic Kurta Pajama",       "Festive kurta with Nehru collar and matching pajama.",                          999,  1499, "l1-kids", _K_SIZES, 18, _img("photo-1622290291468-a28f7a7dc6a8"), "", "men",    False, None),
    ("demo-p-05-10", "Lehenga Choli Set",         "Embroidered lehenga with matching choli and dupatta.",                         1499, 2199, "l1-kids", _K_SIZES, 12, _img("photo-1622290291468-a28f7a7dc6a8"), "", "women",  False, None),
]

# ---------------------------------------------------------------------------
# Store 6 — Royal Ethnic Studio  ·  Sector 7  ·  Men + Women ethnic wear
# ---------------------------------------------------------------------------
_S6_MID = "demo-m-06"
_S6_SID = f"store-m-{_S6_MID}"
_S6_NAME = "Royal Ethnic Studio"

MERCHANT_06 = _mk_merchant(_S6_MID, "9111000006", _S6_NAME, "Ramesh Gupta")
STORE_06 = _mk_store(
    _S6_MID, _S6_NAME,
    tagline="Tradition woven into every thread",
    story="Three generations of weavers from Varanasi supply Ramesh's studio with handloom fabrics. Every sherwani is stitched to order.",
    area_slug="sector_7",
    banner=_img("photo-1583391733956-3750e0ff4e8b", 1200),
    specialties=["Men ethnic", "Women ethnic", "Handloom", "Bridal wear"],
)

_PRODUCTS_06 = [
    ("demo-p-06-01", "Cotton Kurta Pajama",       "Straight-cut cotton kurta with Nehru collar, cotton pajama.",                   1299, 1999, "l1-men", _M_SIZES, 20, _img("photo-1583391733956-3750e0ff4e8b"), "l2-m-ethnic", "", True,  "best_seller"),
    ("demo-p-06-02", "Wedding Sherwani",          "Jacquard silk sherwani with embroidered yoke, includes churidar.",              5999, 8999, "l1-men", _M_SIZES, 8,  _img("photo-1583391733956-3750e0ff4e8b"), "l2-m-ethnic", "", False, None),
    ("demo-p-06-03", "Nehru Jacket Set",          "Bundi jacket in raw silk over kurta-pajama set, classic festive look.",        2499, 3799, "l1-men", _M_SIZES, 12, _img("photo-1583391733956-3750e0ff4e8b"), "l2-m-ethnic", "", True,  None),
    ("demo-p-06-04", "Pathani Suit",              "Afghan-style Pathani with side slits, linen fabric.",                          1799, 2699, "l1-men", _M_SIZES, 15, _img("photo-1583391733956-3750e0ff4e8b"), "l2-m-ethnic", "", True,  "new"),
    ("demo-p-06-05", "Printed Kurta",             "Block-print short kurta in mul cotton, can be worn over jeans.",               999,  1499, "l1-men", _M_SIZES, 25, _img("photo-1583391733956-3750e0ff4e8b"), "l2-m-ethnic", "", True,  None),
    ("demo-p-06-06", "Embroidered Anarkali Set",  "Floor-length Anarkali with heavy thread embroidery, dupatta included.",       2299, 3499, "l1-women", _W_SIZES, 15, _img("photo-1610189012906-4c0aa9b9781e"), "l2-w-ethnic", "", False, "best_seller"),
    ("demo-p-06-07", "Designer Lehenga Set",      "Bridal lehenga in raw silk with mirror work, includes choli and dupatta.",    5499, 7999, "l1-women", _W_SIZES, 6,  _img("photo-1610189012906-4c0aa9b9781e"), "l2-w-ethnic", "", False, None),
    ("demo-p-06-08", "Banarasi Silk Saree",       "Pure Banarasi silk with gold zari border, blouse piece included.",            3499, 4999, "l1-women", [],       20, _img("photo-1610189012906-4c0aa9b9781e"), "l2-w-ethnic", "", False, None),
    ("demo-p-06-09", "Salwar Kameez Set",         "Straight-cut salwar kameez with dupatta in Cambric cotton.",                  1699, 2499, "l1-women", _W_SIZES, 20, _img("photo-1610189012906-4c0aa9b9781e"), "l2-w-ethnic", "", True,  "new"),
    ("demo-p-06-10", "Chanderi Kurti Set",        "Sheer Chanderi kurti with inner slip and pallazo pants.",                    1199, 1799, "l1-women", _W_SIZES, 18, _img("photo-1610189012906-4c0aa9b9781e"), "l2-w-ethnic", "", True,  None),
]

# ---------------------------------------------------------------------------
# Store 7 — Powerhouse Sports  ·  Sector 1  ·  Sports & fitness
# ---------------------------------------------------------------------------
_S7_MID = "demo-m-07"
_S7_SID = f"store-m-{_S7_MID}"
_S7_NAME = "Powerhouse Sports"

MERCHANT_07 = _mk_merchant(_S7_MID, "9111000007", _S7_NAME, "Vijay Singh")
STORE_07 = _mk_store(
    _S7_MID, _S7_NAME,
    tagline="Train harder, play better",
    story="Vijay is a state-level cricket coach who set up this store to give Bhilai's athletes access to quality equipment without travelling to Raipur.",
    area_slug="sector_1",
    banner=_img("photo-1517649763962-0c623066013b", 1200),
    specialties=["Cricket", "Football", "Fitness", "Yoga", "Sports nutrition"],
)

_PRODUCTS_07 = [
    ("demo-p-07-01", "Adjustable Dumbbell Set 5kg", "Cast iron dumbbells with adjustable knurl grip, pair.",                       1499, 1999, "l1-sports", [], 15, _img("photo-1581009146145-b5ef050c2e1e"), "l2-s-fitness",     "", True,  "best_seller"),
    ("demo-p-07-02", "Resistance Band Set",          "5-band set (5–40 lbs), includes door anchor and handles.",                   599,  899,  "l1-sports", [], 30, _img("photo-1581009146145-b5ef050c2e1e"), "l2-s-fitness",     "", True,  "new"),
    ("demo-p-07-03", "Gym Gloves Pro",               "Wrist wrap gloves with non-slip silicone palm, XS–XL sizes.",               399,  599,  "l1-sports", ["XS","S","M","L","XL"], 25, _img("photo-1581009146145-b5ef050c2e1e"), "l2-s-fitness", "", True, None),
    ("demo-p-07-04", "English Willow Cricket Bat",   "Grade 3 English willow bat, full-cane handle, 1200g.",                     2999, 4499, "l1-sports", [], 10, _img("photo-1531415074968-036ba1b575da"), "l2-s-cricket",     "", False, "best_seller"),
    ("demo-p-07-05", "Cricket Kit Bag",              "Duffle bag with separate boot compartment, bat sleeve, 3 pockets.",         1999, 2999, "l1-sports", [], 12, _img("photo-1531415074968-036ba1b575da"), "l2-s-cricket",     "", True,  None),
    ("demo-p-07-06", "Football Turf Boots",          "AG sole football boots with textured upper for ball control.",              1799, 2699, "l1-sports", _M_SHOES, 15, _img("photo-1551958219-acbc608c6377"), "l2-s-football",    "", True,  None),
    ("demo-p-07-07", "Match Football Size 5",        "FIFA-quality PU leather match ball, hand-stitched, size 5.",               999,  1499, "l1-sports", [], 20, _img("photo-1551958219-acbc608c6377"), "l2-s-football",    "", False, "new"),
    ("demo-p-07-08", "Yoga Mat 6mm",                 "NBR foam mat with alignment lines, non-slip surface, carry strap.",         799,  1199, "l1-sports", [], 25, _img("photo-1545205597-3d9d02c29597"), "l2-s-yoga",        "", True,  "best_seller"),
    ("demo-p-07-09", "Yoga Block Set",               "High-density EVA foam blocks, pair, four colours available.",              499,  699,  "l1-sports", [], 30, _img("photo-1545205597-3d9d02c29597"), "l2-s-yoga",        "", True,  None),
    ("demo-p-07-10", "Whey Protein 1kg Chocolate",   "Whey concentrate 24g protein per serving, 30 servings, no added sugar.",  1899, 2799, "l1-sports", [], 20, _img("photo-1593095948071-474c5cc2989d"), "l2-s-supplements", "", False, None),
]

# ---------------------------------------------------------------------------
# Store 8 — Glow & Grace Beauty  ·  Sector 4  ·  Beauty + Electronics
# ---------------------------------------------------------------------------
_S8_MID = "demo-m-08"
_S8_SID = f"store-m-{_S8_MID}"
_S8_NAME = "Glow & Grace Beauty"

MERCHANT_08 = _mk_merchant(_S8_MID, "9111000008", _S8_NAME, "Meena Agarwal")
STORE_08 = _mk_store(
    _S8_MID, _S8_NAME,
    tagline="Skin-first, trend-always",
    story="Meena is a certified aesthetician who combined her skincare expertise with her love for beauty tech. Find dermat-tested products and smart grooming gadgets here.",
    area_slug="sector_4",
    banner=_img("photo-1596462502278-27bfdc403348", 1200),
    specialties=["Skincare", "Makeup", "Haircare", "Grooming gadgets"],
)

_PRODUCTS_08 = [
    ("demo-p-08-01", "Vitamin C Face Serum 30ml",  "10% Vitamin C + Niacinamide serum, brightens and evens skin tone.",           899,  1299, "l1-beauty", [], 30, _img("photo-1596462502278-27bfdc403348"), "", "women",  True,  "best_seller"),
    ("demo-p-08-02", "Hydrating Night Cream",      "Ceramide-rich night cream for deep moisture barrier repair, 50ml.",           799,  1199, "l1-beauty", [], 25, _img("photo-1596462502278-27bfdc403348"), "", "women",  True,  None),
    ("demo-p-08-03", "Kajal Eyeliner Duo",         "Smudge-proof kajal in black + brown, 12h wear.",                             299,  499,  "l1-beauty", [], 40, _img("photo-1596462502278-27bfdc403348"), "", "women",  False, None),
    ("demo-p-08-04", "Matte Lipstick Set (5 shades)", "Long-wear matte formula, 5 nude-to-bold shades in one box.",              699,  999,  "l1-beauty", [], 20, _img("photo-1596462502278-27bfdc403348"), "", "women",  False, "best_seller"),
    ("demo-p-08-05", "Onion Hair Growth Oil",      "Red onion extract + castor oil blend, reduces hair fall in 4 weeks.",        499,  799,  "l1-beauty", [], 35, _img("photo-1596462502278-27bfdc403348"), "", "women",  True,  "new"),
    ("demo-p-08-06", "Charcoal Face Wash",         "Activated charcoal deep-pore cleanser, sulfate-free, 150ml.",                349,  499,  "l1-beauty", [], 40, _img("photo-1596462502278-27bfdc403348"), "", "unisex", True,  None),
    ("demo-p-08-07", "SPF50 Sunscreen Gel",        "PA++++ gel sunscreen, no white cast, water-resistant for 2h.",               449,  699,  "l1-beauty", [], 35, _img("photo-1596462502278-27bfdc403348"), "", "unisex", True,  "best_seller"),
    ("demo-p-08-08", "Ceramic Hair Straightener",  "Ionic ceramic plates, 230°C max, heat-up in 30 s, 2m swivel cord.",        1299, 1999, "l1-electronics", [], 12, _img("photo-1522338242992-e1a54906a8da"), "l2-e-personal-care", "", True, None),
    ("demo-p-08-09", "Facial Steamer",             "Nano-ionic steam with herb basket, 9-min auto-off, portable.",               999,  1499, "l1-electronics", [], 15, _img("photo-1522338242992-e1a54906a8da"), "l2-e-personal-care", "", True, "new"),
    ("demo-p-08-10", "Electric Trimmer Pro",       "0.5–7mm cordless trimmer with 4 guide combs, USB-C charge.",                 799,  1199, "l1-electronics", [], 18, _img("photo-1522338242992-e1a54906a8da"), "l2-e-personal-care", "", True, None),
]

# ---------------------------------------------------------------------------
# Store 9 — Steel City Formals  ·  Sector 9  ·  Men formal & smart-casual
# ---------------------------------------------------------------------------
_S9_MID = "demo-m-09"
_S9_SID = f"store-m-{_S9_MID}"
_S9_NAME = "Steel City Formals"

MERCHANT_09 = _mk_merchant(_S9_MID, "9111000009", _S9_NAME, "Deepak Verma")
STORE_09 = _mk_store(
    _S9_MID, _S9_NAME,
    tagline="Dressed for the boardroom, built for Bhilai",
    story="Deepak tailors each piece to fit Bhilai's steel city spirit — smart, strong, and dependable. His shirts are the go-to for office-goers at BSP.",
    area_slug="sector_9",
    banner=_img("photo-1617137968427-85924c800a22", 1200),
    specialties=["Men", "Formal shirts", "Trousers", "Business casual", "Jeans"],
)

_PRODUCTS_09 = [
    ("demo-p-09-01", "Oxford Formal Shirt",        "100% cotton Oxford weave formal shirt with button-down collar.",              1199, 1799, "l1-men", _M_SIZES, 20, _img("photo-1602810318383-e386cc2a3ccf"), "l2-m-shirt",     "", True,  "best_seller"),
    ("demo-p-09-02", "Linen Check Shirt",          "Linen-blend check shirt with single-button chest pocket.",                   999,  1499, "l1-men", _M_SIZES, 18, _img("photo-1602810318383-e386cc2a3ccf"), "l2-m-shirt",     "", True,  None),
    ("demo-p-09-03", "Slim Fit Dress Shirt",       "Slim-fit poplin shirt in solid white, stays tucked all day.",               1399, 1999, "l1-men", _M_SIZES, 22, _img("photo-1602810318383-e386cc2a3ccf"), "l2-m-shirt",     "", True,  "new"),
    ("demo-p-09-04", "Printed Casual Shirt",       "Subtle geometric print in cotton, great for casual Fridays.",               799,  1199, "l1-men", _M_SIZES, 25, _img("photo-1602810318383-e386cc2a3ccf"), "l2-m-shirt",     "", True,  None),
    ("demo-p-09-05", "Formal Straight Trousers",   "Flat-front straight trousers in tropical wool blend.",                      1299, 1999, "l1-men", _M_SIZES, 18, _img("photo-1624378439575-d8705ad7ae80"), "l2-m-pants",     "", True,  "best_seller"),
    ("demo-p-09-06", "Chino Slim Pants",           "Garment-washed slim chino, wear to work or weekend.",                      1099, 1599, "l1-men", _M_SIZES, 20, _img("photo-1624378439575-d8705ad7ae80"), "l2-m-pants",     "", True,  None),
    ("demo-p-09-07", "Cargo Work Pants",           "Multi-pocket cargo in canvas with reinforced knees.",                      1199, 1799, "l1-men", _M_SIZES, 16, _img("photo-1624378439575-d8705ad7ae80"), "l2-m-pants",     "", True,  None),
    ("demo-p-09-08", "Slim Dark Wash Jeans",       "5-pocket slim jeans in dark indigo, soft-hand stretch denim.",             1499, 2199, "l1-men", _M_SIZES, 22, _img("photo-1542272604-787c3835535d"), "l2-m-jeans",     "", True,  "new"),
    ("demo-p-09-09", "Distressed Blue Jeans",      "Mid-rise distressed jeans with whisker fading, slim taper.",               1299, 1999, "l1-men", _M_SIZES, 18, _img("photo-1542272604-787c3835535d"), "l2-m-jeans",     "", True,  None),
    ("demo-p-09-10", "Active Polo T-Shirt",        "Pique polo with moisture management, semi-fitted, three-button placket.",  899,  1299, "l1-men", _M_SIZES, 25, _img("photo-1483721310020-03333e577078"), "l2-m-activewear","", True,  None),
]

# ---------------------------------------------------------------------------
# Store 10 — Zonal Style Hub  ·  Kumhari  ·  Accessories + Women misc
# ---------------------------------------------------------------------------
_S10_MID = "demo-m-10"
_S10_SID = f"store-m-{_S10_MID}"
_S10_NAME = "Zonal Style Hub"

MERCHANT_10 = _mk_merchant(_S10_MID, "9111000010", _S10_NAME, "Kavita Joshi")
STORE_10 = _mk_store(
    _S10_MID, _S10_NAME,
    tagline="The finishing touch to every outfit",
    story="Kavita handpicks artisan accessories from local craft markets and pairs them with her own women's capsule collection.",
    area_slug="kumhari",
    banner=_img("photo-1492707892479-7bc8d5a4ee93", 1200),
    specialties=["Accessories", "Bags", "Jewellery", "Women dresses", "Skirts"],
)

_PRODUCTS_10 = [
    ("demo-p-10-01", "Beaded Layered Necklace",    "Seed-bead layered statement necklace with brass fittings.",                  699,  999,  "l1-accessories", [], 25, _img("photo-1492707892479-7bc8d5a4ee93"), "", "women",  True,  "best_seller"),
    ("demo-p-10-02", "Handwoven Tote Bag",         "Jute-cotton blend tote with interior zip pocket, 15L capacity.",            1299, 1999, "l1-accessories", [], 18, _img("photo-1492707892479-7bc8d5a4ee93"), "", "women",  True,  None),
    ("demo-p-10-03", "Boho Earrings Set",          "Set of 3 pairs — hoops, drops, and studs in oxidised silver finish.",       499,  799,  "l1-accessories", [], 30, _img("photo-1492707892479-7bc8d5a4ee93"), "", "women",  False, "new"),
    ("demo-p-10-04", "Canvas Drawstring Backpack", "15L backpack in canvas with laptop sleeve, unisex.",                        1499, 2199, "l1-accessories", [], 15, _img("photo-1492707892479-7bc8d5a4ee93"), "", "unisex", True,  None),
    ("demo-p-10-05", "Braided Leather Belt",       "Genuine leather braid belt, auto-lock buckle, M/L/XL.",                    599,  899,  "l1-accessories", ["M","L","XL"], 20, _img("photo-1492707892479-7bc8d5a4ee93"), "", "men", True, None),
    ("demo-p-10-06", "Ruffle Hem Midi Skirt",      "Chiffon tiered ruffle skirt, elasticated waist.",                          899,  1299, "l1-women", _W_SIZES, 20, _img("photo-1594938298603-c8148c4b4043"), "l2-w-bottomwear", "", True,  None),
    ("demo-p-10-07", "Printed Linen Shorts",       "Relaxed linen shorts in tropical print, side pockets.",                    699,  999,  "l1-women", _W_SIZES, 22, _img("photo-1594938298603-c8148c4b4043"), "l2-w-bottomwear", "", True,  "new"),
    ("demo-p-10-08", "High Waist Wide Leg Pants",  "Wide-leg pants in textured crepe, high rise, pull-on.",                   1099, 1599, "l1-women", _W_SIZES, 18, _img("photo-1594938298603-c8148c4b4043"), "l2-w-bottomwear", "", True,  None),
    ("demo-p-10-09", "Floral Sundress",            "Square-neck sundress in rayon challis, adjustable straps.",                1299, 1899, "l1-women", _W_SIZES, 16, _img("photo-1572804013309-59a88b7e92f1"), "l2-w-dresses",    "", True,  "best_seller"),
    ("demo-p-10-10", "Bodycon Evening Dress",      "Stretch crepe bodycon with asymmetric neckline, knee length.",             1699, 2499, "l1-women", _W_SIZES, 12, _img("photo-1572804013309-59a88b7e92f1"), "l2-w-dresses",    "", True,  None),
]

# ---------------------------------------------------------------------------
# Assemble all documents
# ---------------------------------------------------------------------------
ALL_MERCHANTS = [
    MERCHANT_01, MERCHANT_02, MERCHANT_03, MERCHANT_04, MERCHANT_05,
    MERCHANT_06, MERCHANT_07, MERCHANT_08, MERCHANT_09, MERCHANT_10,
]

ALL_STORES = [
    STORE_01, STORE_02, STORE_03, STORE_04, STORE_05,
    STORE_06, STORE_07, STORE_08, STORE_09, STORE_10,
]

_ALL_PRODUCT_SPECS = [
    (_S1_SID, _S1_MID, _S1_NAME, _PRODUCTS_01),
    (_S2_SID, _S2_MID, _S2_NAME, _PRODUCTS_02),
    (_S3_SID, _S3_MID, _S3_NAME, _PRODUCTS_03),
    (_S4_SID, _S4_MID, _S4_NAME, _PRODUCTS_04),
    (_S5_SID, _S5_MID, _S5_NAME, _PRODUCTS_05),
    (_S6_SID, _S6_MID, _S6_NAME, _PRODUCTS_06),
    (_S7_SID, _S7_MID, _S7_NAME, _PRODUCTS_07),
    (_S8_SID, _S8_MID, _S8_NAME, _PRODUCTS_08),
    (_S9_SID, _S9_MID, _S9_NAME, _PRODUCTS_09),
    (_S10_SID, _S10_MID, _S10_NAME, _PRODUCTS_10),
]

ALL_PRODUCTS = []
for _sid, _mid, _sname, _specs in _ALL_PRODUCT_SPECS:
    for _spec in _specs:
        pid, name, desc, price, mrp, l1, sizes, qty, img = _spec[:9]
        l2 = _spec[9] if len(_spec) > 9 else ""
        gender = _spec[10] if len(_spec) > 10 else ""
        re_flag = _spec[11] if len(_spec) > 11 else True
        badge = _spec[12] if len(_spec) > 12 else None
        ALL_PRODUCTS.append(
            _mk_product(_sid, _mid, _sname, pid, name, desc, price, mrp,
                        l1, sizes, qty, img, l2_id=l2, gender=gender,
                        return_eligible=re_flag, badge=badge)
        )

_DEMO_MERCHANT_IDS = [m["id"] for m in ALL_MERCHANTS]
_DEMO_STORE_IDS = [s["id"] for s in ALL_STORES]
_DEMO_PRODUCT_IDS = [p["id"] for p in ALL_PRODUCTS]


# ---------------------------------------------------------------------------
# Seed entry point
# ---------------------------------------------------------------------------
async def up(db):
    # Idempotent: remove any previously seeded demo docs
    await db.products.delete_many({"id": {"$in": _DEMO_PRODUCT_IDS}})
    await db.stores.delete_many({"id": {"$in": _DEMO_STORE_IDS}})
    await db.merchants.delete_many({"id": {"$in": _DEMO_MERCHANT_IDS}})

    await db.merchants.insert_many(ALL_MERCHANTS)
    await db.stores.insert_many(ALL_STORES)
    await db.products.insert_many(ALL_PRODUCTS)

    # Back-fill storefront reference on each merchant
    for store in ALL_STORES:
        await db.merchants.update_one(
            {"id": store["merchant_id"]},
            {"$set": {"storefront": store}},
        )

    return {
        "merchants": len(ALL_MERCHANTS),
        "stores": len(ALL_STORES),
        "products": len(ALL_PRODUCTS),
    }
