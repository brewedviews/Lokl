"""External notification helpers — provider-agnostic (Twilio -> MSG91 migration).

We're moving providers, but with live merchants depending on notifications,
we migrate behind an abstraction + an env-var flag so MSG91 can be tested in
parallel and cut over with instant rollback (just flip NOTIFICATION_PROVIDER
back to "twilio").

### Architecture
  - `NotificationProvider` (ABC) — the interface every provider implements:
    send_sms, send_whatsapp, send_otp, verify_otp.
  - `TwilioProvider` — Commit 1: the original Twilio logic, moved (not
    rewritten) behind the interface. Still the DEFAULT provider.
  - `MSG91Provider` — Commit 2: a second implementation, selectable via
    NOTIFICATION_PROVIDER=msg91. Built and testable, but NOT yet the
    default — Commit 3 will flip the default after live validation.
  - `GupshupProvider` — added narrowly to unblock login OTP delivery
    (customer/merchant/rider) while MSG91's Authentication-template path
    stays blocked on config/eligibility. WhatsApp-template-only —
    send_sms/send_otp/verify_otp are deliberately unimplemented (fail
    loudly, see the provider's own docstring), not silent no-ops.
    Selectable via NOTIFICATION_PROVIDER=gupshup; do NOT set this in
    production until a real live send has been verified — same rule as
    every other provider cutover.
  - `get_provider()` — factory reading NOTIFICATION_PROVIDER (default
    "twilio"). An unrecognized value logs a warning and falls back to
    Twilio rather than breaking the app.
  - The OLD module-level functions (`send_with_fallback`, `send_sms`,
    `send_whatsapp`, `send_otp_with_fallback`) are KEPT, unchanged in name,
    as thin delegates to `get_provider()`. test_smoke_imports.py asserts
    `send_with_fallback` exists as a module attribute — must stay.

### OTP model — LOCAL for every role, always (READ THIS)
Customer, merchant, and rider login OTP are all the SAME model regardless
of NOTIFICATION_PROVIDER: server.py generates the 6-digit code itself,
bcrypt-hashes it into db.customer_otps/db.rider_otps/db.merchant_login_otps
with a 10-minute TTL and 5-attempt lockout, and calls notify_customer_otp/
notify_merchant_otp/notify_rider_otp purely to DELIVER that code — the
provider is a pure delivery-channel concern, invisible to verification.
`NotificationProvider.verify_otp()` (both Twilio's and MSG91's
implementations) is UNUSED by any of the three login flows as of this
revert — server.py's own local bcrypt compare is the only verification
that ever happens now.

This used to be asymmetric: customer OTP briefly used MSG91's OTP Widget
(Custom UI / exposeMethods mode), which owned the entire send+verify
lifecycle itself and handed the frontend an access-token to confirm
server-side instead of a raw code. That was reverted — the widget's fixed
message template couldn't be reworded to Lokl's own branding from code
(it required DLT/template approval work on MSG91's dashboard side, and in
the meantime showed a generic non-Lokl sender name), so customer OTP moved
back to the same local model merchant/rider already used. If MSG91's own
OTP Widget/API-generated-and-verified model is ever revisited, expect this
docstring's asymmetry section to come back along with it — don't assume
`verify_otp()` staying unused is permanent.

### Channel behavior — WhatsApp-only, no fallback (deliberately deferred)
`send_with_fallback()` currently only attempts WhatsApp; SMS fallback on
failure is NOT wired up right now — see that function's own docstring for
the TODO marking where a real multi-channel fallback strategy (SMS, Voice,
etc.) needs to be designed and reintroduced. This applies uniformly to
every notify_* call site, OTP and non-OTP alike — there is no per-message
channel-priority override today.

### Visibility (the silent-failure fix, Commit 1)
Every provider logs a WARNING (not silence) when it can't send: missing
credentials, missing per-message template config, or an API/HTTP failure
all produce a clear log line. The API still returns "ok" to the caller
(fire-and-forget is unchanged) but a systemic send failure is never invisible.

### Message-type surface (for MSG91's per-template config — see MSG91Provider)
Every distinct message the app sends is tagged with a `message_type` string
when it goes through `send_with_fallback`/`send_sms`/`send_whatsapp`. Twilio
ignores this tag entirely (freeform body, zero behavior change). MSG91 uses
it to look up which DLT-approved SMS template to use (India's TRAI
regulations require every commercial SMS to match a pre-registered
template — this is NOT optional the way it effectively is for Twilio's
SDK). The full list of message_type values, and which MSG91_SMS_TEMPLATE_*
env var each maps to, lives in `MSG91Provider._SMS_TEMPLATE_ENV` below.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from abc import ABC, abstractmethod
from typing import Optional

log = logging.getLogger("lokl.notify")

APP_URL = os.environ.get("APP_URL", "https://www.shoplokl.in")
SUPPORT_PHONE = os.environ.get("SUPPORT_PHONE", "+917719052107")
SUPPORT_EMAIL = os.environ.get("SUPPORT_EMAIL", "hello@shoplokl.in")


# ============================================================================
# Phone formatting — provider-agnostic (every provider needs a normalized number)
# ============================================================================

def _to_e164(phone: str) -> Optional[str]:
    """Normalize a phone string to E.164 `+91XXXXXXXXXX`. Returns None if invalid."""
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        digits = f"91{digits}"
    elif digits.startswith("0") and len(digits) == 11:
        digits = f"91{digits[1:]}"
    if not digits.startswith("91") or len(digits) != 12:
        return None
    return f"+{digits}"


def _to_whatsapp_addr(phone: str) -> Optional[str]:
    e164 = _to_e164(phone)
    return f"whatsapp:{e164}" if e164 else None


def _to_msg91_mobile(phone: str) -> Optional[str]:
    """MSG91 wants the number WITH country code but WITHOUT a leading '+'
    (e.g. `919812345678`), unlike Twilio's E.164 `+919812345678`."""
    e164 = _to_e164(phone)
    return e164.lstrip("+") if e164 else None


def _to_gupshup_mobile(phone: str) -> Optional[str]:
    """Gupshup's confirmed contract doesn't specify a digit format for
    `destination` — this reuses the same country-code-no-plus convention
    (`919812345678`) MSG91's WhatsApp API already uses, the most common
    shape for Indian WhatsApp Business APIs. NOT independently confirmed
    against Gupshup's own docs; the live test this provider was built
    alongside is what actually validates it — if that test comes back
    with a destination-format error, this is the first thing to check."""
    return _to_msg91_mobile(phone)


# ============================================================================
# Provider interface
# ============================================================================

class NotificationProvider(ABC):
    """Everything the app sends goes through one of these. Never call a
    vendor SDK/HTTP API directly from server.py or from the notify_*
    templates below — go through get_provider()."""

    def __init__(self) -> None:
        # Diagnostic detail from the MOST RECENT method call — not part of
        # the interface's return-value contract (that stays bool/str/None
        # for zero-behavior-change reasons), just an extra channel for
        # callers that want the raw provider response, e.g. the admin
        # notification-test endpoint (Commit 3) surfacing DLT/template
        # errors directly instead of only a log line.
        self.last_result: dict = {}

    @abstractmethod
    def send_sms(self, to: str, message: str, *, message_type: Optional[str] = None) -> bool:
        """Plain SMS. `message_type` identifies which of the app's message
        templates this is (see module docstring) — Twilio ignores it;
        MSG91 uses it to select the required DLT template. Returns True on
        successful SUBMISSION (not delivery — vendor delivery-status
        callbacks are best-effort/out of scope)."""
        raise NotImplementedError

    @abstractmethod
    def send_whatsapp(self, to: str, message: str, *,
                       template_id: Optional[str] = None,
                       template_params: Optional[dict] = None,
                       message_type: Optional[str] = None) -> Optional[str]:
        """WhatsApp send — either a plain `message` body, or, when
        `template_id` is given, a pre-approved template with
        `template_params` substituted in. Returns the provider's message
        id on successful submission, or None on failure."""
        raise NotImplementedError

    @abstractmethod
    def send_otp(self, to: str, otp: Optional[str] = None) -> str:
        """OTP-specific send. `otp` is the code to deliver when the CALLER
        owns generation (Twilio); omit it when the PROVIDER owns generation
        (MSG91 — see module docstring's OTP asymmetry section). Returns
        "whatsapp", "sms", or "none"."""
        raise NotImplementedError

    @abstractmethod
    def verify_otp(self, to: str, otp: str) -> bool:
        """Provider-side OTP verification. Twilio's implementation is a
        no-op passthrough (real verification is server.py's local bcrypt
        check — see module docstring); MSG91's implementation calls MSG91's
        verify API, since MSG91 owns the code it generated in send_otp()."""
        raise NotImplementedError


def active_provider_name() -> str:
    """Which provider is currently selected, without instantiating it.
    Used by server.py's OTP endpoints to branch between the local-DB path
    (Twilio) and the provider-owned path (MSG91) — see module docstring."""
    return (os.environ.get("NOTIFICATION_PROVIDER") or "twilio").strip().lower()


# ============================================================================
# Twilio provider — Commit 1: the CURRENT logic, moved here (not rewritten).
# Still the DEFAULT provider as of Commit 2.
# ============================================================================

# Status values Twilio returns. See https://www.twilio.com/docs/sms/send-messages#monitor-the-status-of-your-message
_TERMINAL_OK = {"delivered", "read", "sent"}
_TERMINAL_FAIL = {"failed", "undelivered"}
_POLL_BUDGET_SEC = 5.0
_POLL_INTERVAL = 0.7


class TwilioProvider(NotificationProvider):
    """Moved verbatim from the old module-level _get_twilio/send_sms/
    send_whatsapp/_send_whatsapp_for_otp/_poll_message_status/
    send_otp_with_fallback/send_with_fallback — same Twilio calls, same
    fallback order, same formatting. `message_type` is accepted (interface
    conformance) but ignored — Twilio doesn't need per-message DLT
    templates the way MSG91 does."""

    _client = None  # class-level lazy singleton — same caching as the old module global

    def _get_client(self):
        cls = type(self)
        if cls._client is not None:
            return cls._client
        sid = os.environ.get("TWILIO_ACCOUNT_SID")
        tok = os.environ.get("TWILIO_AUTH_TOKEN")
        if not sid or not tok:
            log.warning(
                "[twilio] TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not configured "
                "— all Twilio sends will be skipped until this is set"
            )
            return None
        try:
            from twilio.rest import Client
            cls._client = Client(sid, tok)
            return cls._client
        except Exception as e:  # pragma: no cover
            log.warning("[twilio] client init failed: %s", e)
            return None

    def _whatsapp_sender(self) -> str:
        """Configured WhatsApp sender, adding the `whatsapp:` prefix if missing."""
        s = (os.environ.get("TWILIO_WHATSAPP_FROM") or "whatsapp:+14155238886").strip().strip("'\"`")
        return s if s.startswith("whatsapp:") else f"whatsapp:{s}"

    # ---------------- interface methods ----------------

    def send_sms(self, to: str, message: str, *, message_type: Optional[str] = None) -> bool:
        cli = self._get_client()
        if cli is None:
            log.info("[SMS mock] %s -> %s", to, message[:80])
            self.last_result = {"ok": False, "provider": "twilio", "channel": "sms",
                                 "error": "Twilio client not configured (missing TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)"}
            return False
        to_e164 = _to_e164(to)
        if not to_e164:
            log.warning("[SMS] invalid phone: %r", to)
            self.last_result = {"ok": False, "provider": "twilio", "channel": "sms", "error": f"invalid phone: {to!r}"}
            return False
        sender = (os.environ.get("TWILIO_SMS_FROM") or "").strip()
        if not sender:
            log.warning("[SMS] TWILIO_SMS_FROM is not configured — skipping fallback")
            self.last_result = {"ok": False, "provider": "twilio", "channel": "sms", "error": "TWILIO_SMS_FROM not configured"}
            return False
        try:
            msg = cli.messages.create(from_=sender, to=to_e164, body=message)
            log.info("[SMS] %s sent (sid=%s)", to_e164, msg.sid)
            self.last_result = {"ok": True, "provider": "twilio", "channel": "sms", "sid": msg.sid}
            return True
        except Exception as e:
            log.warning("[SMS] send to %s failed: %s", to_e164, e)
            self.last_result = {"ok": False, "provider": "twilio", "channel": "sms", "error": str(e)}
            return False

    def send_whatsapp(self, to: str, message: str, *,
                       template_id: Optional[str] = None,
                       template_params: Optional[dict] = None,
                       message_type: Optional[str] = None) -> Optional[str]:
        cli = self._get_client()
        if cli is None:
            log.info("[WA mock] %s -> %s", to, message[:80])
            self.last_result = {"ok": False, "provider": "twilio", "channel": "whatsapp",
                                 "error": "Twilio client not configured (missing TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)"}
            return None
        to_addr = _to_whatsapp_addr(to)
        if not to_addr:
            log.warning("[WA] invalid phone: %r", to)
            self.last_result = {"ok": False, "provider": "twilio", "channel": "whatsapp", "error": f"invalid phone: {to!r}"}
            return None
        try:
            if template_id:
                msg = cli.messages.create(
                    from_=self._whatsapp_sender(), to=to_addr,
                    content_sid=template_id,
                    content_variables=json.dumps(template_params or {}),
                )
            else:
                msg = cli.messages.create(from_=self._whatsapp_sender(), to=to_addr, body=message)
            log.info("[WA] %s sent (sid=%s)", to_addr, msg.sid)
            self.last_result = {"ok": True, "provider": "twilio", "channel": "whatsapp", "sid": msg.sid}
            return msg.sid
        except Exception as e:
            log.warning("[WA] send to %s failed: %s", to_addr, e)
            self.last_result = {"ok": False, "provider": "twilio", "channel": "whatsapp", "error": str(e)}
            return None

    def _poll_message_status(self, sid: str, budget_sec: float = _POLL_BUDGET_SEC) -> str:
        """Poll Twilio for terminal status. Time-budgeted so the request
        handler doesn't hang. If still `queued`/`sending`/`accepted` at the
        deadline we treat it as "not yet delivered" and signal fallback —
        better to send a duplicate SMS than leave a user stranded."""
        cli = self._get_client()
        if cli is None:
            return "unknown"
        deadline = time.monotonic() + budget_sec
        last = "queued"
        while time.monotonic() < deadline:
            try:
                m = cli.messages(sid).fetch()
                last = (m.status or "").lower()
                if last in _TERMINAL_OK or last in _TERMINAL_FAIL:
                    return last
            except Exception as e:
                log.warning("[OTP-WA] status poll failed (sid=%s): %s", sid, e)
                return "fetch_error"
            time.sleep(_POLL_INTERVAL)
        return last  # likely still `queued` / `sending`

    def send_otp(self, to: str, otp: Optional[str] = None) -> str:
        if not otp:
            # Twilio has no OTP-generation product of its own — the caller
            # (server.py's local-generate path) must always supply the code.
            log.warning("[twilio] send_otp called without an otp value for %s — Twilio cannot generate its own", to)
            self.last_result = {"ok": False, "provider": "twilio", "channel": "otp", "error": "no otp value supplied"}
            return "none"
        content_sid = (os.environ.get("TWILIO_OTP_CONTENT_SID") or "").strip()
        plain_body = f"Your Lokl verification code is {otp}. Valid for 10 minutes."

        wa_sid = self.send_whatsapp(
            to, plain_body,
            template_id=content_sid or None,
            template_params={"1": str(otp)} if content_sid else None,
        )
        if wa_sid:
            status = self._poll_message_status(wa_sid)
            if status in _TERMINAL_OK:
                log.info("[OTP] delivered via=whatsapp to=%s status=%s", to, status)
                self.last_result = {"ok": True, "provider": "twilio", "channel": "otp", "via": "whatsapp", "status": status}
                return "whatsapp"
            log.info("[OTP] WA status=%s — falling back to SMS for %s", status, to)

        if self.send_sms(to, plain_body):
            log.info("[OTP] delivered via=sms to=%s", to)
            self.last_result = {"ok": True, "provider": "twilio", "channel": "otp", "via": "sms"}
            return "sms"
        log.warning("[OTP] ALL channels failed for %s", to)
        self.last_result = {"ok": False, "provider": "twilio", "channel": "otp", "error": "all channels failed"}
        return "none"

    def verify_otp(self, to: str, otp: str) -> bool:
        """No-op passthrough — see module docstring's OTP asymmetry
        section. Twilio never verifies anything itself; server.py's
        bcrypt-hash check against the local OTP collection is the real
        verification and is completely unaffected by this migration."""
        self.last_result = {"ok": True, "provider": "twilio", "channel": "verify_otp",
                             "note": "no-op passthrough — Twilio never verifies; local bcrypt check is authoritative"}
        return True


# ============================================================================
# MSG91 provider — Commit 2: built and testable via NOTIFICATION_PROVIDER=
# msg91, NOT yet the default (Commit 3 flips the default after live
# validation). See module docstring for the full OTP-ownership asymmetry.
# ============================================================================

_MSG91_BASE = "https://control.msg91.com/api/v5"


class MSG91Provider(NotificationProvider):
    """Uses three distinct MSG91 products:

      - **OTP API** (`v5/otp`, `v5/otp/verify`) for send_otp/verify_otp —
        MSG91 generates AND verifies the code itself. There is no local OTP
        record for this path (see server.py's request-otp/verify-otp
        provider branch, and the module docstring).
      - **Flow API** (`v5/flow/`) for SMS — India's TRAI DLT regulations
        require every commercial SMS to match a pre-registered template, so
        each `message_type` needs its own DLT template id, looked up from
        `_SMS_TEMPLATE_ENV`. The fully-rendered message body is sent as a
        single template variable (VAR1) — this only satisfies DLT if your
        registered template's static framing text matches the notify_*
        function's actual wording with one free-text variable for the
        dynamic part. Verify each DLT template against the real message
        body in notifications.py before relying on this in production.
      - **WhatsApp Business API** (`v5/whatsapp/...`) for WhatsApp —
        template-based when `template_id` is given (the OTP path, mirroring
        Twilio's content_sid), freeform session-message body otherwise
        (mirrors Twilio's default — Meta's 24h customer-session-window rule
        applies the same way it does for Twilio; DLT does NOT apply to
        WhatsApp, only to SMS).

    Every method fails LOUDLY (WARNING log, safe return value) rather than
    raising — same fire-and-forget contract as Twilio.
    """

    # message_type -> Railway env var name holding that message's DLT SMS template id.
    # This is the full send surface of the app (see notify_* functions below
    # for where each message_type is attached). "otp" is handled separately
    # via MSG91_OTP_TEMPLATE_ID / the dedicated OTP API, not this dict.
    _SMS_TEMPLATE_ENV = {
        "order_placed": "MSG91_SMS_TEMPLATE_ORDER_PLACED",
        "merchant_new_order": "MSG91_SMS_TEMPLATE_MERCHANT_NEW_ORDER",
        "order_rejected": "MSG91_SMS_TEMPLATE_ORDER_REJECTED",
        "order_cancelled": "MSG91_SMS_TEMPLATE_ORDER_CANCELLED",
        "order_on_the_way": "MSG91_SMS_TEMPLATE_ORDER_ON_THE_WAY",
        "order_delivered": "MSG91_SMS_TEMPLATE_ORDER_DELIVERED",
        "rider_pickup": "MSG91_SMS_TEMPLATE_RIDER_PICKUP",
        "rider_return_pickup": "MSG91_SMS_TEMPLATE_RIDER_RETURN_PICKUP",
        # Renamed from "return_status" to match the canonical message_type
        # notify_return_status() now uses (2026-09 Gupshup reconciliation —
        # the approved Gupshup template's own name is customer_return_status).
        "customer_return_status": "MSG91_SMS_TEMPLATE_RETURN_STATUS",
        "pickup_reserved": "MSG91_SMS_TEMPLATE_PICKUP_RESERVED",
        "merchant_pickup_reserved": "MSG91_SMS_TEMPLATE_MERCHANT_PICKUP_RESERVED",
        "pickup_pending": "MSG91_SMS_TEMPLATE_PICKUP_PENDING",
        "merchant_pickup_pending": "MSG91_SMS_TEMPLATE_MERCHANT_PICKUP_PENDING",
        "merchant_approved": "MSG91_SMS_TEMPLATE_MERCHANT_APPROVED",
        "merchant_first_order": "MSG91_SMS_TEMPLATE_MERCHANT_FIRST_ORDER",
        "merchant_login_otp": "MSG91_SMS_TEMPLATE_MERCHANT_LOGIN_OTP",
        "rider_login_otp": "MSG91_SMS_TEMPLATE_RIDER_LOGIN_OTP",
        "customer_otp": "MSG91_SMS_TEMPLATE_CUSTOMER_OTP",
        # Renamed from "merchant_order_cancelled_by_customer" to match the
        # canonical message_type notify_merchant_order_cancelled() now
        # uses (2026-09 Gupshup reconciliation — the approved Gupshup
        # template's own name is merchant_order_cancelled). No longer an
        # ad-hoc inline call site — see notify_merchant_order_cancelled().
        "merchant_order_cancelled": "MSG91_SMS_TEMPLATE_MERCHANT_ORDER_CANCELLED",
        # Ad-hoc call sites in server.py that don't go through a notify_*
        # wrapper (see grep of send_with_fallback( in server.py):
        "admin_support_ticket": "MSG91_SMS_TEMPLATE_ADMIN_SUPPORT_TICKET",
        "store_back_online": "MSG91_SMS_TEMPLATE_STORE_BACK_ONLINE",
        "pickup_reservation_expired": "MSG91_SMS_TEMPLATE_PICKUP_RESERVATION_EXPIRED",
        "order_auto_cancelled": "MSG91_SMS_TEMPLATE_ORDER_AUTO_CANCELLED",
        # Commit 3: the admin parallel-test endpoint's own test message.
        "admin_notification_test": "MSG91_SMS_TEMPLATE_ADMIN_NOTIFICATION_TEST",
        # order_accepted is dead code (zero call sites, see notify_order_accepted's
        # docstring) — deliberately NOT mapped; no Railway var needed for it.
    }

    # message_type -> Railway env var name holding that message's APPROVED
    # WhatsApp Authentication-category template NAME (not id — WhatsApp
    # templates are identified by name+language, unlike the numeric-id SMS
    # template convention above). Only login-OTP flows go through
    # send_authentication_otp() — every other message stays on the plain
    # Utility-shaped send_whatsapp() path.
    _WA_AUTH_TEMPLATE_ENV = {
        "customer_otp": "MSG91_WA_TEMPLATE_CUSTOMER_OTP",
        "merchant_login_otp": "MSG91_WA_TEMPLATE_MERCHANT_LOGIN_OTP",
        "rider_login_otp": "MSG91_WA_TEMPLATE_RIDER_LOGIN_OTP",
    }

    def _auth_key(self) -> Optional[str]:
        key = (os.environ.get("MSG91_AUTH_KEY") or "").strip()
        if not key:
            log.warning("[msg91] MSG91_AUTH_KEY not configured — all MSG91 sends will be skipped")
            return None
        return key

    @staticmethod
    def _headers(auth_key: str) -> dict:
        return {"authkey": auth_key, "Content-Type": "application/json", "Accept": "application/json"}

    def send_sms(self, to: str, message: str, *, message_type: Optional[str] = None) -> bool:
        auth_key = self._auth_key()
        if not auth_key:
            self.last_result = {"ok": False, "provider": "msg91", "channel": "sms",
                                 "error": "MSG91_AUTH_KEY not configured"}
            return False
        mobile = _to_msg91_mobile(to)
        if not mobile:
            log.warning("[msg91-sms] invalid phone: %r", to)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "sms", "error": f"invalid phone: {to!r}"}
            return False
        env_name = self._SMS_TEMPLATE_ENV.get(message_type or "")
        template_id = (os.environ.get(env_name) if env_name else None) or ""
        if not template_id:
            err = (
                f"no DLT template configured for message_type={message_type!r} "
                f"(env {env_name or '<unmapped message_type>'})"
            )
            log.warning(
                "[msg91-sms] %s — skipping SMS to %s (India DLT requires a "
                "registered template; there is no safe generic fallback)", err, to,
            )
            self.last_result = {"ok": False, "provider": "msg91", "channel": "sms", "error": err}
            return False
        try:
            import requests
            resp = requests.post(
                f"{_MSG91_BASE}/flow/",
                json={"template_id": template_id, "short_url": "0",
                      "recipients": [{"mobiles": mobile, "VAR1": message}]},
                headers=self._headers(auth_key), timeout=10,
            )
            data = resp.json()
            if str(data.get("type", "")).lower() == "success":
                log.info("[msg91-sms] %s sent (message_type=%s)", mobile, message_type)
                self.last_result = {"ok": True, "provider": "msg91", "channel": "sms", "response": data}
                return True
            log.warning("[msg91-sms] send to %s failed: %s", mobile, data)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "sms", "response": data}
            return False
        except Exception as e:
            log.warning("[msg91-sms] send to %s failed: %s", mobile, e)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "sms", "error": str(e)}
            return False

    def send_whatsapp(self, to: str, message: str, *,
                       template_id: Optional[str] = None,
                       template_params: Optional[dict] = None,
                       message_type: Optional[str] = None) -> Optional[str]:
        auth_key = self._auth_key()
        if not auth_key:
            self.last_result = {"ok": False, "provider": "msg91", "channel": "whatsapp",
                                 "error": "MSG91_AUTH_KEY not configured"}
            return None
        mobile = _to_msg91_mobile(to)
        if not mobile:
            log.warning("[msg91-wa] invalid phone: %r", to)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "whatsapp", "error": f"invalid phone: {to!r}"}
            return None
        integrated_number = (os.environ.get("MSG91_WHATSAPP_INTEGRATED_NUMBER") or "").strip()
        if not integrated_number:
            log.warning("[msg91-wa] MSG91_WHATSAPP_INTEGRATED_NUMBER not configured — skipping WhatsApp to %s", to)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "whatsapp",
                                 "error": "MSG91_WHATSAPP_INTEGRATED_NUMBER not configured"}
            return None
        try:
            import requests
            if template_id:
                components = [{
                    "type": "body",
                    "parameters": [{"type": "text", "text": str(v)} for v in (template_params or {}).values()],
                }] if template_params else []
                payload = {
                    "integrated_number": integrated_number,
                    "content_type": "template",
                    "payload": {
                        "to": mobile,
                        "type": "template",
                        "template": {
                            "name": template_id,
                            "language": {"code": "en", "policy": "deterministic"},
                            "to_and_components": [{"to": [mobile], "components": components}],
                        },
                    },
                }
                url = f"{_MSG91_BASE}/whatsapp/whatsapp-outbound-message/bulk/"
            else:
                payload = {
                    "integrated_number": integrated_number,
                    "content_type": "text",
                    "payload": {"to": mobile, "type": "text", "text": {"body": message}},
                }
                url = f"{_MSG91_BASE}/whatsapp/whatsapp-outbound-message/"
            resp = requests.post(url, json=payload, headers=self._headers(auth_key), timeout=10)
            data = resp.json()
            msg_id = data.get("message_id") or data.get("request_id")
            if not msg_id:
                log.warning("[msg91-wa] send to %s failed: %s", mobile, data)
                self.last_result = {"ok": False, "provider": "msg91", "channel": "whatsapp", "response": data}
                return None
            log.info("[msg91-wa] %s sent (id=%s message_type=%s)", mobile, msg_id, message_type)
            self.last_result = {"ok": True, "provider": "msg91", "channel": "whatsapp", "message_id": msg_id, "response": data}
            return str(msg_id)
        except Exception as e:
            log.warning("[msg91-wa] send to %s failed: %s", mobile, e)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "whatsapp", "error": str(e)}
            return None

    def send_authentication_otp(self, to: str, otp: str, template_name: str) -> Optional[str]:
        """Send a WhatsApp OTP via an approved Authentication-category
        template — genuinely separate from send_whatsapp(), not a
        parameter variant of it. Authentication templates are a distinct
        Meta template category with a hard structural requirement
        send_whatsapp()'s existing template_id path does NOT satisfy: a
        BUTTONS component carrying an OTP button (otp_type: COPY_CODE),
        alongside the body parameter, plus a `namespace` field scoped to
        the whole WABA account (confirmed via research to be a single
        account-level value, not per-template) that send_whatsapp() never
        sends at all.

        Component shape: keyed object ({"body_1": {...}, "button_1": {...}})
        per MSG91's own WhatsApp-OTP-specific documentation — DELIBERATELY
        DIFFERENT from send_whatsapp()'s array-of-objects shape (which
        matches MSG91's generic Utility-template docs instead). This is
        the FIRST attempt at resolving a real shape ambiguity found during
        research — two different MSG91 doc pages describe two different
        shapes for what may or may not be the same endpoint, and the only
        way to know which one this account's API actually accepts is a
        live call. If this shape gets rejected specifically on payload
        structure (not on eligibility/config), the array shape is the
        fallback to try next — see the caller/test script, not hardcoded
        as an automatic retry here, since we want to SEE each raw response
        distinctly rather than silently swallow the first failure.

        Returns the provider's message id on success, or None on failure
        (same contract as send_whatsapp())."""
        auth_key = self._auth_key()
        if not auth_key:
            self.last_result = {"ok": False, "provider": "msg91", "channel": "whatsapp_auth",
                                 "error": "MSG91_AUTH_KEY not configured"}
            return None
        mobile = _to_msg91_mobile(to)
        if not mobile:
            log.warning("[msg91-wa-auth] invalid phone: %r", to)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "whatsapp_auth", "error": f"invalid phone: {to!r}"}
            return None
        integrated_number = (os.environ.get("MSG91_WHATSAPP_INTEGRATED_NUMBER") or "").strip()
        if not integrated_number:
            log.warning("[msg91-wa-auth] MSG91_WHATSAPP_INTEGRATED_NUMBER not configured — skipping to %s", to)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "whatsapp_auth",
                                 "error": "MSG91_WHATSAPP_INTEGRATED_NUMBER not configured"}
            return None
        namespace = (os.environ.get("MSG91_WHATSAPP_NAMESPACE") or "").strip()
        if not namespace:
            log.warning("[msg91-wa-auth] MSG91_WHATSAPP_NAMESPACE not configured — skipping to %s", to)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "whatsapp_auth",
                                 "error": "MSG91_WHATSAPP_NAMESPACE not configured"}
            return None
        if not template_name:
            self.last_result = {"ok": False, "provider": "msg91", "channel": "whatsapp_auth",
                                 "error": "template_name is required"}
            return None
        try:
            import requests
            payload = {
                "integrated_number": integrated_number,
                "content_type": "template",
                "payload": {
                    "messaging_product": "whatsapp",
                    "type": "template",
                    "template": {
                        "name": template_name,
                        "language": {"code": "en", "policy": "deterministic"},
                        "namespace": namespace,
                        "to_and_components": [{
                            "to": [mobile],
                            "components": {
                                "body_1": {"type": "text", "value": str(otp)},
                                "button_1": {"subtype": "url", "type": "text", "value": str(otp)},
                            },
                        }],
                    },
                },
            }
            url = f"{_MSG91_BASE}/whatsapp/whatsapp-outbound-message/bulk/"
            resp = requests.post(url, json=payload, headers=self._headers(auth_key), timeout=10)
            data = resp.json()
            msg_id = data.get("message_id") or data.get("request_id")
            if not msg_id:
                log.warning("[msg91-wa-auth] send to %s failed: %s", mobile, data)
                self.last_result = {"ok": False, "provider": "msg91", "channel": "whatsapp_auth", "response": data}
                return None
            log.info("[msg91-wa-auth] %s sent (id=%s template=%s)", mobile, msg_id, template_name)
            self.last_result = {"ok": True, "provider": "msg91", "channel": "whatsapp_auth", "message_id": msg_id, "response": data}
            return str(msg_id)
        except Exception as e:
            log.warning("[msg91-wa-auth] send to %s failed: %s", mobile, e)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "whatsapp_auth", "error": str(e)}
            return None

    def send_otp(self, to: str, otp: Optional[str] = None) -> str:
        """`otp` is normally omitted — MSG91's OTP API generates its own
        code (see module docstring's OTP asymmetry section). Passing one
        explicitly is supported (MSG91's API accepts an `otp` override) but
        unused by server.py today; kept for interface completeness."""
        auth_key = self._auth_key()
        if not auth_key:
            self.last_result = {"ok": False, "provider": "msg91", "channel": "otp", "error": "MSG91_AUTH_KEY not configured"}
            return "none"
        mobile = _to_msg91_mobile(to)
        if not mobile:
            log.warning("[msg91-otp] invalid phone: %r", to)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "otp", "error": f"invalid phone: {to!r}"}
            return "none"
        template_id = (os.environ.get("MSG91_OTP_TEMPLATE_ID") or "").strip()
        if not template_id:
            log.warning("[msg91-otp] MSG91_OTP_TEMPLATE_ID not configured — skipping OTP send to %s", to)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "otp", "error": "MSG91_OTP_TEMPLATE_ID not configured"}
            return "none"
        try:
            import requests
            params = {"template_id": template_id, "mobile": mobile, "authkey": auth_key}
            if otp:
                params["otp"] = str(otp)
            resp = requests.post(f"{_MSG91_BASE}/otp", params=params, timeout=10)
            data = resp.json()
            if str(data.get("type", "")).lower() == "success":
                log.info("[msg91-otp] delivered to=%s (request_id=%s)", to, data.get("request_id"))
                self.last_result = {"ok": True, "provider": "msg91", "channel": "otp", "response": data}
                # MSG91's OTP template controls actual channel fallback
                # order (WhatsApp -> SMS -> voice, configured in the MSG91
                # dashboard) — this response doesn't tell us which channel
                # was actually used, unlike Twilio's poll-confirmed result.
                return "whatsapp"
            log.warning("[msg91-otp] send to %s failed: %s", to, data)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "otp", "response": data}
            return "none"
        except Exception as e:
            log.warning("[msg91-otp] send to %s failed: %s", to, e)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "otp", "error": str(e)}
            return "none"

    def verify_otp(self, to: str, otp: str) -> bool:
        auth_key = self._auth_key()
        if not auth_key:
            self.last_result = {"ok": False, "provider": "msg91", "channel": "verify_otp",
                                 "error": "MSG91_AUTH_KEY not configured"}
            return False
        mobile = _to_msg91_mobile(to)
        if not mobile:
            log.warning("[msg91-otp] invalid phone for verify: %r", to)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "verify_otp", "error": f"invalid phone: {to!r}"}
            return False
        try:
            import requests
            # No raise_for_status(): MSG91 returns HTTP 200 with a JSON
            # {"type": "error", ...} body for a wrong/expired code, which is
            # a normal outcome here, not a transport failure.
            resp = requests.post(
                f"{_MSG91_BASE}/otp/verify",
                params={"otp": str(otp).strip(), "mobile": mobile},
                headers={"authkey": auth_key, "Accept": "application/json"},
                timeout=10,
            )
            data = resp.json()
            ok = str(data.get("type", "")).lower() == "success"
            if ok:
                log.info("[msg91-otp] verify OK for %s", to)
            else:
                log.warning("[msg91-otp] verify FAILED for %s: %s", to, data.get("message"))
            self.last_result = {"ok": ok, "provider": "msg91", "channel": "verify_otp", "response": data}
            return ok
        except Exception as e:
            log.warning("[msg91-otp] verify request failed for %s: %s", to, e)
            self.last_result = {"ok": False, "provider": "msg91", "channel": "verify_otp", "error": str(e)}
            return False



# ============================================================================
# Gupshup provider — started narrowly (login OTP only) while MSG91's
# WhatsApp Authentication-template path remained blocked on config/
# eligibility issues (see MSG91Provider's own docstring). Gupshup is
# WhatsApp-TEMPLATE-ONLY, always — send_sms/send_otp/verify_otp are all
# deliberately UNIMPLEMENTED (fail loudly: log + safe return value, never
# a silent no-op) rather than guessed at.
#
# Extended 2026-09 (Gupshup reconciliation) to cover 8 more approved
# Utility/Service-update templates beyond the original 3 OTP ones — see
# _TEMPLATE_ENV below for the full current list. Adding a NEW message_type
# here still requires a real, Meta-approved Gupshup template and a
# confirmed variable contract first — the "no order-lifecycle
# notifications without a confirmed contract" discipline still applies to
# anything not already in _TEMPLATE_ENV, it's just no longer a blanket
# ban on the whole category.
# ============================================================================

_GUPSHUP_BASE = "https://api.gupshup.io/wa/api/v1"


# ============================================================================
# Outbound delivery tracking (2026-09) — lightweight persistence of
# successfully-submitted Gupshup WhatsApp sends, so the message-event
# webhook (routes/whatsapp.py) can later correlate delivered/read/failed
# callbacks back to a known send. Deliberately NOT a general notification
# platform: no retries, no dashboards, no history beyond one row per send.
#
# This module has never had a database dependency (every notify_*/
# send_with_fallback call is a plain synchronous function, with no `db`
# handle threaded through from server.py, and no async context to await
# Motor calls from). Rather than retrofit a `db` parameter through every
# notify_* function signature — explicitly out of scope — this uses its
# own small, lazily-connected SYNCHRONOUS pymongo client (the same
# MONGO_URL/DB_NAME env vars server.py's own Motor client uses; a second
# client to the same database is a normal, cheap thing to have). This is
# consistent with GupshupProvider.send_whatsapp() already being a
# blocking, synchronous method (it calls `requests.post`, not an async
# HTTP client) — a blocking pymongo insert fits the same execution model
# server.py's async Motor `db` object is never touched from here.
# ============================================================================

_GUPSHUP_NOTIFICATIONS_COLLECTION = "gupshup_notifications"
_sync_mongo_client = None  # lazy singleton, mirrors TwilioProvider._client's pattern


def _gupshup_notifications_collection():
    """Returns the sync pymongo collection for outbound delivery tracking,
    or None if MONGO_URL/DB_NAME aren't configured (never raises — a
    persistence failure must never break an actual notification send)."""
    global _sync_mongo_client
    try:
        if _sync_mongo_client is None:
            mongo_url = os.environ.get("MONGO_URL")
            db_name = os.environ.get("DB_NAME")
            if not mongo_url or not db_name:
                log.warning("[gupshup-notify] MONGO_URL/DB_NAME not configured — outbound delivery tracking disabled")
                return None
            import pymongo
            _sync_mongo_client = pymongo.MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
        return _sync_mongo_client[os.environ["DB_NAME"]][_GUPSHUP_NOTIFICATIONS_COLLECTION]
    except Exception as e:
        log.warning("[gupshup-notify] could not reach MongoDB for outbound delivery tracking: %s", e)
        return None


def _record_gupshup_submission(*, gupshup_message_id: str, notification_type: Optional[str],
                                recipient_phone: str) -> None:
    """Persists exactly ONE row for a successfully-SUBMITTED Gupshup send —
    called ONLY from the success branch of GupshupProvider.send_whatsapp(),
    never for local pre-flight failures, HTTP failures, or Gupshup error
    responses (those never reach this function at all). No message body or
    template_params are stored — only what's needed to identify and later
    correlate the send. Never raises: a persistence failure here must never
    turn a real, successful WhatsApp submission into a reported failure."""
    coll = _gupshup_notifications_collection()
    if coll is None:
        return
    try:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        coll.insert_one({
            "provider": "gupshup",
            "gupshup_message_id": gupshup_message_id,
            "notification_type": notification_type,
            "recipient_phone": recipient_phone,
            "status": "submitted",
            "order_id": None,  # not threaded through from call sites in this pass — see module docstring
            "failure_code": None,
            "failure_reason": None,
            "sent_at": None,
            "delivered_at": None,
            "read_at": None,
            "failed_at": None,
            "created_at": now,
            "updated_at": now,
        })
    except Exception as e:
        # DuplicateKeyError included — Gupshup is not expected to reuse a
        # messageId, but if it ever does, the existing row is left alone
        # rather than silently overwritten.
        log.warning("[gupshup-notify] failed to persist outbound record for messageId=%s: %s", gupshup_message_id, e)


class GupshupProvider(NotificationProvider):
    """Request contract (from Gupshup's own current docs):

      POST https://api.gupshup.io/wa/api/v1/template/msg
      Header: apikey: {GUPSHUP_API_KEY}
      Content-Type: application/x-www-form-urlencoded
      Form fields: channel=whatsapp, source={GUPSHUP_WHATSAPP_NUMBER},
        src.name={GUPSHUP_APP_NAME}, destination={recipient},
        template={"id": "<template_id>", "params": [...]}
        — for the 3 Authentication (OTP) message_types, the OTP appears
        TWICE in params (body + button component), per Gupshup's own
        explicit note. For every other (Utility/Service-update)
        message_type (added 2026-09), `params` is one entry per
        template_params value, in order, NOT duplicated — see
        _OTP_MESSAGE_TYPES and send_whatsapp() below for exactly which
        branch a given message_type takes. Do not deviate from either
        shape without confirming a real reason to.

    Response contract — CONFIRMED (2026-09, corrected from this class's
    original assumption): a successful submission returns HTTP 2xx with
    `{"status": "submitted", "messageId": "..."}` — Gupshup's own template
    message API docs confirm this is the normal, successful response: the
    API is asynchronous, this response means the message was ACCEPTED and
    enqueued, not that it was delivered/read. `{"status": "success", ...}`
    was this class's original (wrong) assumption from a different, older
    reading of Gupshup's docs and was never actually observed live — kept
    as an accepted alternate below purely for forward-compatibility, not
    because it's expected.

    A prior version of this comment treated "submitted" as a failure,
    reasoning that a real test message never arrived on the test phone
    despite a 202+messageId response — that reasoning was wrong: it
    conflated SUBMISSION (this method's actual job) with DELIVERY (a
    separate, later, asynchronous outcome this method cannot observe).
    Whatever caused that specific test message to not arrive is a
    delivery-side question — see GUPSHUP_WEBHOOK_SECRET / routes/
    whatsapp.py for what delivery-status visibility already exists, and
    this class's own send_session_text() below, which has correctly
    checked for `status == "submitted"` (confirmed live, 2026-08-29) this
    whole time — send_whatsapp() was simply inconsistent with it. Do NOT
    describe a submitted message as "delivered" anywhere in this method;
    "submitted"/"accepted by Gupshup" is the only claim this response
    shape supports.

    `template_params` (the interface's generic dict) uses the same
    `{"1": ..., "2": ..., ...}` positional convention Twilio/MSG91's own
    send_whatsapp() already use elsewhere in this file. For OTP
    message_types this carries exactly one value (the OTP), duplicated
    into Gupshup's two-slot `params` array. For every other message_type,
    each dict value becomes its own `params` slot, in insertion order —
    callers must build the dict in the exact order the approved
    template's {{1}}, {{2}}, ... expect.
    """

    # message_type -> Railway env var holding that message's approved
    # Gupshup template id. "merchant_login_otp" deliberately points at the
    # SAME env var as "customer_otp" (2026-09 reconciliation) — no separate
    # merchant-OTP template was ever created in Gupshup; customer_otp is
    # the one shared Authentication template for both customer and
    # merchant login. This is a single value read twice, not two env vars
    # holding a duplicated id — do not reintroduce a
    # GUPSHUP_TEMPLATE_MERCHANT_LOGIN_OTP var pointing at a copy of the
    # same id, since the two could then drift out of sync on a rotation.
    _TEMPLATE_ENV = {
        "customer_otp": "GUPSHUP_TEMPLATE_CUSTOMER_OTP",
        "merchant_login_otp": "GUPSHUP_TEMPLATE_CUSTOMER_OTP",
        "rider_login_otp": "GUPSHUP_TEMPLATE_RIDER_LOGIN_OTP",
        # Utility-category templates approved 2026-09 (see the Gupshup
        # reconciliation audit).
        #
        # order_placed: confirmed live from the Gupshup template editor —
        # exactly 4 variables, in order: short order id, order total,
        # tracking URL, support phone. Unlike order_on_the_way, this
        # template's static copy DOES include the tracking URL and
        # support phone as real variables — send them, don't drop them.
        "order_placed": "GUPSHUP_TEMPLATE_ORDER_PLACED",
        #
        # order_on_the_way: confirmed live from the Gupshup template
        # editor — exactly ONE variable, the order's short id. The
        # approved template does NOT carry the delivery OTP, rider phone,
        # or a tracking URL at all (product decision, 2026-09) — the
        # delivery OTP mechanism itself is completely unaffected by this;
        # the OTP is still generated and verified exactly as before, it
        # simply isn't part of this WhatsApp message anymore.
        "order_on_the_way": "GUPSHUP_TEMPLATE_ORDER_ON_THE_WAY",
        #
        # order_cancelled: confirmed live from the Gupshup template editor —
        # exactly 3 variables: short order id, the existing cancellation/
        # refund status text, support phone. NO reason text, tracking URL,
        # or browse/shop CTA — none of those are variables in the approved
        # template (the "Reason: ..." line and "Browse other stores" link
        # in the freeform body below have no Gupshup slot and are simply
        # not shown on this channel). {{2}}'s value is the SAME fixed
        # "pay at delivery" text the freeform body has always used — see
        # notify_order_cancelled()'s own comment: neither of its 2 call
        # sites (merchant_cancel_order, admin_cancel_order) computes a
        # real refund_initiated flag today, so there is no branch to
        # preserve beyond this one fixed string.
        "order_cancelled": "GUPSHUP_TEMPLATE_ORDER_CANCELLED",
        "order_rejected": "GUPSHUP_TEMPLATE_ORDER_REJECTED",
        "order_delivered": "GUPSHUP_TEMPLATE_ORDER_DELIVERED",
        "merchant_new_order": "GUPSHUP_TEMPLATE_MERCHANT_NEW_ORDER",
        # rider_pickup: confirmed live from the Gupshup template editor —
        # exactly 8 variables: short order id, store name, store address,
        # customer name, customer address, items, store map URL, customer
        # map URL. No rider phone, delivery OTP, customer phone, order
        # total, tracking URL, or cancellation info — none are variables
        # in the approved template. Recipient is the shared RIDER_PHONE
        # ops number (see notify_rider_pickup's own docstring), not an
        # individually-assigned rider — unaffected by this wiring.
        "rider_pickup": "GUPSHUP_TEMPLATE_RIDER_PICKUP",
        # rider_return_pickup: confirmed live from the Gupshup template
        # editor — exactly 8 variables: ORIGINAL order short id (NOT
        # return_id), customer name/address, customer map URL, store
        # name/address, store map URL, returned items. No return id, OTP,
        # or reason — none are variables in the approved template.
        # Recipient is the same shared RIDER_PHONE ops number as
        # rider_pickup — unaffected by this wiring.
        "rider_return_pickup": "GUPSHUP_TEMPLATE_RIDER_RETURN_PICKUP",
        # merchant_order_cancelled: confirmed live from the Gupshup
        # template editor — exactly ONE variable, the order's short id.
        # No cancellation reason, customer name/phone, order total, or
        # tracking URL — none of those are variables in the approved
        # template (its static copy is a fixed "no action needed" line).
        # message_type renamed from the pre-reconciliation
        # "merchant_order_cancelled_by_customer" to match the Gupshup
        # template's own name — see notify_merchant_order_cancelled().
        "merchant_order_cancelled": "GUPSHUP_TEMPLATE_MERCHANT_ORDER_CANCELLED",
        "merchant_approved": "GUPSHUP_TEMPLATE_MERCHANT_APPROVED",
        "customer_return_status": "GUPSHUP_TEMPLATE_CUSTOMER_RETURN_STATUS",
        "payment_failed": "GUPSHUP_TEMPLATE_PAYMENT_FAILED",
        "merchant_kyc_rejected": "GUPSHUP_TEMPLATE_MERCHANT_KYC_REJECTED",
        "merchant_kyc_on_hold": "GUPSHUP_TEMPLATE_MERCHANT_KYC_ON_HOLD",
    }

    # message_type values whose approved template is Authentication-
    # category and needs the OTP value duplicated into 2 params (body +
    # COPY_CODE button) — see send_whatsapp() below. Every other
    # (Utility-category) template gets one params slot per template_params
    # value, in order, with no duplication.
    _OTP_MESSAGE_TYPES = {"customer_otp", "merchant_login_otp", "rider_login_otp"}

    def _api_key(self) -> Optional[str]:
        key = (os.environ.get("GUPSHUP_API_KEY") or "").strip()
        if not key:
            log.warning("[gupshup] GUPSHUP_API_KEY not configured — all Gupshup sends will be skipped")
            return None
        return key

    def send_sms(self, to: str, message: str, *, message_type: Optional[str] = None) -> bool:
        log.warning("[gupshup] send_sms() is not implemented for Gupshup in this pass — "
                    "it is WhatsApp-template-only (see notifications.py's Gupshup section); skipping %s", to)
        self.last_result = {"ok": False, "provider": "gupshup", "channel": "sms",
                             "error": "send_sms not implemented for Gupshup (WhatsApp-template-only in this pass)"}
        return False

    def send_whatsapp(self, to: str, message: str, *,
                       template_id: Optional[str] = None,
                       template_params: Optional[dict] = None,
                       message_type: Optional[str] = None) -> Optional[str]:
        if not template_id:
            log.warning("[gupshup-wa] send_whatsapp called without template_id for %s — Gupshup has no "
                        "freeform WhatsApp path in this pass, only approved-template sends", to)
            self.last_result = {"ok": False, "provider": "gupshup", "channel": "whatsapp",
                                 "error": "template_id is required — Gupshup has no freeform WhatsApp path in this pass"}
            return None
        api_key = self._api_key()
        if not api_key:
            self.last_result = {"ok": False, "provider": "gupshup", "channel": "whatsapp",
                                 "error": "GUPSHUP_API_KEY not configured"}
            return None
        source = (os.environ.get("GUPSHUP_WHATSAPP_NUMBER") or "").strip()
        app_name = (os.environ.get("GUPSHUP_APP_NAME") or "").strip()
        if not source or not app_name:
            log.warning("[gupshup-wa] GUPSHUP_WHATSAPP_NUMBER/GUPSHUP_APP_NAME not configured — skipping WhatsApp to %s", to)
            self.last_result = {"ok": False, "provider": "gupshup", "channel": "whatsapp",
                                 "error": "GUPSHUP_WHATSAPP_NUMBER or GUPSHUP_APP_NAME not configured"}
            return None
        mobile = _to_gupshup_mobile(to)
        if not mobile:
            log.warning("[gupshup-wa] invalid phone: %r", to)
            self.last_result = {"ok": False, "provider": "gupshup", "channel": "whatsapp", "error": f"invalid phone: {to!r}"}
            return None
        values = [str(v) for v in (template_params or {}).values()]
        if not values:
            log.warning("[gupshup-wa] send_whatsapp called with template_id but no template_params "
                        "(need at least one value) for %s", to)
            self.last_result = {"ok": False, "provider": "gupshup", "channel": "whatsapp",
                                 "error": "template_params must supply at least one value"}
            return None
        if message_type in self._OTP_MESSAGE_TYPES:
            # Authentication-category OTP templates: the code is duplicated
            # into BOTH params slots (body component + COPY_CODE button
            # component) per Gupshup's documented contract — see class
            # docstring. Only the first template_params value is used even
            # if more were passed; unchanged from the original OTP-only
            # implementation.
            params = [values[0], values[0]]
        else:
            # Utility-category templates: one params slot per
            # template_params value, in insertion order. Callers MUST build
            # template_params in the exact order the approved template's
            # {{1}}, {{2}}, ... expect — this provider does not reorder or
            # validate against the live template shape.
            params = values
        try:
            import requests
            payload = {
                "channel": "whatsapp",
                "source": source,
                "src.name": app_name,
                "destination": mobile,
                "template": json.dumps({"id": template_id, "params": params}),
            }
            resp = requests.post(
                f"{_GUPSHUP_BASE}/template/msg",
                data=payload,
                headers={"apikey": api_key, "Content-Type": "application/x-www-form-urlencoded"},
                timeout=10,
            )
            data = resp.json() if resp.content else {}
            status_text = str(data.get("status", "")).lower()
            msg_id = data.get("messageId")
            # Success = HTTP 2xx + a recognized accepted-status text + a
            # real messageId. "submitted" is the confirmed, documented,
            # normal response (see class docstring above) — it means
            # ACCEPTED for async processing, not delivered. "success" is
            # kept as an accepted alternate for forward-compatibility only;
            # it has never actually been observed from this endpoint.
            # requiring a real messageId is deliberate: a 2xx response
            # that claims "submitted" but carries no messageId is missing
            # the one thing that makes the claim verifiable, so it is
            # treated as a failure rather than trusted at face value (per
            # the "do not blindly mark it successful" rule for that case).
            # Any OTHER status text (e.g. "error", "failed", "rejected") —
            # even under a 2xx HTTP code — falls through to the failure
            # branch below untouched; this is a positive allow-list, not a
            # blocklist, so no separate explicit-error check is needed.
            if 200 <= resp.status_code < 300 and status_text in ("submitted", "success") and msg_id:
                log.info("[gupshup-wa] submitted to=%s messageId=%s message_type=%s",
                         mobile, msg_id, message_type)
                self.last_result = {"ok": True, "provider": "gupshup", "channel": "whatsapp",
                                     "status_code": resp.status_code, "message_id": msg_id,
                                     "delivery_status": "submitted", "response": data}
                # Outbound delivery tracking (2026-09) — persists ONLY on
                # this confirmed-successful path, never for any failure
                # branch below or any local pre-flight failure earlier in
                # this method. See _record_gupshup_submission's own
                # docstring for why this never raises.
                _record_gupshup_submission(gupshup_message_id=str(msg_id),
                                            notification_type=message_type, recipient_phone=mobile)
                return str(msg_id)
            log.warning("[gupshup-wa] send to %s NOT submitted: status_code=%s response_status=%r messageId=%r",
                        mobile, resp.status_code, data.get("status"), msg_id)
            self.last_result = {"ok": False, "provider": "gupshup", "channel": "whatsapp",
                                 "status_code": resp.status_code,
                                 "error": data.get("message") or f"HTTP {resp.status_code}, status={data.get('status')!r}",
                                 "response": data}
            return None
        except Exception as e:
            log.warning("[gupshup-wa] send to %s failed: %s", mobile, e)
            self.last_result = {"ok": False, "provider": "gupshup", "channel": "whatsapp", "error": str(e)}
            return None

    def send_session_text(self, to: str, message: str) -> Optional[str]:
        """Freeform/session WhatsApp text — a SEPARATE Gupshup endpoint from
        send_whatsapp()'s template-only `/template/msg`. Confirmed live via
        the WhatsApp Merchant Product Addition technical proof-of-concept
        (2026-08-29): POST /wa/api/v1/msg, message={"type":"text","text":..}.

        Only deliverable to a recipient with an ACTIVE WhatsApp session
        (i.e. they messaged this number within the last 24h) — this is
        standard WhatsApp Business Platform behavior, not a Gupshup-side
        bug (confirmed directly: an identical call to a number with no
        active session returned the same 202/submitted response but never
        delivered; the same call to a number that had just messaged in
        delivered immediately). Every caller of this method today is a
        reply in a merchant-initiated conversation, so the session is
        always active by construction.

        Used ONLY by the WhatsApp product-addition conversation flow
        (routes/whatsapp.py) — not part of the generic notify_* /
        send_with_fallback surface, and deliberately not merged into
        send_whatsapp()'s template-only contract."""
        api_key = self._api_key()
        if not api_key:
            self.last_result = {"ok": False, "provider": "gupshup", "channel": "whatsapp_session",
                                 "error": "GUPSHUP_API_KEY not configured"}
            return None
        source = (os.environ.get("GUPSHUP_WHATSAPP_NUMBER") or "").strip()
        app_name = (os.environ.get("GUPSHUP_APP_NAME") or "").strip()
        if not source or not app_name:
            log.warning("[gupshup-wa-session] GUPSHUP_WHATSAPP_NUMBER/GUPSHUP_APP_NAME not configured — skipping to %s", to)
            self.last_result = {"ok": False, "provider": "gupshup", "channel": "whatsapp_session",
                                 "error": "GUPSHUP_WHATSAPP_NUMBER or GUPSHUP_APP_NAME not configured"}
            return None
        mobile = _to_gupshup_mobile(to)
        if not mobile:
            log.warning("[gupshup-wa-session] invalid phone: %r", to)
            self.last_result = {"ok": False, "provider": "gupshup", "channel": "whatsapp_session", "error": f"invalid phone: {to!r}"}
            return None
        try:
            import requests
            payload = {
                "channel": "whatsapp",
                "source": source,
                "destination": mobile,
                "src.name": app_name,
                "message": json.dumps({"type": "text", "text": message}),
            }
            resp = requests.post(
                f"{_GUPSHUP_BASE}/msg",
                data=payload,
                headers={"apikey": api_key, "Content-Type": "application/x-www-form-urlencoded"},
                timeout=10,
            )
            data = resp.json() if resp.content else {}
            if resp.status_code == 202 and str(data.get("status", "")).lower() == "submitted":
                msg_id = data.get("messageId")
                log.info("[gupshup-wa-session] %s submitted (id=%s)", mobile, msg_id)
                self.last_result = {"ok": True, "provider": "gupshup", "channel": "whatsapp_session",
                                     "status_code": resp.status_code, "message_id": msg_id, "response": data}
                return str(msg_id) if msg_id else None
            log.warning("[gupshup-wa-session] send to %s failed: status=%s response=%s", mobile, resp.status_code, data)
            self.last_result = {"ok": False, "provider": "gupshup", "channel": "whatsapp_session",
                                 "status_code": resp.status_code,
                                 "error": data.get("message", f"HTTP {resp.status_code}"), "response": data}
            return None
        except Exception as e:
            log.warning("[gupshup-wa-session] send to %s failed: %s", mobile, e)
            self.last_result = {"ok": False, "provider": "gupshup", "channel": "whatsapp_session", "error": str(e)}
            return None

    def send_otp(self, to: str, otp: Optional[str] = None) -> str:
        log.warning("[gupshup] send_otp() is not implemented for Gupshup in this pass — "
                    "OTP is always locally generated (server.py); use send_whatsapp() with an "
                    "explicit template_id via _deliver_login_otp() instead; skipping %s", to)
        self.last_result = {"ok": False, "provider": "gupshup", "channel": "otp",
                             "error": "send_otp not implemented for Gupshup in this pass"}
        return "none"

    def verify_otp(self, to: str, otp: str) -> bool:
        log.warning("[gupshup] verify_otp() is not implemented for Gupshup in this pass — "
                    "OTP verification is always local (server.py bcrypt check), never provider-owned")
        self.last_result = {"ok": False, "provider": "gupshup", "channel": "verify_otp",
                             "error": "verify_otp not implemented for Gupshup in this pass"}
        return False


# ============================================================================
# Provider factory / selector
# ============================================================================

_provider_instances: dict[str, NotificationProvider] = {}


def get_provider() -> NotificationProvider:
    """Returns the active NotificationProvider for NOTIFICATION_PROVIDER
    (default "twilio"), read FRESH on every call — not cached behind a
    single global that would need a process restart to pick up a changed
    env var. Provider instances themselves ARE cached, one per provider
    name, so flipping NOTIFICATION_PROVIDER back and forth (e.g. during a
    cutover/rollback) doesn't pay vendor-client re-init cost and takes
    effect on the very next call, no restart required. (Railway also
    restarts on env var changes by default, so this matters most for
    same-process testing, but it's a correctness property either way.)

    An unrecognized value logs a warning and falls back to Twilio rather
    than breaking every send path."""
    name = active_provider_name()
    if name not in ("twilio", "msg91", "gupshup"):
        log.warning("[notify] NOTIFICATION_PROVIDER=%r is not implemented — using twilio", name)
        name = "twilio"
    inst = _provider_instances.get(name)
    if inst is None:
        if name == "msg91":
            inst = MSG91Provider()
        elif name == "gupshup":
            inst = GupshupProvider()
        else:
            inst = TwilioProvider()
        _provider_instances[name] = inst
    return inst


# ============================================================================
# Module-level convenience functions — UNCHANGED PUBLIC API (names AND
# positional signatures; `message_type` is a new OPTIONAL kwarg, so every
# existing 2-arg call site keeps working unchanged). Every notify_* template
# below, the six direct call sites in server.py, and
# test_smoke_imports.py's `hasattr(notif, "send_with_fallback")` check all
# depend on these existing exactly as before.
# ============================================================================

def send_whatsapp(phone: str, body: str, *, message_type: Optional[str] = None) -> bool:
    """Send a free-form WhatsApp message. Returns True on submission success.

    NOTE: this is the "session" path — it works in the Twilio sandbox or, in
    production, only within a 24-hour window after the customer has messaged
    your business (same rule applies to MSG91's WhatsApp API)."""
    return get_provider().send_whatsapp(phone, body, message_type=message_type) is not None


def send_sms(phone: str, body: str, *, message_type: Optional[str] = None) -> bool:
    """Send a plain SMS. Returns True on submission success."""
    return get_provider().send_sms(phone, body, message_type=message_type)


def send_otp_with_fallback(phone: str, otp: str) -> str:
    """Deliver a LOCALLY-GENERATED OTP with WhatsApp -> SMS fallback
    (Twilio path only — see module docstring's OTP asymmetry section for
    why MSG91 doesn't use this function). Returns "whatsapp", "sms", or "none"."""
    return get_provider().send_otp(phone, otp)


# TODO(fallback-strategy): WhatsApp-only for now, deliberately deferred —
# NOT designed yet, not forgotten. When a real fallback strategy is built
# (SMS, Voice, or otherwise), reintroduce it here: bring back the two-
# channel try/fallback loop send_with_fallback() had before this flag
# (git history has it — a WhatsApp-then-SMS attempt with a
# preferred_channel override for latency/reliability-sensitive callers
# like login OTP), decide what "channel priority per message type" should
# actually mean this time, and update every notify_* call site's own
# docstring claims about delivery order (several currently say "WhatsApp
# first, SMS fallback" — no longer true while this flag is on).
NOTIFICATION_SMS_FALLBACK_ENABLED = (os.environ.get("NOTIFICATION_SMS_FALLBACK_ENABLED", "") or "").strip().lower() in ("1", "true", "yes")


def send_with_fallback(phone: str, body: str, *, message_type: Optional[str] = None,
                        template_params: Optional[dict] = None) -> str:
    """Best-effort delivery for ANY transactional message.

    WHATSAPP-ONLY as of the widget revert — see the
    NOTIFICATION_SMS_FALLBACK_ENABLED TODO above. SMS fallback on a
    WhatsApp failure is NOT attempted; the failure is logged clearly
    instead of silently falling back to a different channel. This applies
    uniformly to every notify_* call site in this file (OTP and non-OTP
    alike) — there is no per-message-type exception today.

    Successful submission counts as success — terminal delivery status is
    best effort, surfaced via the provider's own dashboard/status webhook.

    `message_type` identifies which template this message is, for
    providers (MSG91) that need it to route to a specific DLT/WA template —
    see the module docstring. Twilio ignores it.

    `template_params` — structured per-variable values (in the exact order
    the approved WhatsApp template expects), for when the active provider
    is Gupshup AND a template is configured for this message_type (see
    GupshupProvider._TEMPLATE_ENV, 2026-09 reconciliation). When that's the
    case, Gupshup sends ONLY via the approved template — `body` is never
    sent to Gupshup in that branch, since Gupshup has no freeform WhatsApp
    path in this pass. Twilio/MSG91 ignore template_params entirely and
    always send `body` as a freeform message; passing it is a no-op for
    them. If Gupshup is active but no template is configured for this
    message_type, this falls through to the freeform call below, which
    GupshupProvider itself refuses loudly (logged) — never a silent no-op.

    Returns `"whatsapp"`, `"sms"`, or `"none"`.
    """
    provider = get_provider()
    provider_name = type(provider).__name__.replace("Provider", "").lower()
    log.info("[NOTIFY] provider=%s %s <- %.80s", provider_name, phone, body.replace("\n", " "))

    gupshup_template_id = None
    if isinstance(provider, GupshupProvider) and message_type:
        template_env = provider._TEMPLATE_ENV.get(message_type)
        gupshup_template_id = (os.environ.get(template_env) or "").strip() if template_env else ""

    if provider.send_whatsapp(
        phone, body, message_type=message_type,
        template_id=gupshup_template_id or None,
        template_params=template_params if gupshup_template_id else None,
    ):
        log.info("[NOTIFY] provider=%s whatsapp OK to=%s", provider_name, phone)
        return "whatsapp"

    if not NOTIFICATION_SMS_FALLBACK_ENABLED:
        log.warning("[NOTIFY] provider=%s whatsapp failed for %s (%s) — SMS fallback is disabled "
                    "(NOTIFICATION_SMS_FALLBACK_ENABLED), no further channel attempted",
                    provider_name, phone, provider.last_result.get("error", "see prior log line"))
        return "none"

    # Latent path — not exercised while NOTIFICATION_SMS_FALLBACK_ENABLED
    # defaults off. Kept working (not deleted) so re-enabling it via the
    # env var is a real, tested fallback rather than dead code someone has
    # to rebuild from scratch later.
    log.warning("[NOTIFY] provider=%s whatsapp failed for %s (%s) — falling back to sms",
                provider_name, phone, provider.last_result.get("error", "see prior log line"))
    if provider.send_sms(phone, body, message_type=message_type):
        log.info("[NOTIFY] provider=%s sms fallback delivered to %s", provider_name, phone)
        return "sms"
    log.warning("[NOTIFY] provider=%s all channels failed for %s (%s)",
                provider_name, phone, provider.last_result.get("error", "see prior log line"))
    return "none"


# ============================================================================
# Domain-specific templates. Bodies/signatures UNCHANGED from Commit 1 — the
# only addition is a `message_type=` tag on each send_with_fallback() call,
# so MSG91 can route each message to its own DLT-approved SMS template (see
# module docstring). Twilio ignores the tag; zero behavior change for it.
# ============================================================================

def _deliver_login_otp(phone: str, otp: str, message_type: str, fallback_body: str) -> None:
    """Shared delivery path for the three login-OTP notify_* functions.

    When MSG91 is active AND its Authentication-template config
    (MSG91_WA_TEMPLATE_* + MSG91_WHATSAPP_NAMESPACE) is present, sends via
    MSG91Provider.send_authentication_otp() — Meta owns the exact wording
    for an Authentication template, so `fallback_body`'s Lokl-branded text
    is NOT what actually gets sent on this path.

    Gupshup follows the same shape: when Gupshup is active AND has a
    configured template id for this message_type (GUPSHUP_TEMPLATE_ENV),
    sends via GupshupProvider.send_whatsapp(template_id=...) and always
    returns early (success or fail) — never falls through to
    send_with_fallback, since Gupshup has no freeform WhatsApp path in
    this pass (see GupshupProvider's own docstring). If Gupshup is active
    but no template is configured for this message_type, it DOES fall
    through below — send_with_fallback() will call send_whatsapp() with
    no template_id, and GupshupProvider's own guard fails that loudly
    (clear log line, no silent no-op), rather than duplicating that guard
    here.

    Otherwise falls back to the plain send_with_fallback(fallback_body)
    path (Twilio, or MSG91 without Authentication-template config yet) —
    this is where fallback_body's own wording actually ships. Kept as a
    real, working path (not deleted) for exactly this fallback role, and
    for whenever a future SMS channel is reintroduced (see
    send_with_fallback's own deferred-fallback TODO) — SMS has no
    Authentication-template concept the way WhatsApp does, so the plain
    Lokl-worded body is what an SMS fallback would need regardless of
    which WhatsApp path is active."""
    if active_provider_name() == "msg91":
        provider = get_provider()
        template_env = getattr(provider, "_WA_AUTH_TEMPLATE_ENV", {}).get(message_type)
        template_name = (os.environ.get(template_env) or "").strip() if template_env else ""
        if template_name and hasattr(provider, "send_authentication_otp"):
            msg_id = provider.send_authentication_otp(phone, otp, template_name)
            if msg_id:
                log.info("[OTP] provider=msg91 auth-template OTP delivered to=%s (id=%s)", phone, msg_id)
                return
            log.warning("[OTP] provider=msg91 auth-template OTP FAILED for %s (%s) — no further channel attempted",
                        phone, provider.last_result.get("error", "see prior log line"))
            return
    if active_provider_name() == "gupshup":
        provider = get_provider()
        template_env = getattr(provider, "_TEMPLATE_ENV", {}).get(message_type)
        template_id = (os.environ.get(template_env) or "").strip() if template_env else ""
        if template_id:
            msg_id = provider.send_whatsapp(phone, fallback_body, template_id=template_id,
                                             template_params={"1": str(otp)}, message_type=message_type)
            if msg_id:
                log.info("[OTP] provider=gupshup template OTP delivered to=%s (id=%s)", phone, msg_id)
                return
            log.warning("[OTP] provider=gupshup template OTP FAILED for %s (%s) — no further channel attempted",
                        phone, provider.last_result.get("error", "see prior log line"))
            return
    send_with_fallback(phone, fallback_body, message_type=message_type)


def notify_customer_otp(customer_phone: str, otp: str) -> None:
    """Send the 6-digit login OTP to the customer. Always locally
    generated/verified (see module docstring) — only the delivery channel
    changes with the active provider. This used to route through MSG91's
    dedicated OTP-Widget product (which owned the whole send+verify
    lifecycle itself), but that meant the message body was MSG91's own
    fixed widget template — not this Lokl-branded wording — and couldn't
    be changed from code. Reverted to the same generic, freely-worded path
    merchant/rider already use, now further branching to MSG91's
    Authentication-template path when configured — see
    _deliver_login_otp().

    Dev/preview: when `CUSTOMER_OTP_DEBUG=true` we also log the OTP to the
    backend log so testing works without a real phone.
    """
    if os.environ.get("CUSTOMER_OTP_DEBUG", "").strip().lower() in ("1", "true", "yes"):
        log.warning("[OTP-DEBUG] phone=%s otp=%s", customer_phone, otp)
    body = (
        f"Your Lokl verification code is {otp}. "
        f"Valid for 10 minutes. Don't share this code with anyone."
    )
    _deliver_login_otp(customer_phone, otp, "customer_otp", body)


def notify_merchant_otp(merchant_phone: str, otp: str) -> None:
    """Merchant phone-OTP login. Always locally generated/verified — see
    module docstring — only the delivery channel changes with the active
    provider. See _deliver_login_otp() for the MSG91 Authentication-
    template branch; falls back to send_with_fallback (generic path,
    merchant-themed wording) otherwise."""
    if os.environ.get("CUSTOMER_OTP_DEBUG", "").strip().lower() in ("1", "true", "yes"):
        log.warning("[MERCHANT-OTP-DEBUG] phone=%s otp=%s", merchant_phone, otp)
    body = (
        f"Lokl merchant login code: {otp}. "
        f"Valid for 10 minutes. Don't share this code with anyone."
    )
    _deliver_login_otp(merchant_phone, otp, "merchant_login_otp", body)


def notify_rider_otp(rider_phone: str, otp: str) -> None:
    """Rider phone-OTP login. Always locally generated/verified — see
    module docstring — only the delivery channel changes with the active
    provider. Same _deliver_login_otp() rationale as notify_merchant_otp."""
    if os.environ.get("CUSTOMER_OTP_DEBUG", "").strip().lower() in ("1", "true", "yes"):
        log.warning("[RIDER-OTP-DEBUG] phone=%s otp=%s", rider_phone, otp)
    body = (
        f"Lokl rider login code: {otp}. "
        f"Valid for 10 minutes. Don't share this code with anyone."
    )
    _deliver_login_otp(rider_phone, otp, "rider_login_otp", body)


def notify_order_placed(phone: str, order_id: str, total: float) -> None:
    short = order_id[-6:].upper()
    tracking_url = f"{APP_URL}/account/orders/{order_id}"
    body = (
        f"Hi! 🛍️ Your Lokl order #{short} is confirmed.\n\n"
        f"Amount: ₹{total:.0f}\n"
        f"Your store is packing your order — delivery in ~30 minutes.\n\n"
        f"Track here: {tracking_url}\n\n"
        f"Questions? {SUPPORT_PHONE}"
    )
    # Gupshup reconciliation (2026-09): approved order_placed template has
    # exactly 4 variables, confirmed live — short order id, total, tracking
    # URL, and support phone are ALL genuine variables in this template
    # (unlike order_on_the_way, nothing was dropped here). Order matters:
    # {{1}}, {{2}}, {{3}}, {{4}}.
    send_with_fallback(phone, body, message_type="order_placed",
                        template_params={"1": short, "2": f"{total:.0f}",
                                          "3": tracking_url, "4": SUPPORT_PHONE})


def notify_merchant_new_order(merchant_phone: str, order_id: str, total: float, items_count: int) -> None:
    short = order_id[-6:].upper()
    body = (
        f"🛍️ NEW ORDER #{short}\n\n"
        f"{items_count} item(s) · ₹{total:.0f}\n\n"
        f"Accept quickly to keep your rating high!\n"
        f"👉 {APP_URL}/merchant/orders"
    )
    # Gupshup reconciliation (2026-09): approved merchant_new_order
    # template dropped the merchant-orders URL — only order id, item
    # count, and total survive. Order matters: {{1}}, {{2}}, {{3}}.
    send_with_fallback(merchant_phone, body, message_type="merchant_new_order",
                        template_params={"1": short, "2": str(items_count), "3": f"{total:.0f}"})


def notify_order_accepted(phone: str, order_id: str, store_name: str, otp: str = "") -> None:
    """NOTE: unused since the rider-flow redesign (Group A1) removed the
    customer notification on merchant-accept — kept as-is (not deleted,
    unrelated to this commit) in case it's still referenced elsewhere or
    revived later. Deliberately NOT given a message_type — see
    MSG91Provider._SMS_TEMPLATE_ENV's comment; no Railway template needed
    for dead code."""
    short = order_id[-6:].upper()
    body = (
        f"✅ Order #{short} accepted by {store_name}!\n\n"
        f"Your rider is on the way. Expected delivery in ~30 minutes.\n\n"
        f"🔑 Delivery OTP: *{otp}*\n"
        f"Share this with your rider when they arrive.\n\n"
        f"Track: {APP_URL}/account/orders/{order_id}"
    )
    send_with_fallback(phone, body)


def notify_order_rejected(phone: str, order_id: str, refund_initiated: bool = False) -> None:
    """`refund_initiated` MUST be true whenever the order was paid online
    (Razorpay) and merchant_reject_order successfully kicked off a refund —
    a COD-only "no amount was charged" line here was factually wrong for a
    prepaid order that had actually been captured (audit fix, 2026-09)."""
    short = order_id[-6:].upper()
    money_line = (
        f"Your refund has been initiated and should reflect in 3-5 business days.\n\n"
        if refund_initiated else
        f"Since you pay at delivery, no amount was charged.\n\n"
    )
    body = (
        f"😔 Order #{short} could not be fulfilled by the store.\n\n"
        f"{money_line}"
        f"Browse other stores: {APP_URL}\n"
        f"Need help? {SUPPORT_PHONE}"
    )
    # Gupshup reconciliation (2026-09): approved order_rejected template
    # dropped the browse-other-stores URL. The refund-status branch is
    # preserved as its own variable (trimmed of the body's own trailing
    # blank line, which was only formatting for the freeform message).
    refund_status_text = money_line.strip()
    send_with_fallback(phone, body, message_type="order_rejected",
                        template_params={"1": short, "2": refund_status_text})


def notify_rider_pickup(rider_phone: str, *, order_id: str, otp: str, customer_name: str,
                        store_name: str, store_address: str, customer_address: str,
                        items_summary: str = "", upi_qr_url: str = "",
                        store_lat: float = 0, store_lng: float = 0,
                        customer_lat: float = 0, customer_lng: float = 0) -> None:
    """Notify the rider when a merchant accepts an order. `rider_phone` is
    the shared RIDER_PHONE ops number (see the one call site in server.py,
    merchant_accept_order) — NOT an individually-assigned rider's own
    phone; this is a pre-existing, unrelated fact this wiring doesn't
    change.

    Gupshup reconciliation (2026-09): approved rider_pickup template has
    exactly 8 variables — short order id, store name, store address,
    customer name, customer address, items, store map URL, customer map
    URL — reusing this function's own EXISTING pickup_map/drop_map
    construction below (no separate helper exists anywhere in this
    codebase; this exact `?q={{lat}},{{lng}}` pattern is the established
    convention, also used for the pickup-reservation maps_link in
    server.py). Deliberately excluded, per the approved template: OTP,
    rider phone, customer phone, order total, tracking URL, cancellation
    info.

    KNOWN GAP, not fixed by this wiring: customer_lat/customer_lng come
    from the delivery address, which — per this function's own long-
    standing caller comment in server.py — has no lat/lng populated in
    practice today. So {{8}} (customer map URL) will be an EMPTY STRING
    for most/all real orders until delivery addresses are geocoded
    somewhere upstream. Not something this change invents or can fix —
    no new geocoding service was added, per instruction."""
    short_id = order_id[-6:].upper()
    pickup_map = f"https://maps.google.com/?q={store_lat},{store_lng}" if store_lat and store_lng else ""
    drop_map = f"https://maps.google.com/?q={customer_lat},{customer_lng}" if customer_lat and customer_lng else ""
    items_text = items_summary or "(see app)"
    body = f"""🛵 LOKL DELIVERY — #{short_id}

📦 PICKUP
{store_name}
{store_address}
{f"📍 Navigate: {pickup_map}" if pickup_map else ""}

🏠 DROP
{customer_name}
{customer_address}
{f"📍 Navigate: {drop_map}" if drop_map else ""}

🛍️ ITEMS
{items_text}

🔑 OTP: {otp}
Ask customer for this OTP on delivery.

{f"💳 UPI QR for payment:{chr(10)}{upi_qr_url}" if upi_qr_url else "💳 Collect payment via UPI/cash"}

✅ TO CONFIRM DELIVERY:
Reply: {otp} Delivered"""
    send_with_fallback(rider_phone, body, message_type="rider_pickup",
                        template_params={
                            "1": short_id, "2": store_name, "3": store_address,
                            "4": customer_name, "5": customer_address, "6": items_text,
                            "7": pickup_map, "8": drop_map,
                        })


def notify_order_on_the_way(phone: str, order_id: str, otp: str, rider_phone: str = "") -> None:
    """Rider-flow redesign: this is now the customer's FIRST delivery-related
    notification (merchant-accept no longer notifies) — it's where the
    delivery OTP is revealed, plus the assigned rider's phone when known.

    `otp` and `rider_phone` are UNCHANGED inputs — the delivery OTP
    generation/verification mechanism and rider handoff logic that
    produce them are not touched by this function at all. They still
    appear in the freeform `body` below (used by Twilio/MSG91, or by
    Gupshup only if no template is configured). Gupshup's approved
    template (confirmed live, 2026-09) carries neither: it has exactly
    ONE variable, the order's short id — no OTP, no rider phone, no
    tracking URL. Do not add them to template_params."""
    short = order_id[-6:].upper()
    rider_line = f"🛵 Your rider: {rider_phone}\n" if rider_phone else ""
    body = (
        f"🚴 Your order #{short} is on the way!\n\n"
        f"{rider_line}"
        f"🔑 OTP: *{otp}*\n"
        f"Share this with your rider on arrival to confirm delivery.\n\n"
        f"Track: {APP_URL}/account/orders/{order_id}"
    )
    send_with_fallback(phone, body, message_type="order_on_the_way",
                        template_params={"1": short})


def notify_order_cancelled(phone: str, order_id: str, reason: str = "") -> None:
    """Both current call sites (merchant_cancel_order, admin_cancel_order
    in server.py) never compute a refund_initiated flag or touch
    payment_status at all — neither cancels a PAID order's charge, so
    there is no paid/refund-vs-COD branch to preserve here (unlike
    notify_order_rejected, which does have one). `refund_status_text` is
    the one existing status line the current code already has; it stays
    a fixed string until/unless a real refund branch is ever added to
    one of those call sites."""
    short = order_id[-6:].upper()
    refund_status_text = "Since you pay at delivery, no amount was charged."
    body = (
        f"❌ Order #{short} was cancelled.\n"
        f"{f'Reason: {reason}' + chr(10) if reason else ''}\n"
        f"{refund_status_text}\n\n"
        f"Browse other stores: {APP_URL}\n"
        f"Need help? {SUPPORT_PHONE}"
    )
    # Gupshup reconciliation (2026-09): approved order_cancelled template
    # has exactly 3 variables — short order id, refund_status_text,
    # support phone. The optional `reason` text and the browse-URL are
    # NOT variables in the approved template and are never sent to
    # Gupshup; they remain freeform-body-only (Twilio/MSG91).
    send_with_fallback(phone, body, message_type="order_cancelled",
                        template_params={"1": short, "2": refund_status_text, "3": SUPPORT_PHONE})


def notify_merchant_order_cancelled(merchant_phone: str, order_id: str, already_accepted: bool) -> None:
    """New dedicated function (2026-09 Gupshup reconciliation) — replaces
    two inline ad-hoc `send_with_fallback(...)` calls in server.py's
    customer_cancel_order() that previously used the FULL order id (not
    the short-id convention every other notify_* function in this file
    follows) and were tagged with the pre-reconciliation message_type
    value merchant_order_cancelled_by_customer (old name — renamed to
    match the Gupshup template's own name, "merchant_order_cancelled" —
    see _SMS_TEMPLATE_ENV's rename note too).

    `already_accepted` preserves the ONE real behavioral difference the
    old inline code had: the exact wording differs depending on whether
    this merchant had already accepted their slice when the customer
    cancelled. This only affects the freeform (Twilio/MSG91) body — the
    approved Gupshup template's copy is a single fixed "no action needed"
    line regardless, so template_params carries only the short order id,
    same in both cases."""
    short = order_id[-6:].upper()
    if already_accepted:
        body = f"Order #{short} was cancelled by the customer."
    else:
        body = f"Order #{short} was cancelled by the customer before you accepted it."
    # Gupshup reconciliation (2026-09): approved merchant_order_cancelled
    # template has exactly ONE variable — the short order id. Do NOT add
    # reason, customer name/phone, order total, or a tracking URL — none
    # of those are variables in the approved template.
    send_with_fallback(merchant_phone, body, message_type="merchant_order_cancelled",
                        template_params={"1": short})


def notify_payment_failed(phone: str, order_id: str) -> None:
    """New (2026-09 Gupshup reconciliation) — closes the C14 gap from the
    communication audit: the Razorpay payment.failed webhook previously
    only logged the failure and never told the customer. Only order_id is
    passed as a template variable — the approved Gupshup template dropped
    the app URL and no other variable was confirmed available; do not add
    a reason/amount variable without confirming it against the live
    template first (see the reconciliation audit's own uncertainty note)."""
    short = order_id[-6:].upper()
    body = (
        f"⚠️ Payment for order #{short} could not be completed.\n\n"
        f"You have not been charged. Please try again or use Pay at Delivery.\n\n"
        f"Need help? {SUPPORT_PHONE}"
    )
    send_with_fallback(phone, body, message_type="payment_failed",
                        template_params={"1": short})


def notify_order_delivered(phone: str, order_id: str) -> None:
    short = order_id[-6:].upper()
    body = (
        f"🎉 Order #{short} delivered!\n\n"
        f"Hope you love it! Rate your experience:\n"
        f"{APP_URL}/account/orders/{order_id}\n\n"
        f"Shop again: {APP_URL}"
    )
    # Gupshup reconciliation (2026-09): Meta removed "the tracking/rating
    # URL variable" from the approved order_delivered template. The
    # freeform body above actually uses TWO URLs (a rating link and a
    # "shop again" link) — it's unconfirmed from the reconciliation
    # whether one or both were removed, so only the one variable that's
    # unambiguously still available (order id) is sent. If the live
    # template actually kept a second (URL) slot, confirm against the
    # Gupshup dashboard and add it here — do not guess further.
    send_with_fallback(phone, body, message_type="order_delivered",
                        template_params={"1": short})


def notify_rider_return_pickup(rider_phone: str, *, return_id: str, order_id: str, otp: str,
                                customer_name: str, pickup_addr: str, items: list[dict],
                                reason: str = "", store_name: str = "Store",
                                store_address: str = "Bhilai",
                                store_lat: float = 0, store_lng: float = 0,
                                customer_lat: float = 0, customer_lng: float = 0) -> None:
    """Notify the rider for a return pickup (reverse pickup flow).
    `rider_phone` is the shared RIDER_PHONE ops number (see the one call
    site in server.py, admin_return_action) — same architecture as
    forward notify_rider_pickup, unaffected by this wiring.

    Gupshup reconciliation (2026-09): approved rider_return_pickup
    template has exactly 8 variables — the ORIGINAL order's short id
    (NOT return_id — the template says "Order", and leaking a return id
    into a customer-facing-shaped variable slot isn't something the
    approved template asks for), customer name/address, customer map
    URL, store name/address, store map URL, and the returned items.
    store_name/store_address/store_lat/store_lng/customer_lat/
    customer_lng are NEW params (the function never had store info or
    coordinates before this) — reusing the exact same
    `f"https://maps.google.com/?q={{lat}},{{lng}}"` construction already
    established in the forward rider-pickup notify function above and
    server.py's pickup-reservation maps_link; no new helper, no
    geocoding. Deliberately
    excluded from the Gupshup template_params: return_id, OTP, reason —
    none are variables in the approved template. OTP/return_id stay in
    the freeform body below (Twilio/MSG91) exactly as before — nothing
    removed from that channel."""
    short_order_id = order_id[-6:].upper()
    item_lines = "; ".join(
        f"{it.get('qty', 1)}x {it.get('name', 'Item')}" for it in (items or [])
    ) or "(see app)"
    reason_part = f"Reason: {reason}. " if reason else ""
    body = (
        f"Lokl RETURN pickup — Return {return_id} (order {order_id}) OTP {otp}. "
        f"Pickup from: {customer_name}, {pickup_addr}. "
        f"{reason_part}"
        f"Items: {item_lines}. "
        f"Reply '{otp} - Picked Up' once the customer hands over the items."
    )
    customer_map_url = f"https://maps.google.com/?q={customer_lat},{customer_lng}" if customer_lat and customer_lng else ""
    store_map_url = f"https://maps.google.com/?q={store_lat},{store_lng}" if store_lat and store_lng else ""
    # Do NOT add a freeform fallback here for Gupshup — GupshupProvider
    # already has no freeform WhatsApp path in this pass (see its own
    # docstring); this template_params dict is the ONLY thing Gupshup
    # ever sends for this message_type.
    send_with_fallback(rider_phone, body, message_type="rider_return_pickup",
                        template_params={
                            "1": short_order_id, "2": customer_name, "3": pickup_addr,
                            "4": customer_map_url, "5": store_name, "6": store_address,
                            "7": store_map_url, "8": item_lines,
                        })


# Canonical (label, status-specific message) per return status that
# actually notifies the customer — "requested" is deliberately absent:
# create_return() never calls notify_return_status() for it (see that
# function), so it has no label/message pair to own here. Kept as the
# single source of truth for BOTH the WhatsApp template's {{2}}/{{3}}
# and (via RETURN_STATUS_NOTIFY_TYPES below) the gate server.py's
# admin_return_action() uses to decide whether to notify at all — do not
# duplicate this mapping at the call site.
#
# Text is derived strictly from what the rest of this codebase already
# establishes about each status (the return timeline's own labels, the
# rider-dispatch trigger at pickup_assigned, and the fact that
# admin_return_action's "completed" branch only restocks — there is no
# refund-on-return flow anywhere in this codebase, see create_order's
# own Try & Buy comment — so "completed" deliberately says nothing about
# money). Confirmed 2026-09 (Gupshup reconciliation, {{3}} added).
_RETURN_STATUS_COPY = {
    "pickup_assigned": (
        "pickup partner assigned",
        "A pickup partner has been assigned to collect your item(s).",
    ),
    "arriving": (
        "pickup partner arriving",
        "Your pickup partner is arriving to collect the item(s).",
    ),
    "picked_up": (
        "product picked up",
        "Your item(s) have been picked up.",
    ),
    "completed": (
        "return completed",
        "Your return has been completed.",
    ),
}
RETURN_STATUS_NOTIFY_TYPES = frozenset(_RETURN_STATUS_COPY.keys())


def notify_return_status(customer_phone: str, return_id: str, order_id: str, status: str) -> None:
    """`status` is the raw return-status code (e.g. "pickup_assigned"), NOT
    free text — see _RETURN_STATUS_COPY above, the only place the
    label/message text for each status lives.

    `return_id` (e.g. "RET-8291") and `order_id` (the underlying Lokl
    order's own id) are deliberately DIFFERENT values, used for different
    things — do not collapse them. `return_id` is what /returns/{id}
    actually routes on, so the freeform body's tracking link and its own
    "Return {return_id}" reference must keep using it. The Gupshup
    template's {{1}} is confirmed (live, from the Gupshup editor) to be
    "the ID displayed after 'Lokl order #'" — the ORDER's short id, same
    [-6:].upper() convention every other notify_* function in this file
    uses — never the return id."""
    order_short = order_id[-6:].upper()
    status_label, status_message = _RETURN_STATUS_COPY.get(status, (status, ""))
    body = (
        f"Lokl: Return {return_id} update — {status_label}. "
        f"Track at {APP_URL}/returns/{return_id}"
    )
    # Gupshup reconciliation (2026-09): the approved Gupshup template's own
    # name is "customer_return_status", not "return_status" — message_type
    # renamed to match (also renamed in MSG91Provider._SMS_TEMPLATE_ENV so
    # MSG91 SMS routing doesn't silently break). Confirmed live: {{1}} =
    # order short id (NOT return_id), {{2}} = current status, {{3}} =
    # status-specific message — exactly 3, no tracking URL/CTA (the
    # template's own static text already ends with "Thank you.").
    send_with_fallback(customer_phone, body, message_type="customer_return_status",
                        template_params={"1": order_short, "2": status_label, "3": status_message})


def notify_pickup_reserved(customer_phone: str, order_id: str, store_name: str,
                            pickup_code: str, expires_at: str,
                            store_address: str = "", maps_link: str = "") -> None:
    """Notify the customer that their store pickup is reserved with a 4-digit code."""
    short = order_id[-6:].upper()
    try:
        from datetime import datetime, timedelta, timezone
        exp_utc = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        exp_ist = exp_utc + timedelta(minutes=330)
        # Format: 5:30 PM
        h = exp_ist.hour % 12 or 12
        ampm = "AM" if exp_ist.hour < 12 else "PM"
        exp_str = f"{h}:{exp_ist.minute:02d} {ampm}"
        # today vs tomorrow in IST
        now_ist = datetime.now(timezone.utc) + timedelta(minutes=330)
        exp_day = "today" if exp_ist.date() == now_ist.date() else "tomorrow"
    except Exception:
        exp_str = "soon"
        exp_day = "today"
    body = (
        f"Item reserved at {store_name}!\n\n"
        f"Order #{short}\n"
        f"Your code: *{pickup_code}*\n\n"
        f"Show this code at the store counter.\n"
        f"Reserved until {exp_str} {exp_day}.\n\n"
    )
    if store_address:
        body += f"Store: {store_address}\n"
    if maps_link:
        body += f"Directions: {maps_link}\n"
    body += f"\nPay at the store after trying the product.\nTrack: {APP_URL}/account/orders/{order_id}"
    send_with_fallback(customer_phone, body, message_type="pickup_reserved")


def notify_merchant_pickup_reserved(merchant_phone: str, order_id: str,
                                     items_count: int, expires_at_iso: str) -> None:
    """Notify the merchant that a customer has reserved items for store pickup."""
    short = order_id[-6:].upper()
    try:
        from datetime import datetime, timezone
        exp_dt = datetime.fromisoformat(expires_at_iso.replace("Z", "+00:00"))
        exp_str = exp_dt.strftime("%-I:%M %p")
    except Exception:
        exp_str = "4 hours from now"
    body = (
        f"Store pickup reserved — #{short}\n\n"
        f"{items_count} item(s) reserved for in-store pickup.\n"
        f"Customer will arrive by {exp_str}.\n\n"
        f"Verify the 4-digit code the customer shows you.\n"
        f"See orders: {APP_URL}/merchant/orders"
    )
    send_with_fallback(merchant_phone, body, message_type="merchant_pickup_reserved")


def notify_pickup_pending(customer_phone: str, order_id: str, store_name: str) -> None:
    """Notify the customer that their pickup request is pending merchant confirmation."""
    short = order_id[-6:].upper()
    body = (
        f"Pickup request received — #{short}\n\n"
        f"Your request to pick up from {store_name} is pending confirmation.\n"
        f"We'll send you the pickup code as soon as the store accepts.\n\n"
        f"Track: {APP_URL}/account/orders/{order_id}"
    )
    send_with_fallback(customer_phone, body, message_type="pickup_pending")


def notify_merchant_pickup_pending(merchant_phone: str, order_id: str, items_count: int) -> None:
    """Notify the merchant of a new pickup request that requires their acceptance."""
    short = order_id[-6:].upper()
    body = (
        f"New pickup request — #{short}\n\n"
        f"{items_count} item(s) requested for in-store pickup.\n"
        f"Accept or decline at {APP_URL}/merchant/orders"
    )
    send_with_fallback(merchant_phone, body, message_type="merchant_pickup_pending")


def notify_merchant_approved(merchant_phone: str, store_name: str) -> None:
    body = (
        f"Your Lokl store has been approved!\n\n"
        f"Store: {store_name}\n\n"
        f"Next steps:\n"
        f"1. Complete your store profile: {APP_URL}/merchant/storefront\n"
        f"2. Add your products: {APP_URL}/merchant/products\n"
        f"3. Toggle your store live when ready\n\n"
        f"Need help? Email hello@shoplokl.in"
    )
    # Gupshup reconciliation (2026-09): approved merchant_approved template
    # dropped its second variable (one of the two hardcoded next-step
    # URLs above) — store_name is the only genuine per-call variable this
    # function ever had, and it's the one confirmed to survive.
    send_with_fallback(merchant_phone, body, message_type="merchant_approved",
                        template_params={"1": store_name})


def notify_merchant_kyc_rejected(merchant_phone: str, store_name: str) -> None:
    """New (2026-09 Gupshup reconciliation) — this event was previously
    in-app-only (see admin_reject() in server.py, which still pushes its
    own in-app notification unchanged). The approved Gupshup template has
    ONLY Variable 1, which carries the store/business name — explicitly
    NOT the rejection reason, a URL, or the support phone (per the
    reconciliation instructions); the merchant sees the actual reason
    in-app, same as before."""
    body = (
        f"Your Lokl KYC submission for {store_name} needs attention. "
        f"Check the app for details and resubmit."
    )
    send_with_fallback(merchant_phone, body, message_type="merchant_kyc_rejected",
                        template_params={"1": store_name})


def notify_merchant_kyc_on_hold(merchant_phone: str, store_name: str, comment: str) -> None:
    """New (2026-09 Gupshup reconciliation) — previously in-app-only (see
    admin_hold() in server.py, which still pushes its own in-app
    notification unchanged). Meta removed variables 3 and 4 from the
    originally-submitted template; store_name and the admin's hold
    comment are the two variables this event naturally has and are sent
    here as the best-effort remaining pair — NOT independently confirmed
    against the live Gupshup dashboard (the reconciliation audit did not
    have visibility into what all 4 original variables were). Confirm the
    exact surviving count/order before relying on this in production."""
    body = (
        f"Your Lokl KYC submission for {store_name} is on hold. "
        f"{comment} Check the app for details."
    )
    send_with_fallback(merchant_phone, body, message_type="merchant_kyc_on_hold",
                        template_params={"1": store_name, "2": comment})


def notify_merchant_first_order(merchant_phone: str, store_name: str, order_id: str) -> None:
    short = order_id[-6:].upper()
    body = (
        f"Your first order on Lokl is here!\n\n"
        f"Order #{short} at {store_name}\n\n"
        f"Accept it quickly at {APP_URL}/merchant/orders\n"
        f"First impressions matter — fast response builds your rating."
    )
    send_with_fallback(merchant_phone, body, message_type="merchant_first_order")
