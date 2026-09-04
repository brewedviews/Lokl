"""Tests for environment.py — the central production-detection helper
(2026-09 incident hardening).

No DB, no Cloudinary, no `server` import — this module has zero
dependencies, so these tests are cheap and fast. Covers the exact matrix
requested by the incident-containment task: real Railway production,
missing/unknown environment, staging, and local development, plus the
Railway-vs-legacy-ENVIRONMENT priority rule.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import environment  # noqa: E402


def _clear(monkeypatch):
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)


# ===== get_environment_name / is_production =====

def test_real_railway_production_is_detected(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    assert environment.get_environment_name() == "production"
    assert environment.is_production() is True
    assert environment.is_confirmed_non_production() is False


def test_missing_environment_is_not_production_but_also_not_confirmed_safe(monkeypatch):
    """The core fix: an unknown/missing environment must answer these two
    questions DIFFERENTLY. Normal app behavior (is_production) should
    default to "not production" so local dev keeps working. Anything
    destructive (is_confirmed_non_production) must default to unsafe."""
    _clear(monkeypatch)
    assert environment.get_environment_name() == ""
    assert environment.is_production() is False
    assert environment.is_confirmed_non_production() is False


def test_staging_is_confirmed_non_production(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
    assert environment.is_production() is False
    assert environment.is_confirmed_non_production() is True


def test_local_development_via_legacy_environment_var_is_confirmed_non_production(monkeypatch):
    """The legacy ENVIRONMENT convention (docker-compose.staging.yml, a
    developer's own .env) still works as a fallback when Railway's own
    variable isn't present at all — this is what lets local dev/tests
    intentionally declare themselves safe for a destructive migration."""
    _clear(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "development")
    assert environment.is_production() is False
    assert environment.is_confirmed_non_production() is True


def test_railway_variable_takes_priority_over_legacy_environment_var(monkeypatch):
    """A stray/misremembered local ENVIRONMENT value must never override
    what Railway itself says about a real deployment."""
    _clear(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "staging")  # would say "safe" if trusted
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")  # ground truth
    assert environment.get_environment_name() == "production"
    assert environment.is_production() is True
    assert environment.is_confirmed_non_production() is False


def test_legacy_environment_production_is_still_recognized_as_production(monkeypatch):
    """Non-Railway deployments (or a test suite) that only ever set the
    legacy ENVIRONMENT var must still be correctly refused."""
    _clear(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert environment.is_production() is True
    assert environment.is_confirmed_non_production() is False


def test_environment_name_is_case_and_whitespace_insensitive(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "  Production  ")
    assert environment.is_production() is True
