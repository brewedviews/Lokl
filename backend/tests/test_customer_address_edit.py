"""Customer saved-address editing (2026-09).

Covers the new PUT /customer/{phone}/addresses/{aid} endpoint, added so
checkout's new "Edit" action on a saved address can update it IN PLACE
(same id) rather than the old POST-only path, which always generated a
new id. Also implicitly documents the "address text and lat/lng are never
auto-synchronized" contract: this endpoint just writes back whatever the
client sends for each field — no reverse geocoding, no coordinate
inference, no cross-field derivation.

In-process, DB-backed — same asyncio.run() convention as
test_pay_at_delivery_and_location.py.

Run with: cd backend && python3 -m pytest tests/test_customer_address_edit.py -v
Requires a reachable MONGO_URL.
"""
import os
import sys
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server as srv


def _require_live_db():
    try:
        import pymongo
        pymongo.MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000).admin.command("ping")
    except Exception as e:
        pytest.skip(f"local MongoDB unreachable ({e}) — cannot run DB-backed tests in this environment")


def _draft(**overrides):
    base = {
        "name": "Tester", "phone": "9199999999", "line1": "220/A New Ruabandha",
        "landmark": "Near SBI", "city": "Bhilai", "pincode": "490006",
        "label": "Home", "lat": None, "lng": None,
    }
    base.update(overrides)
    return base


class TestUpdateCustomerAddress:
    def test_edit_preserves_id_and_updates_fields(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            phone = f"9199{uuid.uuid4().hex[:6]}"
            user = {"sub": phone, "role": "customer"}
            created = await srv.add_customer_address(phone, _draft(), user=user)
            aid = created["id"]
            try:
                updated = await srv.update_customer_address(
                    phone, aid, _draft(line1="New Line 1", landmark="Opp Globe Chowk"), user=user,
                )
                assert updated["id"] == aid, "editing must preserve the existing address id"
                assert updated["line1"] == "New Line 1"
                assert updated["landmark"] == "Opp Globe Chowk"
                # Confirms it's genuinely IN PLACE, not a second row appended.
                doc = await db.customers.find_one({"phone": phone}, {"_id": 0, "addresses": 1})
                assert len(doc["addresses"]) == 1
                assert doc["addresses"][0]["id"] == aid
                assert doc["addresses"][0]["line1"] == "New Line 1"
            finally:
                await db.customers.delete_one({"phone": phone})

        asyncio.run(_run())

    def test_edit_without_changing_pin_preserves_existing_coordinates(self):
        """Scenario 6 from the task: editing an address without touching
        AddressPinPicker must leave lat/lng exactly as they were — the
        frontend round-trips the existing value, and this endpoint writes
        back exactly what it's given, never inferring or clearing it."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            phone = f"9199{uuid.uuid4().hex[:6]}"
            user = {"sub": phone, "role": "customer"}
            created = await srv.add_customer_address(phone, _draft(lat=21.19, lng=81.33), user=user)
            aid = created["id"]
            try:
                # Edit only the landmark; lat/lng round-tripped unchanged,
                # exactly as the real AddressSheet form would send them.
                updated = await srv.update_customer_address(
                    phone, aid, _draft(landmark="Updated landmark", lat=21.19, lng=81.33), user=user,
                )
                assert updated["lat"] == 21.19
                assert updated["lng"] == 81.33
                assert updated["landmark"] == "Updated landmark"
            finally:
                await db.customers.delete_one({"phone": phone})

        asyncio.run(_run())

    def test_edit_with_new_pin_saves_new_coordinates(self):
        """Scenario 7: changing the pin saves the newly confirmed real
        coordinates — never fabricated, never silently rounded/altered."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            phone = f"9199{uuid.uuid4().hex[:6]}"
            user = {"sub": phone, "role": "customer"}
            created = await srv.add_customer_address(phone, _draft(lat=21.19, lng=81.33), user=user)
            aid = created["id"]
            try:
                updated = await srv.update_customer_address(
                    phone, aid, _draft(lat=21.205551, lng=81.351234), user=user,
                )
                assert updated["lat"] == 21.205551
                assert updated["lng"] == 81.351234
            finally:
                await db.customers.delete_one({"phone": phone})

        asyncio.run(_run())

    def test_edit_never_infers_address_text_from_coordinates(self):
        """Address text (line1/landmark/city/pincode) and lat/lng are
        independent — changing the pin must never rewrite the address
        text fields, and vice versa. Confirms no reverse-geocoding
        happens server-side either (this endpoint has no geocoding call
        at all — this test pins the observable contract)."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            phone = f"9199{uuid.uuid4().hex[:6]}"
            user = {"sub": phone, "role": "customer"}
            created = await srv.add_customer_address(phone, _draft(line1="Original Address Text"), user=user)
            aid = created["id"]
            try:
                updated = await srv.update_customer_address(
                    phone, aid, _draft(line1="Original Address Text", lat=21.19, lng=81.33), user=user,
                )
                assert updated["line1"] == "Original Address Text", \
                    "address text must be exactly what the customer typed, never rewritten from the pin"
            finally:
                await db.customers.delete_one({"phone": phone})

        asyncio.run(_run())

    def test_edit_preserves_created_at(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            phone = f"9199{uuid.uuid4().hex[:6]}"
            user = {"sub": phone, "role": "customer"}
            created = await srv.add_customer_address(phone, _draft(), user=user)
            aid = created["id"]
            original_created_at = created["created_at"]
            try:
                updated = await srv.update_customer_address(phone, aid, _draft(line1="Changed"), user=user)
                assert updated["created_at"] == original_created_at
                assert "updated_at" in updated
            finally:
                await db.customers.delete_one({"phone": phone})

        asyncio.run(_run())

    def test_edit_unknown_address_id_returns_404(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            phone = f"9199{uuid.uuid4().hex[:6]}"
            user = {"sub": phone, "role": "customer"}
            await db.customers.insert_one({"phone": phone, "addresses": []})
            try:
                with pytest.raises(srv.HTTPException) as exc:
                    await srv.update_customer_address(phone, "addr-doesnotexist", _draft(), user=user)
                assert exc.value.status_code == 404
            finally:
                await db.customers.delete_one({"phone": phone})

        asyncio.run(_run())

    def test_edit_rejects_non_bhilai_pincode(self):
        """Same validation as add_customer_address — not weakened for edits."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            phone = f"9199{uuid.uuid4().hex[:6]}"
            user = {"sub": phone, "role": "customer"}
            created = await srv.add_customer_address(phone, _draft(), user=user)
            aid = created["id"]
            try:
                with pytest.raises(srv.HTTPException) as exc:
                    await srv.update_customer_address(phone, aid, _draft(pincode="110001"), user=user)
                assert exc.value.status_code == 400
            finally:
                await db.customers.delete_one({"phone": phone})

        asyncio.run(_run())
