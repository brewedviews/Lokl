"""Iter-24 backend regression — Bhilai cluster reverse-lookup, testimonials
zero-state, and search trending/track endpoints."""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL") or "https://lokl-returns-dash.preview.emergentagent.com"
BASE = BASE.rstrip("/")
API = f"{BASE}/api"


# ─────────────────────────── /v1/location/cluster ────────────────────────────
class TestLocationCluster:
    def test_bhilai_in_service(self):
        r = requests.get(f"{API}/v1/location/cluster", params={"lat": 21.21, "lng": 81.38}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["in_service"] is True
        assert data["city_slug"] == "bhilai"
        assert data["cluster"] is not None
        assert isinstance(data["cluster"], str) and len(data["cluster"]) > 0
        assert data["nearest_cluster"] == data["cluster"]
        assert data["distance_km"] < 5  # well under 5km from any Bhilai centroid

    def test_bhilai_smriti_nagar_exact(self):
        # Smriti Nagar centroid → should resolve to that exact cluster.
        r = requests.get(f"{API}/v1/location/cluster",
                         params={"lat": 21.1938, "lng": 81.3509}, timeout=20)
        assert r.status_code == 200
        d = r.json()
        # Either Smriti Nagar or Bhilai Nagar (same centroid in table) is acceptable.
        assert d["cluster"] in ("Smriti Nagar", "Bhilai Nagar")
        assert d["in_service"] is True
        assert d["distance_km"] < 0.5

    def test_delhi_out_of_service(self):
        r = requests.get(f"{API}/v1/location/cluster", params={"lat": 28.61, "lng": 77.21}, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["in_service"] is False
        assert d["cluster"] is None
        assert d["nearest_cluster"] is not None  # still surfaces nearest for UX
        assert d["city_slug"] == "unknown"
        assert 800 < d["distance_km"] < 1100  # ~920km Bhilai↔Delhi

    def test_lat_validation_422(self):
        r = requests.get(f"{API}/v1/location/cluster", params={"lat": -91, "lng": 77}, timeout=20)
        assert r.status_code == 422

    def test_lng_validation_422(self):
        r = requests.get(f"{API}/v1/location/cluster", params={"lat": 21, "lng": 200}, timeout=20)
        assert r.status_code == 422


# ─────────────────────────── /testimonials ───────────────────────────────────
class TestTestimonialsZeroState:
    def test_public_returns_empty(self):
        r = requests.get(f"{API}/testimonials", timeout=20)
        assert r.status_code == 200
        body = r.json()
        # accept either bare list or {items: []}
        items = body if isinstance(body, list) else body.get("items", body.get("testimonials", []))
        assert items == [] or len(items) == 0


# ─────────────────────────── /search/{trending,track} ────────────────────────
class TestSearchTrendingTrack:
    def test_trending_returns_at_least_one_item(self):
        r = requests.get(f"{API}/search/trending", timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 1
        for it in items:
            assert "q" in it and isinstance(it["q"], str) and len(it["q"]) > 0
            assert "count" in it

    def test_track_inserts_row(self):
        r = requests.post(f"{API}/search/track", json={"q": "TEST_iter24_foo"}, timeout=20)
        assert r.status_code == 200
        assert r.json() == {"ok": True}
        # Tracked term should later surface in trending (case-folded).
        rr = requests.get(f"{API}/search/trending", params={"limit": 50}, timeout=20)
        qs = [it["q"] for it in rr.json()]
        assert "test_iter24_foo" in qs

    def test_track_empty_q_rejected(self):
        r = requests.post(f"{API}/search/track", json={"q": ""}, timeout=20)
        assert r.status_code == 200
        assert r.json() == {"ok": False}
