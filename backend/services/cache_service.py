"""Redis-backed geo query cache with graceful degradation."""
import json, os
from typing import Optional, Any


class CacheService:
    def __init__(self):
        self.redis = None
        self.default_ttl = 300

    async def connect(self):
        url = os.environ.get("REDIS_URL", "").strip()
        if not url:
            print("[CACHE] REDIS_URL unset — running without cache")
            return
        try:
            import redis.asyncio as aioredis
            self.redis = await aioredis.from_url(
                url, encoding="utf-8", decode_responses=True,
                socket_timeout=2, socket_connect_timeout=2,
            )
            await self.redis.ping()
            print("[CACHE] Redis connected")
        except Exception as e:
            print(f"[CACHE] Redis unavailable — running without cache: {e}")
            self.redis = None

    def make_geo_key(self, lat: float, lng: float, radius_km: float, **kw) -> str:
        """Round to 3 dp (~111m precision) so neighbouring users share keys."""
        key = f"geo:{round(lat, 3)}:{round(lng, 3)}:{radius_km}"
        for k, v in sorted(kw.items()):
            if v is not None:
                key += f":{k}={v}"
        return key

    async def get(self, key: str) -> Optional[Any]:
        if not self.redis: return None
        try:
            v = await self.redis.get(key)
            return json.loads(v) if v else None
        except Exception:
            return None

    async def set(self, key: str, value: Any, ttl: int = None) -> None:
        if not self.redis: return
        try:
            await self.redis.setex(key, ttl or self.default_ttl, json.dumps(value, default=str))
        except Exception:
            pass

    async def invalidate_geo(self) -> None:
        """Flush every geo:* key — called on any store location/status change."""
        if not self.redis: return
        try:
            cur = 0
            while True:
                cur, keys = await self.redis.scan(cur, match="geo:*", count=200)
                if keys: await self.redis.delete(*keys)
                if cur == 0: break
        except Exception:
            pass


cache_service = CacheService()
