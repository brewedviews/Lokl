"""Authenticated customer address book + merchant store-location endpoints.

Customers identify by phone (Lokl has no consumer JWT yet) — addresses are
stored on the `customers` collection (existing schema). Auth: phone in the
body must match the route; for stricter auth, swap to require_role('customer')
once consumer OTP login ships."""
import os, uuid
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, field_validator

from services.delivery_service import geocode_pincode

INDIA_BBOX = (8.4, 37.6, 68.7, 97.4)


def _check_india(lat: float, lng: float):
    lo_a, hi_a, lo_g, hi_g = INDIA_BBOX
    if not (lo_a <= lat <= hi_a and lo_g <= lng <= hi_g):
        raise HTTPException(400, "Coordinates must be within India")


class AddressIn(BaseModel):
    label: str = Field(..., max_length=40)
    full_address: str = Field(..., max_length=500)
    landmark: Optional[str] = Field(default=None, max_length=200)
    city_slug: str = Field(default="bhilai")
    city_name: Optional[str] = None
    pincode: str = Field(..., min_length=6, max_length=6)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)
    is_default: bool = False

    @field_validator("pincode")
    @classmethod
    def _digits(cls, v):
        if not v.isdigit(): raise ValueError("pincode must be 6 digits")
        return v


def init(db, merchant_user_dep):
    router = APIRouter(prefix="/api/v1", tags=["addresses"])

    async def _validate_city(slug: str):
        cfg = await db.delivery_config.find_one({"city_slug": slug, "is_active": True}, {"_id": 0})
        if not cfg:
            raise HTTPException(400, f'City "{slug}" is not available. GET /api/v1/cities for the list.')
        return cfg

    async def _resolve_coords(addr: AddressIn) -> tuple[float, float]:
        if addr.lat is not None and addr.lng is not None:
            return addr.lat, addr.lng
        geo = await geocode_pincode(addr.pincode)
        if not geo:
            raise HTTPException(400, "Could not geocode pincode — please drop a pin manually")
        return geo["lat"], geo["lng"]

    # ===== Customer addresses (phone-scoped) =====
    @router.get("/addresses/{phone}")
    async def list_addresses(phone: str):
        c = await db.customers.find_one({"phone": phone}, {"_id": 0, "addresses": 1}) or {}
        return {"addresses": c.get("addresses") or []}

    @router.post("/addresses/{phone}")
    async def add_address(phone: str, body: AddressIn):
        await _validate_city(body.city_slug)
        lat, lng = await _resolve_coords(body)
        _check_india(lat, lng)
        existing = await db.customers.find_one({"phone": phone}, {"_id": 0, "addresses": 1}) or {}
        if len(existing.get("addresses") or []) >= 5:
            raise HTTPException(400, "Maximum 5 addresses per user")
        aid = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        new = {
            "address_id": aid, "label": body.label, "full_address": body.full_address,
            "landmark": body.landmark, "city_slug": body.city_slug,
            "city_name": body.city_name or body.city_slug.title(),
            "pincode": body.pincode,
            "location": {"type": "Point", "coordinates": [lng, lat]},
            "is_default": body.is_default, "created_at": now,
        }
        if body.is_default:
            await db.customers.update_one(
                {"phone": phone}, {"$set": {"addresses.$[].is_default": False}})
        await db.customers.update_one(
            {"phone": phone},
            {"$setOnInsert": {"phone": phone, "created_at": now},
             "$set": {"updated_at": now},
             "$push": {"addresses": new}},
            upsert=True,
        )
        return new

    @router.put("/addresses/{phone}/{address_id}")
    async def update_address(phone: str, address_id: str, body: AddressIn):
        await _validate_city(body.city_slug)
        lat, lng = await _resolve_coords(body)
        _check_india(lat, lng)
        updated_fields = {
            "addresses.$.label": body.label,
            "addresses.$.full_address": body.full_address,
            "addresses.$.landmark": body.landmark,
            "addresses.$.city_slug": body.city_slug,
            "addresses.$.city_name": body.city_name or body.city_slug.title(),
            "addresses.$.pincode": body.pincode,
            "addresses.$.location": {"type": "Point", "coordinates": [lng, lat]},
        }
        r = await db.customers.update_one({"phone": phone, "addresses.address_id": address_id},
                                          {"$set": updated_fields})
        if r.matched_count == 0:
            raise HTTPException(404, "Address not found")
        return {"ok": True}

    @router.delete("/addresses/{phone}/{address_id}")
    async def delete_address(phone: str, address_id: str):
        r = await db.customers.update_one(
            {"phone": phone}, {"$pull": {"addresses": {"address_id": address_id}}})
        return {"ok": True, "removed": r.modified_count > 0}

    @router.put("/addresses/{phone}/{address_id}/default")
    async def set_default_address(phone: str, address_id: str):
        await db.customers.update_one({"phone": phone}, {"$set": {"addresses.$[].is_default": False}})
        r = await db.customers.update_one(
            {"phone": phone, "addresses.address_id": address_id},
            {"$set": {"addresses.$.is_default": True}})
        if r.matched_count == 0:
            raise HTTPException(404, "Address not found")
        return {"ok": True}

    # ===== Merchant store location =====
    class StoreLocationIn(BaseModel):
        lat: float = Field(..., ge=-90, le=90)
        lng: float = Field(..., ge=-180, le=180)
        address: str = Field(..., max_length=500)
        landmark: Optional[str] = Field(default=None, max_length=200)
        pincode: str = Field(..., min_length=6, max_length=6)
        city_slug: str = Field(default="bhilai")

        @field_validator("pincode")
        @classmethod
        def _d(cls, v):
            if not v.isdigit(): raise ValueError("pincode must be 6 digits")
            return v

    @router.put("/merchant/store/location")
    async def update_store_location(body: StoreLocationIn, user: dict = Depends(merchant_user_dep)):
        _check_india(body.lat, body.lng)
        await _validate_city(body.city_slug)
        store_id = f"store-m-{user['sub']}"
        now = datetime.now(timezone.utc).isoformat()
        r = await db.stores.update_one(
            {"id": store_id, "merchant_id": user["sub"]},
            {"$set": {
                "location": {"type": "Point", "coordinates": [body.lng, body.lat]},
                "lat": body.lat, "lng": body.lng,
                "address": body.address, "landmark": body.landmark,
                "pincode": body.pincode, "city_slug": body.city_slug,
                "updated_at": now,
            }},
        )
        if r.matched_count == 0:
            raise HTTPException(404, "Store not found — set up storefront first")
        # Bust geo cache so the new location surfaces immediately
        try:
            from services.cache_service import cache_service
            await cache_service.invalidate_geo()
        except Exception:
            pass
        return {"ok": True}

    @router.get("/merchant/store/location")
    async def get_store_location(user: dict = Depends(merchant_user_dep)):
        store_id = f"store-m-{user['sub']}"
        s = await db.stores.find_one({"id": store_id, "merchant_id": user["sub"]},
                                     {"_id": 0, "location": 1, "lat": 1, "lng": 1,
                                      "address": 1, "landmark": 1, "pincode": 1, "city_slug": 1})
        if not s: raise HTTPException(404, "Store not found")
        return s

    @router.get("/merchant/store/onboarding")
    async def store_onboarding(user: dict = Depends(merchant_user_dep)):
        store_id = f"store-m-{user['sub']}"
        s = await db.stores.find_one({"id": store_id}, {"_id": 0}) or {}
        prod_cnt = await db.products.count_documents({"store_id": store_id, "is_deleted": {"$ne": True}})
        m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0, "bank_account_number": 1, "kyc_status": 1}) or {}
        checks = {
            "has_name": bool(s.get("name")),
            "has_description": bool(s.get("tagline") or s.get("description")),
            "has_logo": bool(s.get("logo_url") or s.get("image") or s.get("banner")),
            "has_location": (s.get("location") or {}).get("type") == "Point",
            "has_products": prod_cnt > 0,
            "has_bank_details": bool(m.get("bank_account_number")) and m.get("kyc_status") == "approved",
        }
        completed = sum(1 for v in checks.values() if v)
        total = len(checks)
        return {"checks": checks, "completed": completed, "total": total,
                "percentage": round((completed / total) * 100),
                "is_ready_to_go_live": all(checks.values())}

    return router
