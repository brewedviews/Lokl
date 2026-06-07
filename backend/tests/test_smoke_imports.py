"""Smoke unit tests — no HTTP, no DB, no live services.

These run in CI (where no backend server is booted) and assert the
application module can be imported, key endpoints are registered with
the FastAPI router, and the route prefixing convention holds.

If this file ever fails in CI, something broke at the import layer
(missing dependency, syntax error, etc.) and merging is unsafe.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path


def _add_backend_to_path() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    p = str(backend_root)
    if p not in sys.path:
        sys.path.insert(0, p)


def test_server_module_imports():
    """The FastAPI app must import cleanly with no top-level side-effects
    that crash the worker."""
    _add_backend_to_path()
    server = importlib.import_module("server")
    assert hasattr(server, "app"), "server.py must expose `app` (FastAPI instance)"


def test_api_routes_have_api_prefix():
    """All HTTP routes registered on the app must start with /api/* — this
    is the Kubernetes ingress contract documented in the system prompt."""
    _add_backend_to_path()
    server = importlib.import_module("server")
    bad: list[str] = []
    for route in server.app.routes:
        path = getattr(route, "path", "")
        if not path:
            continue
        if path in ("/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"):
            continue
        # `/internal/*` is a separate ingress-internal namespace gated by
        # INTERNAL_API_KEY (k8s liveness / DB ping) — not customer-facing.
        if path.startswith("/internal/"):
            continue
        if not path.startswith("/api"):
            bad.append(path)
    assert not bad, f"Routes missing /api prefix: {bad[:10]}"


def test_observability_module_imports():
    """Sentry boot module imports cleanly with DSN unset (graceful no-op)."""
    _add_backend_to_path()
    obs = importlib.import_module("observability")
    assert hasattr(obs, "init_sentry")


def test_notifications_module_imports():
    _add_backend_to_path()
    notif = importlib.import_module("notifications")
    assert hasattr(notif, "send_with_fallback")


def test_cloudinary_service_module_imports():
    _add_backend_to_path()
    svc = importlib.import_module("services.cloudinary_service")
    assert hasattr(svc, "upload_image")
    assert hasattr(svc, "delete_image")
    assert hasattr(svc, "is_configured")
