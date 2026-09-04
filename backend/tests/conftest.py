"""Shared pytest fixtures for the backend test suite.

Discovered during the 2026-09 audit-fix test run (the first time local
MongoDB was actually reachable this session): every DB-backed test file
in this suite uses the same convention — a single `asyncio.run(_run())`
per test function, matching real production's own request-handling shape
rather than pulling in pytest-asyncio's fixture machinery. That's fine on
its own, but server.py creates its Motor client ONCE at module import
time (`client = AsyncIOMotorClient(...)`, outside any event loop). Motor
lazily binds that client's internal async primitives (locks/pools) to
whatever event loop is running the first time it's actually used. Since
`asyncio.run()` tears its loop down when the test function returns, the
SECOND DB-backed test in a pytest session hits `RuntimeError: Event loop
is closed` the moment it touches `srv.db` — the client is still holding
primitives bound to the FIRST test's now-closed loop.

This was never caught before because local MongoDB has been unreachable
for this entire session prior to now — every test that would have hit
this simply skipped first via `_require_live_db()`.

Fix: recreate `srv.client`/`srv.db` fresh before every test, so whichever
loop is active (this test's own, from its own `asyncio.run()` call) is
the one Motor binds to. Test-execution-only — the real running
application still creates its client exactly once, at real startup, for
its one real event loop; this fixture never runs outside pytest.
"""
import os

import pytest


@pytest.fixture(autouse=True)
def _fresh_motor_client_per_test():
    import sys
    srv = sys.modules.get("server")
    if srv is None or "MONGO_URL" not in os.environ:
        yield
        return
    import motor.motor_asyncio
    srv.client = motor.motor_asyncio.AsyncIOMotorClient(os.environ["MONGO_URL"])
    srv.db = srv.client[os.environ.get("DB_NAME", "lokl_dev")]
    # audit_service/_delivery_service are module-level singletons built as
    # `AuditService(db)`/`DeliveryService(db)` at the SAME import time,
    # each just storing that db reference as self.db — same stale-loop
    # problem, same fix (both classes are simple enough that reassigning
    # .db in place is equivalent to reconstructing them).
    if hasattr(srv, "audit_service"):
        srv.audit_service.db = srv.db
    if hasattr(srv, "_delivery_service"):
        srv._delivery_service.db = srv.db
    yield
