"""Single source of truth for "what environment is this process running in."

Incident (2026-09): every prior "are we in production" check in this
codebase keyed on a plain `ENVIRONMENT` variable — set by
docker-compose.staging.yml for staging, and by nothing at all for the
actual deployed Railway production service. So every one of those checks
silently evaluated as "not production" in the one place it mattered: a
migration script's own production-refusal guard, and server.py's
docs/OTP gating. See migrations/005_delete_test_data.py,
migrations/006_cloudinary_cleanup.py, and server.py's `_IS_PRODUCTION`.

Railway stamps `RAILWAY_ENVIRONMENT_NAME` on every real deployment itself
— unlike `ENVIRONMENT`, nobody has to remember to configure it. This module
trusts that signal first, and falls back to the legacy `ENVIRONMENT`
variable only for non-Railway contexts (local dev, docker-compose staging,
tests) where it's still the only signal available.

Two different questions need two different default answers for an
environment this module doesn't recognize:

  - "should I show behavior meant only for production" (hide API docs,
    suppress a debug-only OTP-in-response) — default to NOT production, so
    local dev / an unrecognized context keeps its existing convenience.
    Use `is_production()`.

  - "is it safe to run something destructive" — default to UNSAFE. A
    destructive script has no business treating "I don't recognize this
    environment" as "so it must be my own laptop." Use
    `is_confirmed_non_production()` — never bare `not is_production()` —
    to gate anything destructive or credential-exposing.
"""
import os


def get_environment_name() -> str:
    """Lowercased environment identity, or '' if genuinely unknown.

    Prefers Railway's own `RAILWAY_ENVIRONMENT_NAME` (set by the platform
    itself on every real deployment, not something a human configures) over
    the legacy `ENVIRONMENT` convention (docker-compose.staging.yml, a
    developer's own local .env) — see module docstring for why."""
    railway_env = (os.environ.get("RAILWAY_ENVIRONMENT_NAME") or "").strip().lower()
    if railway_env:
        return railway_env
    return (os.environ.get("ENVIRONMENT") or "").strip().lower()


def is_production() -> bool:
    """True only when the environment is positively identified as
    production. False for everything else, INCLUDING an unknown/missing
    environment — the safe default for gating production-only UX (hiding
    API docs, suppressing a debug OTP-in-response), where "unrecognized"
    should keep behaving like local development, not like production."""
    return get_environment_name() == "production"


def is_confirmed_non_production() -> bool:
    """True only when the environment is positively identified as
    something OTHER than production (e.g. "staging", "development",
    "test"). False for real production AND for an unknown/missing
    environment — a destructive operation, or one that would expose a
    credential, must never treat "I don't know what this is" as permission
    to proceed. Always use this (never bare `not is_production()`) to gate
    anything destructive or sensitive."""
    env = get_environment_name()
    return bool(env) and env != "production"
