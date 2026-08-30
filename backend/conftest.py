"""Pytest bootstrap — loads .env files and bridges the legacy CRA env name.

Post iter-37 (Next.js cutover) the frontend env file moved from
`frontend/.env` → `frontend/.env.local` and the URL key changed from
`REACT_APP_BACKEND_URL` → `NEXT_PUBLIC_API_URL`. The integration tests
were written against the legacy name. Rather than touch every file we set
`REACT_APP_BACKEND_URL` here so the legacy `os.environ[...]` reads keep
working.

Iter-26 — integration suite gating. Most of `/app/backend/tests/*` hit the
running FastAPI server over HTTP. In CI we don't (yet) boot the app, so
those tests would 401 / connection-error in confusing ways. We probe the
URL once at session start; if it's not reachable we mark every collected
test in the integration-style files as `pytest.skip(...)`. Pure-import
unit tests in the same folder still run as normal.
"""
import os
import socket
from pathlib import Path
from urllib.parse import urlparse

import pytest
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT.parent / "frontend" / ".env.local")
load_dotenv(ROOT.parent / "frontend" / ".env")
load_dotenv(ROOT / ".env")

if "REACT_APP_BACKEND_URL" not in os.environ:
    fallback = os.environ.get("NEXT_PUBLIC_API_URL") or "http://localhost:8001"
    os.environ["REACT_APP_BACKEND_URL"] = fallback


def _backend_reachable(url: str) -> bool:
    """Cheap TCP-level probe — no HTTP request, no auth, no DB."""
    try:
        parts = urlparse(url)
        host = parts.hostname
        port = parts.port or (443 if parts.scheme == "https" else 80)
        if not host:
            return False
        with socket.create_connection((host, port), timeout=2):
            return True
    except Exception:
        return False


_BACKEND_LIVE = _backend_reachable(os.environ["REACT_APP_BACKEND_URL"])

# Files that contact the live API over HTTP. Skipped automatically when
# the backend isn't reachable from the test runner (CI, fresh sandbox).
_INTEGRATION_FILES = {
    "test_admin_merchant_parity.py",
    "test_admin_product_creation.py",
    "test_admin_storefront_setup.py",
    "test_discount_percent.py",
    "test_backend.py",
    "test_backlog_lokl_prefix.py",
    "test_db_hardening.py",
    "test_iter11_extras.py",
    "test_iter18_cloudinary_wiring.py",
    "test_iter19_online_toggle.py",
    "test_iter22_regression.py",
    "test_iter23_home_reorder.py",
    "test_iter24_header_location.py",
    "test_iter3_flow.py",
    "test_iter4_flow.py",
    "test_iter5_flow.py",
    "test_kyc_admin_flow.py",
    "test_multi_merchant_orders.py",
    "test_phase1_returns.py",
    "test_phase2_phase3.py",
    "test_phase2_returns_dashboard.py",
    "test_phase3_ai_enhance.py",
    "test_phase4_admin_gap.py",
    "test_phaseA_redirect.py",
    "test_phaseB_kyc_phone.py",
    "test_phaseC_xlsx.py",
    "test_v2_homepage_feeds.py",
}


def pytest_collection_modifyitems(config, items):
    if _BACKEND_LIVE:
        return
    skip_marker = pytest.mark.skip(
        reason="Live backend unreachable — integration suite needs a running "
        "FastAPI server + seeded DB. Run against the preview/staging URL."
    )
    for item in items:
        if Path(item.fspath).name in _INTEGRATION_FILES:
            item.add_marker(skip_marker)

