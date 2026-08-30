"""`_calculate_discount_percent` — pure unit tests.

No HTTP, no DB — imports the module directly, same convention as
test_smoke_imports.py, so these run everywhere (including CI with no
backend booted) and fail fast on the one thing that must never regress:
the floored, deterministic rounding rule every product create/update path
depends on.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path


def _server():
    backend_root = Path(__file__).resolve().parents[1]
    p = str(backend_root)
    if p not in sys.path:
        sys.path.insert(0, p)
    return importlib.import_module("server")


def test_flooring_not_rounding_1000_501():
    """The exact example from the spec: MRP 1000, SP 501 is a genuine 49.9%
    discount — must floor to 49, never round to 50."""
    calc = _server()._calculate_discount_percent
    assert calc(1000, 501) == 49


def test_flat_50_percent():
    calc = _server()._calculate_discount_percent
    assert calc(1000, 500) == 50


def test_no_mrp_gives_zero():
    calc = _server()._calculate_discount_percent
    assert calc(None, 500) == 0


def test_no_price_gives_zero():
    calc = _server()._calculate_discount_percent
    assert calc(1000, None) == 0


def test_both_none_gives_zero():
    calc = _server()._calculate_discount_percent
    assert calc(None, None) == 0


def test_mrp_equal_price_gives_zero():
    calc = _server()._calculate_discount_percent
    assert calc(1000, 1000) == 0


def test_mrp_below_price_gives_zero():
    """Selling above MRP is never a "negative discount" — always 0."""
    calc = _server()._calculate_discount_percent
    assert calc(500, 1000) == 0


def test_zero_mrp_gives_zero():
    calc = _server()._calculate_discount_percent
    assert calc(0, 500) == 0


def test_high_discount_floors_correctly():
    calc = _server()._calculate_discount_percent
    # (999 - 1) / 999 * 100 = 99.8998... -> floors to 99
    assert calc(999, 1) == 99


def test_result_is_always_int():
    calc = _server()._calculate_discount_percent
    assert isinstance(calc(1000, 501), int)
