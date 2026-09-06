"""Store-availability redesign (2026-09).

SCHEDULE (opens_at/closes_at/weekly_off) is now the source of truth for
whether a store is open. `online` is ONLY an explicit temporary manual-
closure override — it never forces a store open outside its configured
hours, and there is no more time-based decay of any kind (no 12h cap on
`live_since`, no last_seen_at recency gate on LIVE/Away/Offline).

    effective_open =
        not weekly_off
        AND within today's configured opening-hours window
        AND online is not False

PART 1 — pure tests against _effective_store_open()/_store_availability()/
_merchant_live_status(), with a fully controlled IST clock (no real
wall-clock dependency, no flakiness). `_ist_now()` is monkeypatched
directly — every one of these three functions calls it internally, so
patching the one shared helper controls all of them at once.

PART 2 — DB-backed create_order gating, same in-process convention as
test_gupshup_reconciliation.py / test_rider_notification_workflow.py.

Run with: cd backend && python3 -m pytest tests/test_store_availability_redesign.py -v
"""
import asyncio
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server as srv


def _ist(year, month, day, hour, minute):
    """Builds the exact shape _ist_now() itself returns: a UTC-tzinfo
    datetime whose .hour/.minute/.strftime("%A") reflect the INTENDED IST
    wall-clock moment. Every caller of _ist_now() only ever reads those
    three things off the result, never treats it as a real UTC instant, so
    this is a safe, direct stand-in for "the clock reads this IST time" —
    no need to reason about the real UTC offset in tests at all."""
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def _weekday_name(year, month, day):
    return datetime(year, month, day).strftime("%A")


# A fixed Monday/Tuesday/Sunday triplet (self-consistent regardless of which
# real calendar these land on) used across the weekly_off tests below.
_MON, _TUE, _SUN = (2026, 9, 7), (2026, 9, 8), (2026, 9, 13)
assert _weekday_name(*_MON) == "Monday"
assert _weekday_name(*_TUE) == "Tuesday"
assert _weekday_name(*_SUN) == "Sunday"


def _patched(dt):
    return patch.object(srv, "_ist_now", return_value=dt)


# ============================================================================
# PART 1 — _effective_store_open() / _store_availability() / _merchant_live_status()
# ============================================================================

def test_normal_open_hours_store():
    store = {"opens_at": "10:00", "closes_at": "21:00", "weekly_off": [], "online": True}
    with _patched(_ist(*_MON, 14, 0)):  # Monday 2pm, well within 10-21
        r = srv._effective_store_open(store)
    assert r == {"open": True, "reason": None, "eta_message": "Delivery in ~45 mins", "opens_at_label": None}


def test_before_opening_hours():
    store = {"opens_at": "10:00", "closes_at": "21:00", "weekly_off": [], "online": True}
    with _patched(_ist(*_MON, 8, 0)):  # 8am, before 10am open
        r = srv._effective_store_open(store)
    assert r["open"] is False
    assert r["reason"] == "closed"
    assert "today" in r["eta_message"].lower()


def test_after_closing_hours():
    store = {"opens_at": "10:00", "closes_at": "21:00", "weekly_off": [], "online": True}
    with _patched(_ist(*_MON, 22, 0)):  # 10pm, after 9pm close
        r = srv._effective_store_open(store)
    assert r["open"] is False
    assert r["reason"] == "closed"
    assert "tomorrow" in r["eta_message"].lower()


def test_weekly_off_day_closed_all_day_even_within_normal_hours():
    store = {"opens_at": "10:00", "closes_at": "21:00", "weekly_off": ["Sunday"], "online": True}
    with _patched(_ist(*_SUN, 14, 0)):  # Sunday 2pm — would be well within hours any other day
        r = srv._effective_store_open(store)
    assert r["open"] is False
    assert r["reason"] == "weekly_off"
    assert "Monday" in r["opens_at_label"]  # next non-off day


def test_manually_closed_during_opening_hours():
    store = {"opens_at": "10:00", "closes_at": "21:00", "weekly_off": [], "online": False}
    with _patched(_ist(*_MON, 14, 0)):
        r = srv._effective_store_open(store)
    assert r["open"] is False
    assert r["reason"] == "manual"


def test_manually_reopened_during_opening_hours():
    store = {"opens_at": "10:00", "closes_at": "21:00", "weekly_off": [], "online": True}
    with _patched(_ist(*_MON, 14, 0)):
        r = srv._effective_store_open(store)
    assert r["open"] is True


def test_manually_reopened_outside_opening_hours_stays_closed():
    """online=True clears the override but must NEVER force the store open
    outside its configured hours — the core non-negotiable of this redesign."""
    store = {"opens_at": "10:00", "closes_at": "21:00", "weekly_off": [], "online": True}
    with _patched(_ist(*_MON, 23, 0)):  # 11pm, well after close
        r = srv._effective_store_open(store)
    assert r["open"] is False
    assert r["reason"] == "closed", "online=True must not override the schedule"


def test_weekly_off_takes_precedence_over_manual_online_true():
    """A schedule-level closure (weekly off) is reported as such even if the
    merchant's stored `online` is True — there's nothing for online=True to
    override on a day the schedule already says is closed."""
    store = {"opens_at": "10:00", "closes_at": "21:00", "weekly_off": ["Sunday"], "online": True}
    with _patched(_ist(*_SUN, 14, 0)):
        r = srv._effective_store_open(store)
    assert r["open"] is False
    assert r["reason"] == "weekly_off"


def test_twelve_hour_cap_removed_store_stays_open_all_day():
    """The old 12h live_since auto-expiry must be completely gone: a store
    open continuously for well over 12 hours, still within its own
    configured hours, must still read as open."""
    store = {
        "opens_at": "06:00", "closes_at": "23:00", "weekly_off": [], "online": True,
        "live_since": "2026-09-07T00:30:00+00:00",  # 13.5+ hours before the probe below
    }
    with _patched(_ist(*_MON, 14, 0)):
        r = srv._effective_store_open(store)
    assert r["open"] is True, "12h auto-expiry must no longer exist"
    live = srv._merchant_live_status(store)
    assert live["online"] is True


def test_last_seen_at_older_than_60_minutes_does_not_affect_open_state():
    """last_seen_at must play NO role in customer-facing open/closed or
    orderability — only in operational/admin visibility, never read by
    _effective_store_open at all."""
    store = {
        "opens_at": "10:00", "closes_at": "21:00", "weekly_off": [], "online": True,
        "last_seen_at": "2026-09-07T05:00:00+00:00",  # hours stale
    }
    with _patched(_ist(*_MON, 14, 0)):
        r = srv._effective_store_open(store)
        avail = srv._store_availability(store)
    assert r["open"] is True
    assert avail["badge"] == "LIVE"
    assert avail["can_order"] is True
    assert avail["rank"] == 1


def test_store_availability_no_longer_returns_away_rank_or_badge():
    """The old last_seen-based rank-2 'Away' state must be completely
    unreachable now — confirms _store_availability truly delegates instead
    of retaining its own decay branch."""
    for last_seen in (None, "2020-01-01T00:00:00+00:00", "2026-09-07T13:59:00+00:00"):
        store = {"opens_at": "10:00", "closes_at": "21:00", "weekly_off": [], "online": True}
        if last_seen:
            store["last_seen_at"] = last_seen
        with _patched(_ist(*_MON, 14, 0)):
            avail = srv._store_availability(store)
        assert avail["badge"] != "Away"
        assert avail["rank"] != 2


def test_overnight_schedule_18_to_02_is_open_at_20h():
    store = {"opens_at": "18:00", "closes_at": "02:00", "weekly_off": [], "online": True}
    with _patched(_ist(*_MON, 20, 0)):  # 8pm — squarely inside 18:00-02:00
        r = srv._effective_store_open(store)
    assert r["open"] is True


def test_overnight_schedule_18_to_02_is_open_just_after_midnight():
    store = {"opens_at": "18:00", "closes_at": "02:00", "weekly_off": [], "online": True}
    with _patched(_ist(*_TUE, 0, 45)):  # 00:45 the next calendar day — still within the window
        r = srv._effective_store_open(store)
    assert r["open"] is True


def test_overnight_schedule_closed_during_the_daytime_gap():
    store = {"opens_at": "18:00", "closes_at": "02:00", "weekly_off": [], "online": True}
    with _patched(_ist(*_MON, 12, 0)):  # noon — in the daytime gap, not yet open tonight
        r = srv._effective_store_open(store)
    assert r["open"] is False
    assert r["reason"] == "closed"
    assert "today" in r["eta_message"].lower(), "opens later TODAY at 18:00, not tomorrow"


def test_overnight_schedule_respects_30min_closing_grace_around_2am():
    store = {"opens_at": "18:00", "closes_at": "02:00", "weekly_off": [], "online": True}
    with _patched(_ist(*_TUE, 1, 45)):  # 01:45 — within the 30-min pre-close grace, should read closed
        r = srv._effective_store_open(store)
    assert r["open"] is False
    with _patched(_ist(*_TUE, 1, 20)):  # 01:20 — before the grace window, should still be open
        r2 = srv._effective_store_open(store)
    assert r2["open"] is True


def test_overnight_schedule_manual_override_during_the_open_window():
    store = {"opens_at": "18:00", "closes_at": "02:00", "weekly_off": [], "online": False}
    with _patched(_ist(*_TUE, 0, 30)):  # 00:30 — inside the overnight window
        r = srv._effective_store_open(store)
    assert r["open"] is False
    assert r["reason"] == "manual"


def test_opens_at_equals_closes_at_is_an_explicit_24_hour_schedule():
    """opens_at == closes_at means "open 24 hours a day" — NOT the
    degenerate overnight-wraparound reading, which would otherwise produce
    a store that's closed for a 60-minute dead zone around that single
    time once the open/close grace periods are applied. Checked at the
    equal time itself, its exact grace-zone boundary, and the opposite
    end of the clock — all must read open, all day, every day."""
    store = {"opens_at": "09:00", "closes_at": "09:00", "weekly_off": [], "online": True}
    for hour, minute in [(9, 0), (9, 15), (8, 45), (0, 0), (23, 59), (14, 30)]:
        with _patched(_ist(*_MON, hour, minute)):
            r = srv._effective_store_open(store)
        assert r["open"] is True, f"24-hour schedule must be open at {hour:02d}:{minute:02d}"
        assert r["reason"] is None


def test_missing_online_field_defaults_to_no_override_legacy_docs():
    """A legacy store document with no `online` key at all (predates the
    field) must behave exactly like online=True — no override present."""
    store = {"opens_at": "10:00", "closes_at": "21:00", "weekly_off": []}
    assert "online" not in store
    with _patched(_ist(*_MON, 14, 0)):
        r = srv._effective_store_open(store)
    assert r["open"] is True


def test_missing_opens_closes_treated_as_always_open():
    store = {"weekly_off": [], "online": True}
    with _patched(_ist(*_MON, 3, 0)):
        r = srv._effective_store_open(store)
    assert r["open"] is True


def test_merchant_live_status_matches_effective_store_open():
    """_merchant_live_status is a pure adapter — no independent decay logic
    of its own anymore."""
    store = {"opens_at": "10:00", "closes_at": "21:00", "weekly_off": ["Sunday"], "online": True}
    with _patched(_ist(*_SUN, 14, 0)):
        live = srv._merchant_live_status(store)
    assert live["online"] is False
    assert live["offline_reason"] == "weekly_off"
    assert "needs_persist" not in live, "no more self-heal-on-read state to persist"


def test_store_availability_badges_cover_all_four_reasons():
    base = {"opens_at": "10:00", "closes_at": "21:00"}
    with _patched(_ist(*_MON, 14, 0)):
        assert srv._store_availability({**base, "weekly_off": [], "online": True})["badge"] == "LIVE"
        assert srv._store_availability({**base, "weekly_off": [], "online": False})["badge"] == "Store Offline"
        assert srv._store_availability({**base, "weekly_off": ["Monday"], "online": True})["badge"] == "Closed"
    with _patched(_ist(*_MON, 23, 0)):
        assert srv._store_availability({**base, "weekly_off": [], "online": True})["badge"] == "Closed"


def test_logout_no_longer_forces_store_offline():
    """The old /auth/logout handler flipped store.online=False as a
    'courtesy' — under SCHEDULE-is-the-source-of-truth this would apply a
    persistent manual-closure override on every ordinary session expiry,
    resurrecting the exact 'must press Go Live every day' problem this
    redesign removes. Confirms that side-effect is gone."""
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    server_py = os.path.join(backend_dir, "server.py")
    with open(server_py) as f:
        src = f.read()
    fn_start = src.index("async def logout(")
    fn_end = src.index("\n@api.", fn_start)
    fn_src = src[fn_start:fn_end]
    assert '"online": False' not in fn_src, "logout must never write a manual-closure override to the store"
    assert "db.stores.update_one" not in fn_src, "logout must not touch db.stores at all anymore"


def test_create_order_gate_still_calls_store_availability_unchanged():
    """Static check: create_order's gate is untouched by this redesign — it
    still calls _store_availability() and still keys off can_order/badge,
    which now transparently reflect the new formula with no call-site
    change required (per instruction: leave this gate alone unless a real
    incompatibility is found — none was)."""
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    server_py = os.path.join(backend_dir, "server.py")
    with open(server_py) as f:
        src = f.read()
    fn_start = src.index("async def create_order")
    fn_end = src.index("\n@api.", fn_start)
    fn_src = src[fn_start:fn_end]
    assert "_store_availability(" in fn_src
    assert 'avail["can_order"]' in fn_src or "avail['can_order']" in fn_src


# ============================================================================
# PART 2 — DB-backed create_order gating (in-process, same convention as
# test_store_pickup_feature_flag.py — calls srv.create_order() directly,
# same interpreter, so _ist_now() monkeypatching controls it deterministically)
# ============================================================================

L1, L2 = "l1-men", "l2-men-tshirts"


def _merchant_doc(mid):
    now = datetime.now(timezone.utc).isoformat()
    phone = f"9{int(time.time() * 1000 + hash(mid)) % 10 ** 9:09d}"
    return {
        "id": mid, "password_hash": "x", "store_name": f"Availability Test {mid[-6:]}",
        "owner_name": "Owner", "phone": phone, "phone_canonical": phone,
        "city": "Bhilai", "created_at": now, "role": "merchant",
        "kyc_status": "approved", "kyc_submitted_at": now, "approved_at": now,
        "terms_accepted": True, "terms_version": "test", "terms_accepted_at": now,
        "published": False, "storefront": None, "notifications": [],
    }


def _storefront_payload(opens_at, closes_at, weekly_off):
    return srv.StorefrontUpdate(
        tagline="t", story="A perfectly ordinary store description, long enough.",
        banner="", banners=[], specialties=[], locality="",
        opens_at=opens_at, closes_at=closes_at,
        lat=21.19, lng=81.33, area="sector-10", area_label="Sector 10",
        pincode="490006", upi_qr_url="", weekly_off=weekly_off,
    )


class _Cleanup:
    def __init__(self, db):
        self.db = db
        self.merchant_ids = []

    def track(self, merchant_id):
        self.merchant_ids.append(merchant_id)
        return merchant_id

    async def purge(self):
        for mid in self.merchant_ids:
            store_id = f"store-m-{mid}"
            await self.db.orders.delete_many({"merchant_ids": mid})
            await self.db.products.delete_many({"merchant_id": mid})
            await self.db.stores.delete_one({"id": store_id})
            await self.db.merchants.delete_one({"id": mid})


async def _setup_store(cleanup, *, opens_at, closes_at, weekly_off):
    db = srv.db
    mid = cleanup.track(f"m-availtest-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_merchant_doc(mid))
    await srv._create_or_setup_storefront_for_merchant(_storefront_payload(opens_at, closes_at, weekly_off), mid)
    product = await srv._create_product_for_merchant(
        srv.ProductCreate(name="Availability Test Item", price=500, mrp=700,
                           l1_id=L1, l2_id=L2, sizes=["OS"], images=[], stock={"OS": 10}),
        mid,
    )
    store_id = f"store-m-{mid}"
    await db.stores.update_one({"id": store_id}, {"$set": {"online": True}})
    return mid, store_id, product


def _order_payload(product, phone):
    item = {"id": product["id"], "name": product["name"], "price": product["price"], "qty": 1,
            "size": "OS", "image": "x", "key": f"{product['id']}-OS", "store_id": product["store_id"]}
    return dict(
        items=[item], total=product["price"],
        customer={"name": "Availability Test", "phone": phone},
        address={"name": "Availability Test", "line1": "Test Rd", "city": "Bhilai",
                  "pincode": "490020", "phone": phone},
        payment_method="COD",
    )


async def _create_order_during_open_hours_succeeds():
    db = srv.db
    cleanup = _Cleanup(db)
    try:
        mid, store_id, product = await _setup_store(cleanup, opens_at="10:00", closes_at="21:00", weekly_off=[])
        phone = f"9{int(time.time() * 1000) % 10 ** 9:09d}"
        user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
        with _patched(_ist(*_MON, 14, 0)):  # Monday 2pm — inside 10-21
            order = await srv.create_order(srv.OrderCreate(**_order_payload(product, phone)), user)
        assert order.get("id"), "order must be created while the store is open by schedule"
        fresh = await db.orders.find_one({"id": order["id"]}, {"_id": 0})
        assert fresh is not None
    finally:
        await cleanup.purge()


async def _create_order_outside_open_hours_rejected():
    db = srv.db
    cleanup = _Cleanup(db)
    try:
        mid, store_id, product = await _setup_store(cleanup, opens_at="10:00", closes_at="21:00", weekly_off=[])
        phone = f"9{int(time.time() * 1000 + 1) % 10 ** 9:09d}"
        user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
        before_count = await db.orders.count_documents({"merchant_ids": mid})
        with _patched(_ist(*_MON, 23, 0)):  # Monday 11pm — outside 10-21
            with pytest.raises(HTTPException) as exc:
                await srv.create_order(srv.OrderCreate(**_order_payload(product, phone)), user)
        assert exc.value.status_code == 400
        assert "closed" in exc.value.detail.lower() or "unavailable" in exc.value.detail.lower()
        after_count = await db.orders.count_documents({"merchant_ids": mid})
        assert after_count == before_count, "no order must be created while the store is closed by schedule"
    finally:
        await cleanup.purge()


async def _create_order_manually_reopened_outside_hours_still_rejected():
    """The critical non-negotiable, exercised through the real order path:
    online=True (merchant clearing their manual override) must NOT let an
    order through outside configured hours."""
    db = srv.db
    cleanup = _Cleanup(db)
    try:
        mid, store_id, product = await _setup_store(cleanup, opens_at="10:00", closes_at="21:00", weekly_off=[])
        await db.stores.update_one({"id": store_id}, {"$set": {"online": True}})  # explicit, redundant-on-purpose
        phone = f"9{int(time.time() * 1000 + 2) % 10 ** 9:09d}"
        user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
        with _patched(_ist(*_MON, 23, 0)):
            with pytest.raises(HTTPException) as exc:
                await srv.create_order(srv.OrderCreate(**_order_payload(product, phone)), user)
        assert exc.value.status_code == 400
    finally:
        await cleanup.purge()


async def _run_all_order_gate_cases():
    await _create_order_during_open_hours_succeeds()
    await _create_order_outside_open_hours_rejected()
    await _create_order_manually_reopened_outside_hours_still_rejected()


def test_create_order_during_open_and_closed_states():
    try:
        _ = srv.db
    except Exception as e:
        pytest.skip(f"MongoDB not reachable from this test runner: {e}")
        return
    # Single asyncio.run() for all three cases — Motor binds to whichever
    # event loop is running at construction time, same convention as
    # test_store_pickup_feature_flag.py's _run_all_db_cases().
    asyncio.run(_run_all_order_gate_cases())
