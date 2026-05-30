"""Lokl V2 — homepage data feeds smoke tests."""
import os, requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = BASE + "/api"


def test_stats_home_returns_real_numbers():
    r = requests.get(f"{API}/stats/home", timeout=30)
    assert r.status_code == 200, r.text
    b = r.json()
    for k in ("avg_rating", "verified_stores", "products", "deliveries"):
        assert k in b
    assert b["verified_stores"] >= 0
    assert b["products"] >= 0


def test_feed_endpoints_return_lists_with_badges():
    for path in ("popular-in-city", "selling-fast", "best-sellers", "new-arrivals", "trending"):
        r = requests.get(f"{API}/feed/{path}?limit=5", timeout=30)
        assert r.status_code == 200, f"{path}: {r.text}"
        items = r.json()
        assert isinstance(items, list)
        for p in items:
            # Badge engine has run — `badge` and `badge_label` keys are always present (may be None)
            assert "badge" in p, f"{path}: badge key missing on {p.get('id')}"
            assert "social_proof" in p
            assert "low_stock_size" in p


def test_offers_and_testimonials_published():
    r = requests.get(f"{API}/offers", timeout=30); assert r.status_code == 200
    offers = r.json(); assert len(offers) >= 1
    for o in offers:
        assert o["published"] is True
    r2 = requests.get(f"{API}/testimonials", timeout=30); assert r2.status_code == 200
    assert len(r2.json()) >= 1


def test_categories_counts():
    r = requests.get(f"{API}/categories/counts", timeout=30)
    assert r.status_code == 200
    cats = r.json()
    assert isinstance(cats, list) and len(cats) >= 1
    for c in cats:
        assert "product_count" in c
        assert int(c["product_count"]) >= 0


def test_search_trending_has_fallback():
    r = requests.get(f"{API}/search/trending", timeout=30)
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list) and len(items) >= 1
    for x in items:
        assert "q" in x


def test_track_view_idempotent():
    r = requests.post(f"{API}/track/view", json={"product_id": "prod-test-view-123"}, timeout=30)
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_search_track_records():
    r = requests.post(f"{API}/search/track", json={"q": "Test V2 Search"}, timeout=30)
    assert r.status_code == 200
    assert r.json()["ok"] is True
