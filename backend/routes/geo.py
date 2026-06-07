"""v1 geolocation router — nearby stores, nearby products, delivery estimate,
cities directory, city detection.

Mounted at /api/v1/* (separate from the legacy /api/* surface so existing
clients keep working). Customers do NOT need auth for discovery; merchants
authenticate for /merchant/store/location (defined in server.py to share the
existing `merchant_user` dependency)."""
from typing import Optional
from decimal import Decimal
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel, Field

from services.delivery_service import DeliveryService, detect_customer_city
from services.cache_service import cache_service

router = APIRouter(prefix="/api/v1", tags=["geo"])

INDIA_BBOX = (8.4, 37.6, 68.7, 97.4)  # (lat_min, lat_max, lng_min, lng_max)


def _check_india_bbox(lat: float, lng: float):
    lat_min, lat_max, lng_min, lng_max = INDIA_BBOX
    if not (lat_min <= lat <= lat_max and lng_min <= lng <= lng_max):
        raise HTTPException(400, "Coordinates must be within India")


def init(db):
    """Wire the router to the shared Motor db (called from server.py)."""
    delivery = DeliveryService(db)

    @router.get("/stores/nearby")
    async def stores_nearby(
        lat: float = Query(..., ge=-90, le=90),
        lng: float = Query(..., ge=-180, le=180),
        radius_km: float = Query(default=5.0, ge=0.1, le=50.0),
        category: Optional[str] = Query(default=None),
        page: int = Query(default=1, ge=1),
        limit: int = Query(default=20, ge=1, le=50),
    ):
        _check_india_bbox(lat, lng)
        # Cache lookup
        ckey = cache_service.make_geo_key(lat, lng, radius_km, category=category, page=page, limit=limit)
        cached = await cache_service.get(ckey)
        if cached: return cached

        match = {
            "is_deleted": {"$ne": True},
            "published": True,
            "paused": {"$ne": True},
            "kyc_status": "approved",  # this codebase's "is_verified" equivalent
            "location.type": "Point",
        }
        if category:
            match["category"] = category

        skip = (page - 1) * limit
        pipeline = [
            {"$geoNear": {
                "near": {"type": "Point", "coordinates": [lng, lat]},
                "distanceField": "distance_meters",
                "maxDistance": radius_km * 1000,
                "spherical": True,
                "query": match,
            }},
            {"$addFields": {"distance_km": {"$round": [{"$divide": ["$distance_meters", 1000]}, 2]}}},
            {"$skip": skip}, {"$limit": limit},
            {"$project": {
                "_id": 0, "id": 1, "name": 1, "description": 1, "category": 1,
                "logo_url": 1, "image": 1, "banner": 1, "address": 1, "city": 1,
                "tagline": 1, "rating": 1, "product_count": 1,
                "opens_at": 1, "closes_at": 1, "online": 1,
                "distance_km": 1, "distance_meters": 1, "location": 1,
            }},
        ]
        stores = await db.stores.aggregate(pipeline).to_list(length=limit)

        count_pipe = [
            {"$geoNear": {"near": {"type": "Point", "coordinates": [lng, lat]},
                          "distanceField": "d", "maxDistance": radius_km * 1000,
                          "spherical": True, "query": match}},
            {"$count": "total"},
        ]
        cr = await db.stores.aggregate(count_pipe).to_list(length=1)
        total = cr[0]["total"] if cr else 0
        result = {
            "stores": stores,
            "pagination": {"page": page, "limit": limit, "total": total, "pages": -(-total // limit)},
            "query": {"lat": lat, "lng": lng, "radius_km": radius_km},
        }
        await cache_service.set(ckey, result, ttl=300)
        return result

    @router.get("/products/nearby")
    async def products_nearby(
        lat: float = Query(..., ge=-90, le=90),
        lng: float = Query(..., ge=-180, le=180),
        radius_km: float = Query(default=5.0, ge=0.1, le=50.0),
        category: Optional[str] = Query(default=None),
        min_price: Optional[float] = Query(default=None, ge=0),
        max_price: Optional[float] = Query(default=None, ge=0),
        sort_by: str = Query(default="distance"),
        page: int = Query(default=1, ge=1),
        limit: int = Query(default=20, ge=1, le=50),
    ):
        _check_india_bbox(lat, lng)
        if min_price is not None and max_price is not None and min_price > max_price:
            raise HTTPException(400, "min_price cannot exceed max_price")
        skip = (page - 1) * limit

        # Step 1 — nearby stores
        store_pipe = [
            {"$geoNear": {"near": {"type": "Point", "coordinates": [lng, lat]},
                          "distanceField": "distance_meters",
                          "maxDistance": radius_km * 1000, "spherical": True,
                          "query": {"is_deleted": {"$ne": True}, "published": True,
                                    "paused": {"$ne": True}, "kyc_status": "approved",
                                    "location.type": "Point"}}},
            {"$project": {"_id": 0, "id": 1, "name": 1, "distance_meters": 1,
                          "distance_km": {"$round": [{"$divide": ["$distance_meters", 1000]}, 2]}}},
        ]
        nearby = await db.stores.aggregate(store_pipe).to_list(length=200)
        if not nearby:
            return {"products": [], "pagination": {"page": page, "limit": limit, "total": 0, "pages": 0}}
        sd = {s["id"]: {"distance_meters": s["distance_meters"], "distance_km": s["distance_km"],
                        "store_name": s["name"]} for s in nearby}
        store_ids = list(sd.keys())

        pf = {"store_id": {"$in": store_ids}, "is_deleted": {"$ne": True},
              "paused": {"$ne": True}}
        if category: pf["category"] = category
        if min_price is not None: pf.setdefault("price", {})["$gte"] = min_price
        if max_price is not None: pf.setdefault("price", {})["$lte"] = max_price

        sort_map = {"price_asc": [("price", 1)], "price_desc": [("price", -1)],
                    "newest": [("created_at", -1)]}
        mongo_sort = sort_map.get(sort_by)
        pp = [{"$match": pf}]
        if mongo_sort:
            pp.append({"$sort": dict(mongo_sort)})
        pp += [{"$skip": skip}, {"$limit": limit},
               {"$project": {"_id": 0, "id": 1, "name": 1, "description": 1,
                             "price": 1, "mrp": 1, "category": 1, "image": 1,
                             "images": 1, "stock": 1, "store_id": 1, "created_at": 1}}]
        products = await db.products.aggregate(pp).to_list(length=limit)
        for p in products:
            s = sd.get(p.get("store_id"), {})
            p["store_distance_km"] = s.get("distance_km")
            p["store_distance_meters"] = s.get("distance_meters")
            p["store_name"] = s.get("store_name")
        if sort_by == "distance":
            products.sort(key=lambda p: p.get("store_distance_meters", float("inf")))
        total = await db.products.count_documents(pf)
        return {"products": products,
                "pagination": {"page": page, "limit": limit, "total": total, "pages": -(-total // limit)}}

    class DeliveryEstimateRequest(BaseModel):
        customer_lat: float = Field(..., ge=-90, le=90)
        customer_lng: float = Field(..., ge=-180, le=180)
        store_id: str
        order_subtotal: float = Field(..., ge=0)
        city_slug: str = Field(default="bhilai")

    @router.post("/delivery/estimate")
    async def delivery_estimate(body: DeliveryEstimateRequest):
        _check_india_bbox(body.customer_lat, body.customer_lng)
        store = await db.stores.find_one({"id": body.store_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not store: raise HTTPException(404, "Store not found")
        loc = store.get("location") or {}
        if loc.get("type") != "Point":
            # Fall back to flat lat/lng for legacy docs the migration couldn't backfill
            if store.get("lat") is None or store.get("lng") is None:
                raise HTTPException(400, "Store location not set")
            store_lat, store_lng = float(store["lat"]), float(store["lng"])
        else:
            store_lng, store_lat = loc["coordinates"][0], loc["coordinates"][1]
        try:
            fee = await delivery.calculate_delivery_fee(
                customer_lat=body.customer_lat, customer_lng=body.customer_lng,
                store_lat=store_lat, store_lng=store_lng,
                order_subtotal=Decimal(str(body.order_subtotal)), city_slug=body.city_slug)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if not fee["deliverable"]:
            raise HTTPException(400, fee["reason"])
        eta = await delivery.calculate_eta_minutes(distance_km=fee["distance_km"], city_slug=body.city_slug)
        return {**fee, **eta}

    @router.get("/cities")
    async def list_cities():
        cities = await db.delivery_config.find(
            {"is_active": True},
            {"_id": 0, "city_slug": 1, "city_name": 1, "state": 1, "max_delivery_radius_km": 1},
        ).to_list(length=50)
        return {"cities": cities}

    @router.get("/cities/detect")
    async def detect_city(lat: float = Query(..., ge=-90, le=90),
                          lng: float = Query(..., ge=-180, le=180)):
        _check_india_bbox(lat, lng)
        slug = await detect_customer_city(db, lat, lng)
        if slug == "unknown":
            return {"city_slug": "unknown", "city_name": None}
        cfg = await db.delivery_config.find_one({"city_slug": slug}, {"_id": 0, "city_slug": 1, "city_name": 1})
        return cfg or {"city_slug": slug, "city_name": slug.title()}

    @router.get("/cities/{city_slug}")
    async def get_city(city_slug: str):
        cfg = await db.delivery_config.find_one({"city_slug": city_slug, "is_active": True}, {"_id": 0})
        if not cfg: raise HTTPException(404, "City not found")
        return cfg

    # Iter-24 — neighbourhood / area cluster reverse-lookup. Given a lat/lng
    # we return the nearest Bhilai area name so the consumer header can show
    # "Smriti Nagar" instead of just "Bhilai". The lookup is intentionally a
    # tiny hard-coded table keyed by approximate centroids — fancy enough for
    # the pilot, no third-party geocoder bill. Out-of-Bhilai coordinates fall
    # through to the parent city detector (returns `cluster=None`).
    BHILAI_CLUSTERS = [
        # (name, lat, lng) — distinct centroids only. Smriti Nagar is the
        # canonical name for the 21.1938,81.3509 hub (was duplicated with
        # "Bhilai Nagar" pre-iter-25 which made min() non-deterministic).
        ("Smriti Nagar",   21.1938, 81.3509),
        ("Junwani",        21.2046, 81.3370),
        ("Risali",         21.2167, 81.3833),
        ("Nehru Nagar",    21.1944, 81.3147),
        ("Supela",         21.1922, 81.3128),
        ("Vaishali Nagar", 21.2056, 81.3617),
        ("Kohka",          21.2278, 81.3508),
        ("Power House",    21.2014, 81.3417),
        ("Sector 6",       21.2114, 81.3796),
        ("Sector 10",      21.2052, 81.3914),
        ("Bhilai 3",       21.2294, 81.3658),
        ("Khursipar",      21.2153, 81.3953),
        ("Hudco",          21.2206, 81.3286),
        ("Jamul",          21.1681, 81.3681),
    ]

    @router.get("/location/cluster")
    async def location_cluster(lat: float = Query(..., ge=-90, le=90),
                               lng: float = Query(..., ge=-180, le=180)):
        """Resolve a lat/lng to the nearest Bhilai cluster.

        Returns `{cluster, distance_km, in_service}`. When the customer is
        outside Bhilai's max_delivery_radius_km we still return the closest
        cluster but mark `in_service=False` so the UI can warn them.
        """
        from math import radians, sin, cos, asin, sqrt
        def hav(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
            r_lat1, r_lat2 = radians(a_lat), radians(b_lat)
            d_lat = radians(b_lat - a_lat)
            d_lng = radians(b_lng - a_lng)
            h = sin(d_lat / 2) ** 2 + cos(r_lat1) * cos(r_lat2) * sin(d_lng / 2) ** 2
            return 2 * 6371 * asin(sqrt(h))

        best = min(BHILAI_CLUSTERS, key=lambda c: hav(lat, lng, c[1], c[2]))
        dist = round(hav(lat, lng, best[1], best[2]), 2)

        slug = await detect_customer_city(db, lat, lng)
        in_service = slug == "bhilai"
        return {
            "cluster": best[0] if in_service else None,
            "nearest_cluster": best[0],
            "distance_km": dist,
            "in_service": in_service,
            "city_slug": slug,
        }

    return router

