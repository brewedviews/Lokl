"""Sentry initialization with graceful degradation.

When SENTRY_DSN is unset/blank the module becomes a no-op so local + preview
environments keep working without an external dependency.
"""
from __future__ import annotations

import logging
import os

log = logging.getLogger("lokl.observability")


def init_sentry() -> bool:
    """Initialize Sentry. Returns True if active, False if skipped."""
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        log.info("Sentry disabled (SENTRY_DSN not set).")
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
    except ImportError:
        log.warning("Sentry SDK not installed; skipping init.")
        return False

    environment = os.environ.get("SENTRY_ENVIRONMENT", "development")
    release = os.environ.get("SENTRY_RELEASE") or None
    traces_sample_rate = float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.1"))
    profiles_sample_rate = float(os.environ.get("SENTRY_PROFILES_SAMPLE_RATE", "0.0"))

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        traces_sample_rate=traces_sample_rate,
        profiles_sample_rate=profiles_sample_rate,
        send_default_pii=False,
        integrations=[
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
        ],
    )
    sentry_sdk.set_tag("service", "lokl-backend")
    log.info("Sentry initialized for environment=%s release=%s", environment, release)
    return True
