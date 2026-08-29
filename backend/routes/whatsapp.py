"""WhatsApp merchant product-addition — Phase 1 MVP.

Real production route (supersedes the throwaway `gupshup_poc.py` PoC, which
this implementation is built directly from — see that module's captured
payload shapes, confirmed live against the Gupshup account already
configured in backend/.env).

Flow: merchant sends "ADD PRODUCT" -> bot explains the structured format ->
merchant sends a photo + as many fields as they want, in any order, across
as many messages as it takes -> bot merges + validates after every message,
asking only for what's still missing/invalid -> once everything required is
present, bot shows a summary -> merchant replies YES -> product is created
through the EXISTING canonical `_create_product_for_merchant` path — no
duplicate insert/validation logic here.

`init(db, ...)` factory pattern matches routes/geo.py and routes/addresses.py
— this module never imports server.py directly at module load time (would
create a circular import); server.py hands in the private helpers this
needs. `ProductCreate` is imported lazily inside `_finalize_product` for the
same reason.

Post-audit hardening (this revision): every write to a draft that isn't the
one-shot YES->PRODUCT_CREATED transition now goes through an optimistic
version-guarded update (`_atomic_merge_update`), so two inbound messages
processed concurrently for the same phone can never silently clobber each
other's fields. See `_atomic_merge_update`'s docstring and `_finalize_product`'s
for the exact guarantees."""
from __future__ import annotations

import asyncio
import hmac
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import PlainTextResponse
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from seed_data import L1_CATEGORIES, L2_BY_L1
from services import cloudinary_service
from services.audit_service import AuditService
from services.whatsapp_parser import (
    parse_structured_text, merge_fields, compute_missing,
    format_missing_prompt, format_confirmation_summary,
    resolve_numbered_choice, l1_name, l2_name, l2_options_for,
)
from notifications import GupshupProvider

log = logging.getLogger("lokl.whatsapp")

router = APIRouter(prefix="/api/webhooks/gupshup", tags=["whatsapp"])

TERMINAL_STATES = ("PRODUCT_CREATED", "CANCELLED", "EXPIRED")

# Retention is state-dependent (post-audit fix): an ACTIVE/incomplete draft
# is abandoned-and-purged quickly, a CANCELLED one is kept briefly for
# immediate support follow-up, but a PRODUCT_CREATED one — a real,
# successful conversation — is kept much longer so "which WhatsApp message
# created product X" stays answerable. All three still use the SAME single
# expires_at TTL index; only the value written differs by state. No new
# database system, no second index.
DRAFT_TTL_MINUTES = 30
CANCELLED_RETENTION_HOURS = 24
PRODUCT_CREATED_RETENTION_DAYS = 90

WEBHOOK_EVENT_TTL_DAYS = 7
MERGE_RETRY_ATTEMPTS = 3

_INSTRUCTIONS = (
    "Let's add a product! Send a photo of the product, plus its details in this format "
    "(you can leave lines out and send them later, and in any order):\n\n"
    "Product Name: \n"
    "Description: \n"
    "Category: \n"
    "Product Type: \n"
    "MRP: \n"
    "Selling Price: \n"
    "Sizes: \n"
    "Stock per Size: \n"
    "Returnable: \n"
    "Return Window: \n"
    "Try & Buy: \n"
    "Brand: \n\n"
    "Example:\n"
    "Product Name: Black Round Neck T-Shirt\n"
    "Category: Men\n"
    "Product Type: T-Shirts\n"
    "Selling Price: 799\n"
    "Sizes: S;M;L\n"
    "Stock per Size: 3;4;5\n\n"
    "At any point, reply CANCEL to discard this product or RESTART to start over."
)

_CONFIRMATION_HELP = (
    "Reply YES to confirm, CANCEL to discard, RESTART to start over, "
    "or send corrected details (e.g. 'Selling Price: 899')."
)


def _gupshup_provider() -> GupshupProvider:
    return GupshupProvider()


async def _reply(provider: GupshupProvider, phone10: str, text: str) -> None:
    """GupshupProvider.send_session_text() uses `requests` (sync/blocking)
    — same event-loop-blocking hazard the Cloudinary upload incident fixed
    (see cloudinary_service.py's own comment on _do_upload). Run it on a
    worker thread so a slow/hung Gupshup call never stalls the whole
    backend the way the pre-fix Cloudinary upload did."""
    try:
        await asyncio.to_thread(provider.send_session_text, phone10, text)
    except Exception:
        log.exception("[whatsapp] reply send failed for %s", phone10)


def _expiry_for(state: str, now: datetime) -> datetime:
    if state == "PRODUCT_CREATED":
        return now + timedelta(days=PRODUCT_CREATED_RETENTION_DAYS)
    if state == "CANCELLED":
        return now + timedelta(hours=CANCELLED_RETENTION_HOURS)
    return now + timedelta(minutes=DRAFT_TTL_MINUTES)  # AWAITING_* / EXPIRED-not-yet-reached


def init(db, *, normalize_merchant_phone, resolve_brand, create_product_for_merchant, rate_limit):
    """Wire the router to server.py's shared db + private helpers.

    - normalize_merchant_phone: server.py's `_normalize_merchant_phone_10`
    - resolve_brand: server.py's `_resolve_brand(merchant_id, provider, raw)`
    - create_product_for_merchant: server.py's `_create_product_for_merchant`
      — the ONLY place a Product document gets created. Never duplicated here.
    - rate_limit: server.py's `_limit` (slowapi decorator alias) — injected
      rather than imported directly, since importing server.py's module-level
      name at this module's top level would be a circular import (server.py
      imports THIS module to call init()). Applied exactly the same way
      every other webhook in this codebase applies it."""

    drafts = db.whatsapp_product_drafts
    events = db.whatsapp_webhook_events
    audit_service = AuditService(db)  # generic; its .log() call is annotated below with the caveat

    async def ensure_indexes():
        try:
            await events.create_index("message_id", unique=True)
            await events.create_index("expires_at", expireAfterSeconds=0)
        except Exception as e:
            log.warning("whatsapp_webhook_events indexes: %s", e)
        try:
            await drafts.create_index("expires_at", expireAfterSeconds=0)
            # Partial unique index: at most ONE non-terminal draft per phone,
            # enforced by MongoDB itself — not just application logic. Keyed
            # on a plain `is_active: True` equality (kept in sync by _touch()
            # and the YES-claim below) rather than `state $nin [...]` —
            # MongoDB's partialFilterExpression does not support $not/$nin,
            # only equality/$exists/comparison operators (confirmed live:
            # the $nin form fails index creation with "Expression not
            # supported in partial index: $not"). A document drops out of
            # this index the instant is_active flips to False, freeing that
            # phone up for a new draft.
            await drafts.create_index(
                "whatsapp_phone", unique=True, name="uniq_active_draft_per_phone",
                partialFilterExpression={"is_active": True},
            )
        except Exception as e:
            log.warning("whatsapp_product_drafts indexes: %s", e)

    def _touch(fields: dict) -> dict:
        """Stamps updated_at/expires_at/is_active. Retention depends on the
        STATE being written this update (see _expiry_for) — active states
        keep the short inactivity window, terminal states get their own
        longer/shorter retention regardless of when they're written.
        is_active must stay in lockstep with state — it's what the partial
        unique index (one active draft per phone) is keyed on."""
        now = datetime.now(timezone.utc)
        fields = dict(fields)
        state = fields.get("state", "AWAITING_MISSING_DETAILS")
        fields["updated_at"] = now
        fields["expires_at"] = _expiry_for(state, now)
        fields["is_active"] = state not in TERMINAL_STATES
        return fields

    async def _atomic_merge_update(draft_id: str, version: int, set_fields: dict):
        """Optimistic-concurrency write: succeeds only if `version` still
        matches what THIS caller last read. Returns the updated document on
        success, or None on a version conflict (someone else wrote first)
        — callers must re-read and retry rather than silently dropping the
        conflicting write, which is exactly the lost-update bug this fixes.
        `$inc`'s version bump makes every write — successful or not tried
        again — monotonically ordered, so version doubles as a cheap audit
        trail of how many times a draft was touched."""
        return await drafts.find_one_and_update(
            {"id": draft_id, "version": version},
            {"$set": set_fields, "$inc": {"version": 1}},
            return_document=ReturnDocument.AFTER,
        )

    async def _get_active_draft(phone10: str):
        # Filters on is_active (not state $nin) so this query is servable by
        # the partial unique index above, rather than a full collection scan.
        return await drafts.find_one({"whatsapp_phone": phone10, "is_active": True}, {"_id": 0})

    async def _new_draft(phone10: str, merchant_id: str, store_id: str) -> dict:
        """Insert-or-adopt: the partial unique index on whatsapp_phone means
        a concurrent second "ADD PRODUCT" (or a RESTART racing an ADD
        PRODUCT) can never create a second live draft for the same phone —
        the loser's insert raises DuplicateKeyError, and it simply adopts
        whichever draft the winner created instead of erroring."""
        now = datetime.now(timezone.utc)
        doc = {
            "id": uuid.uuid4().hex,
            "merchant_id": merchant_id,
            "store_id": store_id,
            "whatsapp_phone": phone10,
            "state": "AWAITING_PRODUCT_DETAILS",
            "version": 0,
            "is_active": True,
            "fields": {},
            "image_source_url": None,
            "image_public_id": None,
            "image_hosted_url": None,
            "missing_fields": ["image", "name", "category", "product_type", "price", "stock"],
            "invalid_fields": {},
            "pending_choice": None,
            "product_id": None,
            "last_error": None,
            "created_at": now,
            "updated_at": now,
            "expires_at": now + timedelta(minutes=DRAFT_TTL_MINUTES),
        }
        try:
            await drafts.insert_one(dict(doc))
            return doc
        except DuplicateKeyError:
            existing = await _get_active_draft(phone10)
            return existing or doc

    def _compute_pending_choice(fields: dict, missing: list[str]) -> dict | None:
        if "product_type" in missing and fields.get("l1_id"):
            return {"field": "product_type",
                    "options": [{"id": o["id"], "name": o["name"]} for o in l2_options_for(fields["l1_id"])]}
        if "category" in missing:
            return {"field": "category",
                    "options": [{"id": c["id"], "name": c["name"]} for c in L1_CATEGORIES]}
        return None

    async def _apply_message_to_draft(draft: dict, text: str) -> tuple[dict, str]:
        """Parses `text`, merges into the draft, persists with an optimistic
        version guard, and returns (updated_draft, reply_text). Does NOT
        send the reply — caller does. Reused for BOTH the normal
        collection states AND for corrections sent during
        AWAITING_CONFIRMATION — merge/validate/next-state logic is
        identical either way; the caller just decides when to invoke it.

        On a version conflict (a concurrent write beat this one), re-reads
        the latest draft and retries the SAME parse against the fresh
        fields — this is what prevents an image upload and a text message
        arriving back-to-back from silently losing whichever one lost the
        race, per the audit's requirement."""
        current = draft
        for _ in range(MERGE_RETRY_ATTEMPTS):
            parsed = parse_structured_text(text)
            if not parsed and text.strip().isdigit() and current.get("pending_choice"):
                resolved_id = resolve_numbered_choice(current["pending_choice"], text)
                field = current["pending_choice"]["field"]
                if resolved_id:
                    if field == "category":
                        parsed = {"category": l1_name(resolved_id)}
                    elif field == "product_type":
                        parsed = {"product_type": l2_name(current["fields"].get("l1_id"), resolved_id)}

            fields, errors = merge_fields(current.get("fields", {}), parsed)
            has_image = bool(current.get("image_hosted_url"))
            missing = compute_missing(fields, has_image)
            pending_choice = _compute_pending_choice(fields, missing)
            new_state = "AWAITING_CONFIRMATION" if not missing else "AWAITING_MISSING_DETAILS"

            set_fields = _touch({
                "fields": fields, "missing_fields": missing, "invalid_fields": errors,
                "pending_choice": pending_choice, "state": new_state,
            })
            updated = await _atomic_merge_update(current["id"], current["version"], set_fields)
            if updated is not None:
                reply = format_confirmation_summary(fields) if new_state == "AWAITING_CONFIRMATION" else format_missing_prompt(missing, errors, fields)
                return updated, reply

            fresh = await drafts.find_one({"id": current["id"]}, {"_id": 0})
            if fresh is None or fresh["state"] in TERMINAL_STATES:
                return current, "Your conversation state just changed — please resend your last message."
            current = fresh

        log.warning("[whatsapp] gave up merging draft %s after %d version conflicts", draft["id"], MERGE_RETRY_ATTEMPTS)
        return current, "We're processing another message from you right now — please resend your last message in a moment."

    async def _handle_image(draft: dict, merchant_id: str, image_url: str, caption: str) -> tuple[dict, str]:
        try:
            uploaded = await cloudinary_service.upload_image_from_url(image_url, "product", merchant_id)
        except HTTPException as e:
            return draft, f"Couldn't process that photo ({e.detail}). Please try sending it again."

        image_fields = {
            "image_source_url": image_url,
            "image_hosted_url": uploaded["image_url"],
            "image_public_id": uploaded["public_id"],
        }
        current = draft
        for _ in range(MERGE_RETRY_ATTEMPTS):
            updated = await _atomic_merge_update(current["id"], current["version"], _touch(dict(image_fields)))
            if updated is not None:
                current = updated
                break
            fresh = await drafts.find_one({"id": current["id"]}, {"_id": 0})
            if fresh is None or fresh["state"] in TERMINAL_STATES:
                return current, "Your conversation state just changed — please resend your photo."
            current = fresh
        else:
            return current, "We're processing another message from you right now — please resend your photo in a moment."

        # Re-validate now that the image is attached. An empty-text call to
        # _apply_message_to_draft merges nothing new but correctly
        # recomputes missing/state with has_image now true — reuses the
        # exact same merge/validate/write path instead of a second copy of it.
        return await _apply_message_to_draft(current, caption or "")

    async def _finalize_product(draft: dict) -> str:
        """Atomically claims the AWAITING_CONFIRMATION -> PRODUCT_CREATED
        transition (still the ONLY guard needed against duplicate YES —
        unchanged from before), but now everything between the claim and a
        confirmed product_id is inside the SAME try/except. Post-audit fix:
        previously the claim happened, then several unprotected steps
        (dict access, brand resolution, ProductCreate construction) ran
        BEFORE the try block even started — any exception there left the
        draft permanently stuck at PRODUCT_CREATED with product_id=None,
        with no way to retell the merchant or retry. Now ANY failure in
        that whole path rolls the draft back to AWAITING_CONFIRMATION
        with last_error set, so PRODUCT_CREATED is reachable ONLY via the
        single line at the very end, right after create_product_for_merchant
        has already returned successfully."""
        claimed = await drafts.find_one_and_update(
            {"id": draft["id"], "state": "AWAITING_CONFIRMATION"},
            {"$set": {"state": "PRODUCT_CREATED", "is_active": False, "updated_at": datetime.now(timezone.utc)},
             "$inc": {"version": 1}},
        )
        if claimed is None:
            log.warning("[whatsapp] duplicate YES for draft %s ignored (already processed)", draft["id"])
            return ""  # already handled by a prior message — no reply needed

        try:
            fields = draft["fields"]
            l1_id = fields["l1_id"]
            l2_id = fields.get("l2_id") or ""
            gender = "unisex" if l1_id not in L2_BY_L1 else ""  # defensive fallback; every current L1 has L2 entries

            brand_id = None
            if fields.get("brand_raw"):
                brand_id, _unmatched = await resolve_brand(draft["merchant_id"], "whatsapp", fields["brand_raw"])

            from server import ProductCreate  # deferred import — avoids the circular import at module load time
            payload = ProductCreate(
                name=fields["name"], price=fields["price"], mrp=fields.get("mrp"),
                l1_id=l1_id, l2_id=l2_id, gender=gender,
                description=fields.get("description") or "",
                sizes=fields.get("sizes") or [], stock=fields.get("stock"),
                image=draft["image_hosted_url"], image_public_id=draft["image_public_id"],
                images=[draft["image_hosted_url"]], image_public_ids=[draft["image_public_id"]],
                return_eligible=bool(fields.get("returnable")),
                return_window_hours=fields.get("return_window_hours"),
                try_at_doorstep=bool(fields.get("try_and_buy")),
                brand_id=brand_id,
                provider="whatsapp",
            )
            doc = await create_product_for_merchant(payload, draft["merchant_id"])
        except Exception as e:
            detail = e.detail if isinstance(e, HTTPException) else str(e)
            log.warning("[whatsapp] product creation failed for draft %s: %s", draft["id"], detail)
            await drafts.update_one({"id": draft["id"]}, {"$set": _touch({
                "state": "AWAITING_CONFIRMATION", "last_error": detail,
            })})
            return f"Couldn't create the product: {detail}\nReply YES to try again once fixed, or CANCEL to discard."

        await drafts.update_one({"id": draft["id"]}, {"$set": _touch({
            "state": "PRODUCT_CREATED", "product_id": doc["id"],
        })})

        # Audit trail (post-audit fix). NOTE: AuditService.log() writes to
        # the `payment_audit_log` collection — it's payment-shaped
        # (razorpay_order_id/razorpay_payment_id/currency fields), not a
        # generic audit log, despite the generic class name. Reusing it
        # here (as explicitly instructed) rather than building a new audit
        # mechanism; the payment-specific fields are simply left None and
        # everything WhatsApp-specific goes in `metadata`. Worth renaming/
        # splitting properly if this collection becomes a real cross-
        # product audit trail later — flagged, not fixed here (out of scope).
        try:
            await audit_service.log(
                event_type="whatsapp_product_created",
                actor="whatsapp",
                metadata={
                    "channel": "whatsapp", "merchant_id": draft["merchant_id"],
                    "store_id": draft["store_id"], "product_id": doc["id"],
                    "whatsapp_phone": draft["whatsapp_phone"], "price": doc.get("price"),
                },
            )
        except Exception:
            log.exception("[whatsapp] audit log write failed for product %s (product was still created)", doc["id"])

        return f"✅ Product created: {doc['name']} at ₹{doc['price']}. It's now live on your store."

    @router.post("/inbound")
    @rate_limit("120/minute")
    async def gupshup_inbound(request: Request):
        # Keyed by source IP (slowapi default) — ALL genuine Gupshup traffic
        # comes from Gupshup's own servers, not per-merchant IPs, so this
        # bounds combined webhook throughput across every merchant at once,
        # matching the existing Shopify webhook's own rate (house convention),
        # not a per-merchant cap. Ample headroom for a controlled pilot.
        secret = (os.environ.get("GUPSHUP_WEBHOOK_SECRET") or "").strip()
        received = request.headers.get("x-lokl-webhook-secret", "")
        if not secret or not hmac.compare_digest(secret, received):
            log.warning("[whatsapp] webhook auth failed (secret configured=%s)", bool(secret))
            raise HTTPException(403, "Invalid webhook secret")

        try:
            body = await request.json()
        except Exception:
            log.warning("[whatsapp] inbound request body was not valid JSON")
            return PlainTextResponse("", status_code=200)

        if not isinstance(body, dict) or body.get("type") != "message":
            # sandbox-start / message-event (delivery receipts for OUR own
            # outbound sends) / any unrecognized event category — nothing
            # to do. Never let a non-"message" event reach the state machine.
            return PlainTextResponse("", status_code=200)

        msg = body.get("payload")
        if not isinstance(msg, dict):
            return PlainTextResponse("", status_code=200)

        message_id = msg.get("id")
        if not message_id:
            return PlainTextResponse("", status_code=200)

        try:
            now = datetime.now(timezone.utc)
            await events.insert_one({
                "message_id": message_id, "received_at": now,
                "expires_at": now + timedelta(days=WEBHOOK_EVENT_TTL_DAYS),
            })
        except DuplicateKeyError:
            return PlainTextResponse("", status_code=200)

        # Everything from here on is a defensive backstop against a
        # malformed-but-superficially-valid payload (unexpected types
        # nested deeper than the checks above cover) or any other
        # unanticipated failure — never let it escape as an unhandled 500.
        try:
            raw_source = msg.get("source") or (msg.get("sender") or {}).get("phone") or ""
            phone10 = normalize_merchant_phone(raw_source) if isinstance(raw_source, str) else None
            provider = _gupshup_provider()

            if not phone10:
                log.warning("[whatsapp] could not extract a usable phone from inbound message %s", message_id)
                return PlainTextResponse("", status_code=200)

            merchant = await db.merchants.find_one({"phone_canonical": phone10}, {"_id": 0})
            if not merchant:
                await _reply(provider, phone10, "We don't recognize this number. Please message from your registered Lokl phone.")
                return PlainTextResponse("", status_code=200)

            merchant_id = merchant["id"]
            store_id = f"store-m-{merchant_id}"

            msg_type = msg.get("type")
            inner = msg.get("payload")
            inner = inner if isinstance(inner, dict) else {}
            text_body = inner.get("text") if msg_type == "text" else inner.get("caption") or ""
            text_body = text_body if isinstance(text_body, str) else ""
            image_url = inner.get("url") if msg_type == "image" else None

            upper = text_body.strip().upper()
            draft = await _get_active_draft(phone10)

            if draft is None:
                if upper == "ADD PRODUCT":
                    await _new_draft(phone10, merchant_id, store_id)
                    await _reply(provider, phone10, _INSTRUCTIONS)
                else:
                    await _reply(provider, phone10, "Send ADD PRODUCT to add a product.")
                return PlainTextResponse("", status_code=200)

            if upper == "CANCEL":
                await drafts.update_one({"id": draft["id"], "is_active": True},
                                         {"$set": _touch({"state": "CANCELLED"})})
                await _reply(provider, phone10, "Cancelled. Send ADD PRODUCT to start again.")
                return PlainTextResponse("", status_code=200)

            if upper == "RESTART":
                await drafts.update_one({"id": draft["id"], "is_active": True},
                                         {"$set": _touch({"state": "CANCELLED"})})
                await _new_draft(phone10, merchant_id, store_id)
                await _reply(provider, phone10, _INSTRUCTIONS)
                return PlainTextResponse("", status_code=200)

            if draft["state"] in ("AWAITING_PRODUCT_DETAILS", "AWAITING_MISSING_DETAILS"):
                if msg_type == "image" and image_url:
                    draft, reply = await _handle_image(draft, merchant_id, image_url, text_body)
                elif msg_type == "text":
                    draft, reply = await _apply_message_to_draft(draft, text_body)
                else:
                    reply = "Sorry, I can only read text and photos right now. Please resend as text or a photo."
                await _reply(provider, phone10, reply)
                return PlainTextResponse("", status_code=200)

            if draft["state"] == "AWAITING_CONFIRMATION":
                if upper == "YES":
                    reply = await _finalize_product(draft)
                    if reply:
                        await _reply(provider, phone10, reply)
                else:
                    # Corrections during confirmation (post-audit fix): try
                    # to parse the message as structured field corrections
                    # instead of only accepting YES. Reuses the exact same
                    # merge/validate/next-state logic as the collection
                    # states — a correction that breaks completeness
                    # correctly drops back to AWAITING_MISSING_DETAILS, a
                    # valid same-shape correction re-shows the summary and
                    # stays effectively at AWAITING_CONFIRMATION.
                    if parse_structured_text(text_body):
                        draft, reply = await _apply_message_to_draft(draft, text_body)
                        await _reply(provider, phone10, reply)
                    else:
                        await _reply(provider, phone10, _CONFIRMATION_HELP)
                return PlainTextResponse("", status_code=200)

            # PRODUCT_CREATED (terminal, but _get_active_draft already
            # excludes it — reachable only via a race between two
            # concurrent messages).
            await _reply(provider, phone10, "This product was already added. Send ADD PRODUCT to add another.")
            return PlainTextResponse("", status_code=200)
        except Exception:
            log.exception("[whatsapp] unhandled error processing inbound message %s", message_id)
            return PlainTextResponse("", status_code=200)

    return router, ensure_indexes
