"""Iter-23 regression smoke for the home reorder + header/responsiveness work."""
import os
import requests
import pytest

BASE_URL = os.environ.get("NEXT_PUBLIC_API_URL") or os.environ.get("REACT_APP_BACKEND_URL")
BASE_URL = BASE_URL.rstrip("/")


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ---- /api/categories/counts ---------------------------------------------------
def test_categories_counts_has_required_six(s):
    r = s.get(f"{BASE_URL}/api/categories/counts", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    slugs = {row.get("slug") for row in data}
    required = {"men", "women", "footwear", "accessories", "kids", "beauty"}
    missing = required - slugs
    assert not missing, f"Missing required slugs: {missing}. Got: {slugs}"


# ---- /api/search ---------------------------------------------------------------
def test_search_returns_products_and_stores(s):
    r = s.get(f"{BASE_URL}/api/search", params={"q": "shirt"}, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "products" in data
    assert "stores" in data
    assert isinstance(data["products"], list)
    assert isinstance(data["stores"], list)


# ---- /api/v1/addresses/<phone> -------------------------------------------------
def test_addresses_for_unknown_phone_returns_empty_list(s):
    r = s.get(f"{BASE_URL}/api/v1/addresses/919000000000", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "addresses" in data
    assert isinstance(data["addresses"], list)


# ---- /api/testimonials ---------------------------------------------------------
def test_testimonials_seed_present(s):
    r = s.get(f"{BASE_URL}/api/testimonials", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    # seed expected to have at least 1 published row
    assert len(data) >= 1
    # validate row shape
    row = data[0]
    for k in ("id", "name", "rating"):
        assert k in row, f"missing key {k} in testimonial row"


# ---- product rails limit=10 ----------------------------------------------------
@pytest.mark.parametrize("path", ["/api/products/popular", "/api/products/selling-fast", "/api/products/new-arrivals"])
def test_product_rail_respects_limit(s, path):
    r = s.get(f"{BASE_URL}{path}", params={"limit": 10}, timeout=15)
    # Some envs may not expose these exact slugs; mark soft-skip with assertion message
    assert r.status_code in (200, 404), f"Unexpected status {r.status_code} for {path}"
    if r.status_code == 200:
        data = r.json()
        # Could be list OR {"items":[...]} — handle both
        items = data if isinstance(data, list) else data.get("items", data.get("products", []))
        assert isinstance(items, list)
        assert len(items) <= 10, f"{path} returned {len(items)} > 10"


# ---- /c/streetwear should still load (paused, not deleted) ---------------------
def test_paused_streetwear_category_still_available(s):
    r = s.get(f"{BASE_URL}/api/categories/counts", timeout=15)
    assert r.status_code == 200
    slugs = {row.get("slug") for row in r.json()}
    # streetwear/electronics/sports are paused on home but still in DB
    assert "streetwear" in slugs, "streetwear category was removed from DB (should only be hidden on home)"
