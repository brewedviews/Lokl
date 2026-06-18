"""Geolocation core service — delivery fee + ETA + city detection.

ADDING A NEW CITY TO LOKL:
  1. Insert a delivery_config document (copy bhilai_config.py, edit city_slug/
     city_name/state/delivery_tiers/eta_config based on local pricing).
  2. Add the city's bounding box to CITY_BOUNDS in detect_customer_city().
  3. Add pincode mappings to INDIA_PINCODE_MAP in geocode_pincode().
  4. Run: python -m seeds.run <city>_config
  5. No code deploy needed for tier-fee tuning — edit the delivery_config doc.
"""
import math, os
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timezone
from typing import Optional

# Per-city bounding boxes (lat_min, lat_max, lng_min, lng_max).
# Add new entries here when expanding beyond Bhilai.
CITY_BOUNDS = {
    "bhilai": (21.10, 21.28, 81.28, 81.48),
    # "raipur": (21.18, 21.32, 81.55, 81.75),
    # "durg":   (21.17, 21.24, 81.25, 81.35),
}

# Static pincode → coordinates fallback (used when GOOGLE_MAPS_API_KEY is unset).
INDIA_PINCODE_MAP = {
    "490001": {"lat": 21.1938, "lng": 81.3509, "label": "Bhilai - Sector 1"},
    "490006": {"lat": 21.2138, "lng": 81.4009, "label": "Bhilai - Sector 6"},
    "490009": {"lat": 21.1838, "lng": 81.3809, "label": "Bhilai - Sector 9"},
    "490020": {"lat": 21.1638, "lng": 81.3609, "label": "Bhilai - Supela"},
    "490023": {"lat": 21.2238, "lng": 81.4209, "label": "Bhilai - Nehru Nagar"},
}


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> Decimal:
    """Distance in km between two coords as Decimal (3 dp)."""
    R = 6371.0
    lat1_r = math.radians(lat1); lat2_r = math.radians(lat2)
    dlat = math.radians(lat2 - lat1); dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlng / 2) ** 2
    return Decimal(str(round(R * 2 * math.asin(math.sqrt(a)), 3)))


class DeliveryService:
    def __init__(self, db):
        self.db = db

    async def get_city_config(self, city_slug: str) -> dict:
        cfg = await self.db.delivery_config.find_one({"city_slug": city_slug, "is_active": True}, {"_id": 0})
        if not cfg:
            raise ValueError(f"No delivery config for city: {city_slug}")
        return cfg

    async def calculate_delivery_fee(self, customer_lat: float, customer_lng: float,
                                     store_lat: float, store_lng: float,
                                     order_subtotal: Decimal, city_slug: str) -> dict:
        cfg = await self.get_city_config(city_slug)
        dist = haversine_km(customer_lat, customer_lng, store_lat, store_lng)
        max_r = Decimal(str(cfg["max_delivery_radius_km"]))
        if dist > max_r:
            return {"deliverable": False,
                    "reason": f"Distance {dist}km exceeds maximum delivery radius of {max_r}km for {city_slug}",
                    "distance_km": float(dist), "fee": None}

        matched = None
        for tier in cfg["delivery_tiers"]:
            if Decimal(str(tier["min_km"])) <= dist < Decimal(str(tier["max_km"])):
                matched = tier; break
        if not matched and cfg["delivery_tiers"]:
            matched = cfg["delivery_tiers"][-1]
        if not matched:
            return {"deliverable": False, "reason": "No delivery tier configured for this distance",
                    "distance_km": float(dist), "fee": None}

        base = Decimal(str(matched["base_fee"]))
        per_km = Decimal(str(matched["per_km_fee"]))
        fee = (base + per_km * dist).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        # Env vars FREE_DELIVERY_THRESHOLD and DELIVERY_FEE override DB tier values
        # when set (useful for quick pilot-period adjustments without a DB edit).
        env_threshold = os.environ.get("FREE_DELIVERY_THRESHOLD")
        env_flat_fee = os.environ.get("DELIVERY_FEE")
        free_above = Decimal(env_threshold) if env_threshold else Decimal(str(matched["free_above_order_value"]))
        if env_flat_fee:
            fee = Decimal(env_flat_fee).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        is_free = order_subtotal >= free_above
        final = Decimal("0.00") if is_free else fee
        return {
            "deliverable": True,
            "distance_km": float(dist),
            "tier": matched["tier_name"],
            "fee": float(final),
            "fee_before_discount": float(fee),
            "is_free_delivery": is_free,
            "free_delivery_threshold": float(free_above),
            "amount_for_free_delivery": float(free_above - order_subtotal) if order_subtotal < free_above else 0,
            "currency": cfg["currency"],
        }

    async def calculate_eta_minutes(self, distance_km: float, city_slug: str,
                                    current_time: Optional[datetime] = None) -> dict:
        if current_time is None:
            current_time = datetime.now(timezone.utc)
        cfg = await self.get_city_config(city_slug)
        eta = cfg.get("eta_config", {})
        base_prep = eta.get("base_prep_minutes", 15)
        per_km = eta.get("per_km_minutes", 4)
        peak_hours = eta.get("peak_hours", [])
        peak_mult = eta.get("peak_multiplier", 1.4)

        travel = distance_km * per_km
        total = base_prep + travel

        # IST = UTC + 5:30 — convert UTC clock to IST HH:MM string
        ist_total_min = (current_time.hour * 60 + current_time.minute + 330) % (24 * 60)
        ist_h = ist_total_min // 60; ist_m = ist_total_min % 60
        ist_str = f"{ist_h:02d}:{ist_m:02d}"
        is_peak = False
        for r in peak_hours:
            try:
                s, e = r.split("-")
                if s <= ist_str <= e:
                    is_peak = True; break
            except Exception:
                continue
        if is_peak:
            total = total * peak_mult
        total = round(total)
        eta_min = max(15, int(total * 0.85))
        eta_max = int(total * 1.15)
        return {
            "eta_minutes": total,
            "eta_range": f"{eta_min}-{eta_max} mins",
            "eta_min": eta_min, "eta_max": eta_max,
            "is_peak_hour": is_peak,
            "breakdown": {"prep_minutes": base_prep, "travel_minutes": round(travel),
                          "peak_adjustment": is_peak},
        }


async def detect_customer_city(db, lat: float, lng: float) -> str:
    """Bounding-box check against CITY_BOUNDS. Returns 'unknown' if no match."""
    for slug, (lat_min, lat_max, lng_min, lng_max) in CITY_BOUNDS.items():
        if lat_min <= lat <= lat_max and lng_min <= lng <= lng_max:
            cfg = await db.delivery_config.find_one({"city_slug": slug, "is_active": True}, {"_id": 0})
            if cfg: return slug
    return "unknown"


async def geocode_pincode(pincode: str) -> Optional[dict]:
    """Google Maps Geocoding if GOOGLE_MAPS_API_KEY set, else static fallback."""
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    if api_key:
        try:
            import httpx
            url = f"https://maps.googleapis.com/maps/api/geocode/json?address={pincode},India&key={api_key}"
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(url)
                d = r.json()
                if d.get("status") == "OK" and d.get("results"):
                    loc = d["results"][0]["geometry"]["location"]
                    return {"lat": loc["lat"], "lng": loc["lng"],
                            "formatted_address": d["results"][0]["formatted_address"]}
        except Exception:
            pass
    static = INDIA_PINCODE_MAP.get(pincode)
    if static:
        return {"lat": static["lat"], "lng": static["lng"], "formatted_address": static["label"]}
    return None
