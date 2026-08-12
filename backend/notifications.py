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
  - `get_provider()` — factory reading NOTIFICATION_PROVIDER (default
    "twilio"). An unrecognized value logs a warning and falls back to
    Twilio rather than breaking the app.
  - The OLD module-level functions (`send_with_fallback`, `send_sms`,
    `send_whatsapp`, `send_otp_with_fallback`) are KEPT, unchanged in name,
    as thin delegates to `get_provider()`. test_smoke_imports.py asserts
    `send_with_fallback` exists as a module attribute — must stay.

### OTP delivery contract — provider asymmetry (READ THIS)
Twilio and MSG91 own OTP verification differently, and the two request-otp
/verify-otp code paths in server.py branch accordingly (see the docstrings
on customer_request_otp/customer_verify_otp etc. in server.py for the exact
branch, and `active_provider_name()` below for the switch):

  - **Twilio** (default): server.py generates the 6-digit OTP itself,
    bcrypt-hashes it into db.customer_otps/db.rider_otps/
    db.merchant_login_otps with a 10-minute TTL and 5-attempt lockout, and
    calls `TwilioProvider.send_otp(to, otp)` purely to DELIVER that code
    (WhatsApp with ~5s delivery poll, falling back to SMS). Verification is
    a local bcrypt compare against that same collection — completely
    unaffected by this migration. `TwilioProvider.verify_otp()` is a
    documented no-op (`return True`) because Twilio is never actually
    consulted for verification; it exists only to satisfy the interface.
  - **MSG91**: MSG91's dedicated OTP product (v5/otp, v5/otp/verify) owns
    the entire lifecycle — it generates its own code, delivers it (per the
    channel policy configured against MSG91_OTP_TEMPLATE_ID in the MSG91
    dashboard), and verifies it server-side. server.py does NOT write a
    local OTP record for this path — there is nothing to hash or compare
    locally. `MSG91Provider.send_otp(to)` is called with no `otp` argument
    (MSG91 generates it), and `MSG91Provider.verify_otp(to, otp)` calls
    MSG91's verify API directly.
  - This means: switching providers changes WHO owns OTP state, not just
    which SMS vendor is used. Rolling back to Twilio (NOTIFICATION_PROVIDER
    unset or "twilio") immediately restores the local-generate/local-verify
    path with zero code changes needed — that's the whole point of keeping
    the local bcrypt logic fully intact and untouched by this migration.

Merchant and rider LOGIN-OTP notifications (notify_merchant_otp /
notify_rider_otp) are a partial exception: they need custom wording ("Lokl
merchant login code...") that doesn't fit either provider's fixed OTP
template, so they always go through the generic send_with_fallback() path
(message_type="merchant_login_otp"/"rider_login_otp") — meaning MERCHANT
and RIDER login OTPs are ALWAYS verified locally (bcrypt), regardless of
which provider is active. Only the DELIVERY channel switches with
NOTIFICATION_PROVIDER for those two flows; only CUSTOMER OTP fully switches
delivery AND verification to MSG91 when it's active. See server.py's
merchant_verify_otp/rider_verify_otp — they are intentionally NOT branched
by provider, unlike customer_verify_otp.

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
        "return_status": "MSG91_SMS_TEMPLATE_RETURN_STATUS",
        "pickup_reserved": "MSG91_SMS_TEMPLATE_PICKUP_RESERVED",
        "merchant_pickup_reserved": "MSG91_SMS_TEMPLATE_MERCHANT_PICKUP_RESERVED",
        "pickup_pending": "MSG91_SMS_TEMPLATE_PICKUP_PENDING",
        "merchant_pickup_pending": "MSG91_SMS_TEMPLATE_MERCHANT_PICKUP_PENDING",
        "merchant_approved": "MSG91_SMS_TEMPLATE_MERCHANT_APPROVED",
        "merchant_first_order": "MSG91_SMS_TEMPLATE_MERCHANT_FIRST_ORDER",
        "merchant_login_otp": "MSG91_SMS_TEMPLATE_MERCHANT_LOGIN_OTP",
        "rider_login_otp": "MSG91_SMS_TEMPLATE_RIDER_LOGIN_OTP",
        # Ad-hoc call sites in server.py that don't go through a notify_*
        # wrapper (see grep of send_with_fallback( in server.py):
        "merchant_order_cancelled_by_customer": "MSG91_SMS_TEMPLATE_MERCHANT_ORDER_CANCELLED_BY_CUSTOMER",
        "admin_support_ticket": "MSG91_SMS_TEMPLATE_ADMIN_SUPPORT_TICKET",
        "store_back_online": "MSG91_SMS_TEMPLATE_STORE_BACK_ONLINE",
        "pickup_reservation_expired": "MSG91_SMS_TEMPLATE_PICKUP_RESERVATION_EXPIRED",
        "order_auto_cancelled": "MSG91_SMS_TEMPLATE_ORDER_AUTO_CANCELLED",
        # Commit 3: the admin parallel-test endpoint's own test message.
        "admin_notification_test": "MSG91_SMS_TEMPLATE_ADMIN_NOTIFICATION_TEST",
        # order_accepted is dead code (zero call sites, see notify_order_accepted's
        # docstring) — deliberately NOT mapped; no Railway var needed for it.
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
    if name not in ("twilio", "msg91"):
        log.warning("[notify] NOTIFICATION_PROVIDER=%r is not implemented — using twilio", name)
        name = "twilio"
    inst = _provider_instances.get(name)
    if inst is None:
        inst = MSG91Provider() if name == "msg91" else TwilioProvider()
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


def send_with_fallback(phone: str, body: str, *, message_type: Optional[str] = None) -> str:
    """Best-effort delivery for ANY transactional message — WhatsApp first, SMS on failure.

    Unlike `send_otp_with_fallback`, this skips the status poll because
    order-flow notifications can't tolerate that latency in a request
    handler. Any WhatsApp-side rejection is treated as "fall back now".
    Successful submission counts as success — terminal delivery status is
    best effort, surfaced via the provider's own dashboard/status webhook.

    `message_type` identifies which template this message is, for
    providers (MSG91) that need it to route to a specific DLT/WA template —
    see the module docstring. Twilio ignores it.

    Returns `"whatsapp"`, `"sms"`, or `"none"`.
    """
    provider = get_provider()
    provider_name = type(provider).__name__.replace("Provider", "").lower()
    log.info("[NOTIFY] provider=%s %s <- %.80s", provider_name, phone, body.replace("\n", " "))
    sid = provider.send_whatsapp(phone, body, message_type=message_type)
    if sid:
        log.info("[NOTIFY] provider=%s WhatsApp OK sid=%s to=%s", provider_name, sid, phone)
        return "whatsapp"
    log.warning("[NOTIFY] provider=%s WhatsApp failed for %s (%s) — falling back to SMS",
                provider_name, phone, provider.last_result.get("error", "see prior log line"))
    if provider.send_sms(phone, body, message_type=message_type):
        log.info("[NOTIFY] provider=%s SMS fallback delivered to %s", provider_name, phone)
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

def notify_customer_otp(customer_phone: str, otp: str) -> None:
    """Send the 6-digit login OTP to the customer.

    Twilio-only path — see module docstring's OTP asymmetry section. When
    MSG91 is active, server.py's customer_request_otp does NOT call this
    function at all; it calls get_provider().send_otp(phone) directly with
    no local otp, letting MSG91 generate its own.

    Dev/preview: when `CUSTOMER_OTP_DEBUG=true` we also log the OTP to the
    backend log so testing works without a real phone.
    """
    if os.environ.get("CUSTOMER_OTP_DEBUG", "").strip().lower() in ("1", "true", "yes"):
        log.warning("[OTP-DEBUG] phone=%s otp=%s", customer_phone, otp)
    provider = get_provider()
    provider_name = type(provider).__name__.replace("Provider", "").lower()
    result = provider.send_otp(customer_phone, otp)
    if result == "none":
        log.warning("[OTP] provider=%s customer OTP delivery FAILED for %s (%s)",
                    provider_name, customer_phone, provider.last_result.get("error", "all channels"))
    else:
        log.info("[OTP] provider=%s customer OTP delivered via=%s to=%s", provider_name, result, customer_phone)


def notify_merchant_otp(merchant_phone: str, otp: str) -> None:
    """Merchant phone-OTP login. Always locally generated/verified — see
    module docstring — only the delivery channel changes with the active
    provider. Uses send_with_fallback (the generic path), NOT send_otp: the
    OTP-template contract is fixed-wording, and merchants need unambiguous
    merchant-themed wording instead."""
    if os.environ.get("CUSTOMER_OTP_DEBUG", "").strip().lower() in ("1", "true", "yes"):
        log.warning("[MERCHANT-OTP-DEBUG] phone=%s otp=%s", merchant_phone, otp)
    body = (
        f"Lokl merchant login code: {otp}. "
        f"Valid for 10 minutes. Don't share this code with anyone."
    )
    send_with_fallback(merchant_phone, body, message_type="merchant_login_otp")


def notify_rider_otp(rider_phone: str, otp: str) -> None:
    """Rider phone-OTP login. Always locally generated/verified — see
    module docstring — only the delivery channel changes with the active
    provider. Same send_with_fallback rationale as notify_merchant_otp."""
    if os.environ.get("CUSTOMER_OTP_DEBUG", "").strip().lower() in ("1", "true", "yes"):
        log.warning("[RIDER-OTP-DEBUG] phone=%s otp=%s", rider_phone, otp)
    body = (
        f"Lokl rider login code: {otp}. "
        f"Valid for 10 minutes. Don't share this code with anyone."
    )
    send_with_fallback(rider_phone, body, message_type="rider_login_otp")


def notify_order_placed(phone: str, order_id: str, total: float) -> None:
    short = order_id[-6:].upper()
    body = (
        f"Hi! 🛍️ Your Lokl order #{short} is confirmed.\n\n"
        f"Amount: ₹{total:.0f}\n"
        f"Your store is packing your order — delivery in ~30 minutes.\n\n"
        f"Track here: {APP_URL}/account/orders/{order_id}\n\n"
        f"Questions? {SUPPORT_PHONE}"
    )
    send_with_fallback(phone, body, message_type="order_placed")


def notify_merchant_new_order(merchant_phone: str, order_id: str, total: float, items_count: int) -> None:
    short = order_id[-6:].upper()
    body = (
        f"🛍️ NEW ORDER #{short}\n\n"
        f"{items_count} item(s) · ₹{total:.0f}\n\n"
        f"Accept quickly to keep your rating high!\n"
        f"👉 {APP_URL}/merchant/orders"
    )
    send_with_fallback(merchant_phone, body, message_type="merchant_new_order")


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


def notify_order_rejected(phone: str, order_id: str) -> None:
    short = order_id[-6:].upper()
    body = (
        f"😔 Order #{short} could not be fulfilled by the store.\n\n"
        f"Since you pay at delivery, no amount was charged.\n\n"
        f"Browse other stores: {APP_URL}\n"
        f"Need help? {SUPPORT_PHONE}"
    )
    send_with_fallback(phone, body, message_type="order_rejected")


def notify_rider_pickup(rider_phone: str, *, order_id: str, otp: str, customer_name: str,
                        store_name: str, store_address: str, customer_address: str,
                        items_summary: str = "", upi_qr_url: str = "",
                        store_lat: float = 0, store_lng: float = 0,
                        customer_lat: float = 0, customer_lng: float = 0) -> None:
    """Notify the registered rider when a merchant accepts an order."""
    short_id = order_id[-6:].upper()
    pickup_map = f"https://maps.google.com/?q={store_lat},{store_lng}" if store_lat and store_lng else ""
    drop_map = f"https://maps.google.com/?q={customer_lat},{customer_lng}" if customer_lat and customer_lng else ""
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
{items_summary or "(see app)"}

🔑 OTP: {otp}
Ask customer for this OTP on delivery.

{f"💳 UPI QR for payment:{chr(10)}{upi_qr_url}" if upi_qr_url else "💳 Collect payment via UPI/cash"}

✅ TO CONFIRM DELIVERY:
Reply: {otp} Delivered"""
    send_with_fallback(rider_phone, body, message_type="rider_pickup")


def notify_order_on_the_way(phone: str, order_id: str, otp: str, rider_phone: str = "") -> None:
    """Rider-flow redesign: this is now the customer's FIRST delivery-related
    notification (merchant-accept no longer notifies) — it's where the
    delivery OTP is revealed, plus the assigned rider's phone when known."""
    short = order_id[-6:].upper()
    rider_line = f"🛵 Your rider: {rider_phone}\n" if rider_phone else ""
    body = (
        f"🚴 Your order #{short} is on the way!\n\n"
        f"{rider_line}"
        f"🔑 OTP: *{otp}*\n"
        f"Share this with your rider on arrival to confirm delivery.\n\n"
        f"Track: {APP_URL}/account/orders/{order_id}"
    )
    send_with_fallback(phone, body, message_type="order_on_the_way")


def notify_order_cancelled(phone: str, order_id: str, reason: str = "") -> None:
    short = order_id[-6:].upper()
    body = (
        f"❌ Order #{short} was cancelled.\n"
        f"{f'Reason: {reason}' + chr(10) if reason else ''}\n"
        f"Since you pay at delivery, no amount was charged.\n\n"
        f"Browse other stores: {APP_URL}\n"
        f"Need help? {SUPPORT_PHONE}"
    )
    send_with_fallback(phone, body, message_type="order_cancelled")


def notify_order_delivered(phone: str, order_id: str) -> None:
    short = order_id[-6:].upper()
    body = (
        f"🎉 Order #{short} delivered!\n\n"
        f"Hope you love it! Rate your experience:\n"
        f"{APP_URL}/account/orders/{order_id}\n\n"
        f"Shop again: {APP_URL}"
    )
    send_with_fallback(phone, body, message_type="order_delivered")


def notify_rider_return_pickup(rider_phone: str, *, return_id: str, order_id: str, otp: str,
                                customer_name: str, pickup_addr: str, items: list[dict],
                                reason: str = "") -> None:
    """Notify the rider for a return pickup (reverse pickup flow)."""
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
    send_with_fallback(rider_phone, body, message_type="rider_return_pickup")


def notify_return_status(customer_phone: str, return_id: str, status_label: str) -> None:
    body = (
        f"Lokl: Return {return_id} update — {status_label}. "
        f"Track at {APP_URL}/returns/{return_id}"
    )
    send_with_fallback(customer_phone, body, message_type="return_status")


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
    send_with_fallback(merchant_phone, body, message_type="merchant_approved")


def notify_merchant_first_order(merchant_phone: str, store_name: str, order_id: str) -> None:
    short = order_id[-6:].upper()
    body = (
        f"Your first order on Lokl is here!\n\n"
        f"Order #{short} at {store_name}\n\n"
        f"Accept it quickly at {APP_URL}/merchant/orders\n"
        f"First impressions matter — fast response builds your rating."
    )
    send_with_fallback(merchant_phone, body, message_type="merchant_first_order")
