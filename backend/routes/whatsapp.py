"""WhatsApp merchant product-addition.

AI-assisted, AI-minimised redesign. Merchants send product photos and
details in ANY natural format, across as many messages as they like — no
rigid template, no manual category/product-type selection required in the
normal path. Deterministic parsing (services/whatsapp_parser.py) is always
tried FIRST; OpenAI (services/whatsapp_ai.py) is called ONLY when
deterministic parsing genuinely cannot resolve what's needed — messy/
unstructured text, or taxonomy classification with no explicit category
given. See _needs_ai_for_collection()/_needs_ai_for_correction() for the
exact decision rules. AI never sees images and never writes to Mongo or
calls _create_product_for_merchant — this route owns all state and all
product-creation logic exactly as before.

`init(db, ...)` factory pattern matches routes/geo.py and routes/addresses.py
— this module never imports server.py directly at module load time (would
create a circular import); server.py hands in the private helpers this
needs. `ProductCreate` is imported lazily inside `_finalize_product` for the
same reason.

Concurrency (unchanged discipline from the original hardening pass, now
also covering AI calls): every draft write goes through the optimistic
version-guarded `_atomic_merge_update`. For an AI-involving message: read
draft at version N -> decide AI is needed -> call AI against that
snapshot -> attempt the write conditioned on version N -> if the draft
changed underneath (conflict), the stale AI result is discarded entirely,
the draft is re-read, and the whole decision (including whether AI is
even still needed) is re-evaluated from scratch — bounded to
MERGE_RETRY_ATTEMPTS, never an unbounded loop. A stale AI result can never
overwrite newer merchant information."""
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
from services.whatsapp_ai import extract as ai_extract, AIExtractionError
from services.whatsapp_parser import (
    parse_any, parse_structured_text, parse_loose_fields_with_remainder, merge_fields, merge_ai_fields,
    compute_core_missing, taxonomy_resolved, taxonomy_payload, validate_taxonomy,
    format_missing_prompt_natural, format_taxonomy_fallback_prompt,
    format_confirmation_summary, format_policy_prompt, parse_policy_answer,
    resolve_numbered_choice, infer_name_from_single_line, infer_name_from_remainder, infer_name_from_first_line,
    l1_name, l2_name, l2_options_for,
)
from notifications import GupshupProvider

log = logging.getLogger("lokl.whatsapp")

router = APIRouter(prefix="/api/webhooks/gupshup", tags=["whatsapp"])

TERMINAL_STATES = ("PRODUCT_CREATED", "CANCELLED", "EXPIRED")
POLICY_FIELDS = ("returnable", "return_window_hours", "try_and_buy")
MAX_IMAGES = 5

DRAFT_TTL_MINUTES = 30
CANCELLED_RETENTION_HOURS = 24
PRODUCT_CREATED_RETENTION_DAYS = 90

WEBHOOK_EVENT_TTL_DAYS = 7
MERGE_RETRY_ATTEMPTS = 3

# Deliberately short — no template, no examples, no taxonomy exposed.
_INSTRUCTIONS = (
    "Send product photos and details like name, price, sizes and stock. "
    "You can send everything in any order, across as many messages as you like.\n\n"
    "At any point, reply CANCEL to discard or RESTART to start over."
)

_CONFIRMATION_HELP = (
    "Reply YES to add it, CANCEL to discard, RESTART to start over, "
    "or just tell me what to change."
)

_UNRECOGNIZED_MESSAGE = "Sorry, I can only read text and photos right now. Please resend as text or a photo."


def _gupshup_provider() -> GupshupProvider:
    return GupshupProvider()


async def _reply(provider: GupshupProvider, phone10: str, text: str) -> None:
    """GupshupProvider.send_session_text() uses `requests` (sync/blocking)
    — same event-loop-blocking hazard the Cloudinary upload incident fixed.
    Run it on a worker thread so a slow/hung Gupshup call never stalls the
    whole backend."""
    try:
        await asyncio.to_thread(provider.send_session_text, phone10, text)
    except Exception:
        log.exception("[whatsapp] reply send failed for %s", phone10)


def _expiry_for(state: str, now: datetime) -> datetime:
    if state == "PRODUCT_CREATED":
        return now + timedelta(days=PRODUCT_CREATED_RETENTION_DAYS)
    if state == "CANCELLED":
        return now + timedelta(hours=CANCELLED_RETENTION_HOURS)
    return now + timedelta(minutes=DRAFT_TTL_MINUTES)


def _raw_entry(kind: str, *, text: str | None = None, image_url: str | None = None) -> dict:
    return {"type": kind, "text": text, "image_url": image_url, "at": datetime.now(timezone.utc)}


def _recent_text_context(draft: dict, current_message: str, limit: int = 4) -> str:
    """What gets sent to the AI: the current message plus a BOUNDED tail of
    prior raw text — not the entire conversation history, and never
    duplicated once a field is already confidently structured (the
    `already_known_fields` the AI also receives tells it what NOT to
    re-derive)."""
    prior = [m["text"] for m in (draft.get("raw_messages") or []) if m.get("text")][-limit:]
    return "\n".join(prior + [current_message])


def _ai_meta_entry(reason: str, model: str, success: bool, confidence: float | None,
                    name_for_taxonomy: str | None = None) -> dict:
    return {
        "last_reason": reason, "last_model": model, "last_success": success,
        "last_confidence": confidence, "last_at": datetime.now(timezone.utc),
        "last_name_for_taxonomy": name_for_taxonomy,
    }


def _needs_ai_for_collection(fields: dict, deterministic_found_anything: bool,
                              text: str, draft: dict) -> tuple[bool, str]:
    """The ONLY place this decision is made. AI is skipped for: empty/blank
    messages, YES/CANCEL/RESTART, very short acks, and — critically — any
    message where deterministic parsing already found what it needed and
    taxonomy is already resolved. This directly implements the product
    spec's Level-1/2/3 hierarchy."""
    t = (text or "").strip()
    if not t or t.upper() in ("YES", "CANCEL", "RESTART"):
        return False, ""
    if len(t) < 4:
        return False, ""

    if not taxonomy_resolved(fields) and fields.get("name"):
        # Re-attempt only when the name has actually changed since the last
        # taxonomy attempt — NOT simply because this message also resolved
        # some unrelated field (e.g. a price correction), which would
        # otherwise re-invoke AI on every single message indefinitely.
        last_tried = (draft.get("ai_meta") or {}).get("last_name_for_taxonomy")
        if last_tried != fields.get("name"):
            return True, "taxonomy_classification"

    if not deterministic_found_anything:
        core_incomplete = not fields.get("name") or fields.get("price") is None or fields.get("stock") is None
        if core_incomplete:
            return True, "messy_extraction"

    return False, ""


def init(db, *, normalize_merchant_phone, resolve_brand, create_product_for_merchant, rate_limit):
    """Wire the router to server.py's shared db + private helpers.

    - normalize_merchant_phone: server.py's `_normalize_merchant_phone_10`
    - resolve_brand: server.py's `_resolve_brand(merchant_id, provider, raw)`
    - create_product_for_merchant: server.py's `_create_product_for_merchant`
      — the ONLY place a Product document gets created. Never duplicated here.
    - rate_limit: server.py's `_limit` (slowapi decorator alias) — injected
      to avoid a circular import."""

    drafts = db.whatsapp_product_drafts
    events = db.whatsapp_webhook_events
    audit_service = AuditService(db)

    async def ensure_indexes():
        try:
            await events.create_index("message_id", unique=True)
            await events.create_index("expires_at", expireAfterSeconds=0)
        except Exception as e:
            log.warning("whatsapp_webhook_events indexes: %s", e)
        try:
            await drafts.create_index("expires_at", expireAfterSeconds=0)
            await drafts.create_index(
                "whatsapp_phone", unique=True, name="uniq_active_draft_per_phone",
                partialFilterExpression={"is_active": True},
            )
        except Exception as e:
            log.warning("whatsapp_product_drafts indexes: %s", e)

    def _touch(fields: dict) -> dict:
        now = datetime.now(timezone.utc)
        fields = dict(fields)
        state = fields.get("state", "AWAITING_MISSING_DETAILS")
        fields["updated_at"] = now
        fields["expires_at"] = _expiry_for(state, now)
        fields["is_active"] = state not in TERMINAL_STATES
        return fields

    async def _atomic_merge_update(draft_id: str, version: int, set_fields: dict):
        return await drafts.find_one_and_update(
            {"id": draft_id, "version": version},
            {"$set": set_fields, "$inc": {"version": 1}},
            return_document=ReturnDocument.AFTER,
        )

    async def _get_active_draft(phone10: str):
        return await drafts.find_one({"whatsapp_phone": phone10, "is_active": True}, {"_id": 0})

    async def _new_draft(phone10: str, merchant_id: str, store_id: str) -> dict:
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
            "raw_messages": [],
            "image_source_urls": [],
            "image_hosted_urls": [],
            "image_public_ids": [],
            "missing_fields": ["image", "name", "price", "stock"],
            "invalid_fields": {},
            "pending_choice": None,
            "taxonomy_fallback": False,
            "ai_meta": None,
            "ai_call_count": 0,
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

    def _fallback_pending_choice(fields: dict) -> dict:
        l1_id = fields.get("l1_id")
        if l1_id:
            return {"field": "product_type",
                    "options": [{"id": o["id"], "name": o["name"]} for o in l2_options_for(l1_id)]}
        return {"field": "category",
                "options": [{"id": c["id"], "name": c["name"]} for c in L1_CATEGORIES]}

    def _build_collection_reply(state: str, fields: dict, core_missing: list[str],
                                 taxonomy_fallback: bool, n_images: int) -> str:
        if state == "AWAITING_POLICY_DETAILS":
            return format_policy_prompt()
        if state == "AWAITING_CONFIRMATION":
            return format_confirmation_summary(fields, n_images)
        if taxonomy_fallback:
            return format_taxonomy_fallback_prompt(fields)
        return format_missing_prompt_natural(core_missing)

    async def _run_ai_or_none(text: str, fields: dict, draft: dict, reason: str):
        """Returns (ai_result_or_None, ai_meta_dict). Never raises — an AI
        failure is recorded and the caller proceeds with whatever
        deterministic parsing already found, per the required safe-failure
        behavior."""
        # Recorded regardless of success/failure — this is what lets the
        # dedup check in _needs_ai_for_collection tell "already tried
        # classifying this exact name" apart from "never tried" even when
        # every attempt fails (e.g. no API key configured locally).
        name_for_taxonomy = fields.get("name") if reason == "taxonomy_classification" else None
        try:
            result = await ai_extract(
                raw_text=_recent_text_context(draft, text),
                current_fields={k: v for k, v in fields.items() if k in
                                 ("name", "description", "mrp", "price", "sizes", "stock", "l1_id", "l2_id", "brand_raw")},
                taxonomy=taxonomy_payload(),
                merchant_context={},
                reason=reason,
            )
            meta = _ai_meta_entry(reason, result.model, True, result.confidence, name_for_taxonomy=name_for_taxonomy)
            return result, meta
        except AIExtractionError as e:
            log.warning("[whatsapp] AI extraction failed (reason=%s): %s", reason, e)
            meta = _ai_meta_entry(reason, os.environ.get("OPENAI_WHATSAPP_MODEL", "gpt-4o-mini"), False, None,
                                   name_for_taxonomy=name_for_taxonomy)
            return None, meta

    async def _process_collection_message(draft: dict, text: str) -> tuple[dict, str]:
        """Deterministic-first, AI-assisted-fallback message processing for
        the collection states (AWAITING_PRODUCT_DETAILS/AWAITING_MISSING_DETAILS).
        Implements the exact concurrency pattern required: re-decide and
        re-attempt AI from scratch against the freshest draft on every
        version conflict, bounded retries."""
        current = draft
        for _ in range(MERGE_RETRY_ATTEMPTS):
            loose_fields, remainder = parse_loose_fields_with_remainder(text)
            strict_fields = parse_structured_text(text)
            parsed = {**loose_fields, **strict_fields}
            existing_fields = current.get("fields", {})
            has_name_already = bool(existing_fields.get("name"))
            name_candidate = infer_name_from_single_line(text, has_name_already, parsed)
            if not name_candidate:
                name_candidate = infer_name_from_first_line(text, has_name_already)
            if not name_candidate and loose_fields:
                # A messier line where SOME loose fields (mrp/price/size-stock)
                # were found — try the leftover text as the name too, e.g.
                # "Pink tshirt" out of "Pink tshirt, M 2 L4 S7, mrp 899, SP 399".
                # Still zero AI cost: this is regex leftover, not inference.
                name_candidate = infer_name_from_remainder(remainder, has_name_already)
            if name_candidate:
                parsed = {**parsed, "name": name_candidate}

            if not parsed and current.get("pending_choice"):
                pending = current["pending_choice"]
                resolved_id = None
                if text.strip().isdigit():
                    resolved_id = resolve_numbered_choice(pending, text)
                else:
                    # Accept the option's name typed directly, not just its
                    # number — the fallback prompt explicitly offers both.
                    t_norm = text.strip().lower()
                    for opt in pending["options"]:
                        if opt["name"].strip().lower() == t_norm:
                            resolved_id = opt["id"]
                            break
                if resolved_id:
                    field = pending["field"]
                    if field == "category":
                        parsed = {"category": l1_name(resolved_id)}
                    elif field == "product_type":
                        parsed = {"product_type": l2_name(existing_fields.get("l1_id"), resolved_id)}

            fields, errors = merge_fields(existing_fields, parsed)
            deterministic_found_anything = bool(parsed)

            ai_meta_update = None
            needs_ai, reason = _needs_ai_for_collection(fields, deterministic_found_anything, text, current)
            if needs_ai:
                ai_result, ai_meta_update = await _run_ai_or_none(text, fields, current, reason)
                if ai_result is not None:
                    fields = merge_ai_fields(fields, ai_result, mode="fill")

            has_image = bool(current.get("image_hosted_urls"))
            core_missing = compute_core_missing(fields, has_image)
            tax_resolved = taxonomy_resolved(fields)

            taxonomy_fallback = current.get("taxonomy_fallback", False)
            if tax_resolved:
                taxonomy_fallback = False
            elif needs_ai:
                low_conf = ai_meta_update and ai_meta_update["last_success"] and (ai_meta_update["last_confidence"] or 0) < 0.5
                ai_failed = ai_meta_update and not ai_meta_update["last_success"]
                # A model can be CONFIDENTLY WRONG: it can return a real
                # l1_id and a real l2_id that simply don't belong together
                # (observed live: "Women's heels" -> l1-women + a footwear
                # l2). merge_ai_fields already refuses to write that combo
                # into `fields` (validate_taxonomy), but without this check
                # the draft would be silently stuck forever — taxonomy
                # never resolves, yet nothing ever asks the merchant either,
                # since low_conf/ai_failed alone don't cover "succeeded,
                # confident, and just wrong". Any attempted-but-invalid
                # combo routes to the same numbered-list fallback.
                ai_attempted_invalid_combo = (
                    needs_ai and ai_result is not None and (ai_result.l1_id or ai_result.l2_id)
                    and not validate_taxonomy(ai_result.l1_id, ai_result.l2_id)
                )
                if low_conf or ai_failed or ai_attempted_invalid_combo:
                    taxonomy_fallback = True

            if not core_missing and tax_resolved:
                new_state = "AWAITING_POLICY_DETAILS"
            else:
                new_state = "AWAITING_MISSING_DETAILS"

            pending_choice = _fallback_pending_choice(fields) if taxonomy_fallback else None

            set_fields = _touch({
                "fields": fields,
                "raw_messages": current.get("raw_messages", []) + [_raw_entry("text", text=text)],
                "missing_fields": core_missing, "invalid_fields": errors,
                "pending_choice": pending_choice, "taxonomy_fallback": taxonomy_fallback,
                "state": new_state,
            })
            if ai_meta_update:
                set_fields["ai_meta"] = ai_meta_update
                set_fields["ai_call_count"] = current.get("ai_call_count", 0) + 1

            updated = await _atomic_merge_update(current["id"], current["version"], set_fields)
            if updated is not None:
                n_images = len(updated.get("image_hosted_urls") or [])
                reply = _build_collection_reply(new_state, fields, core_missing, taxonomy_fallback, n_images)
                return updated, reply

            fresh = await drafts.find_one({"id": current["id"]}, {"_id": 0})
            if fresh is None or fresh["state"] in TERMINAL_STATES:
                return current, "Your conversation state just changed — please resend your last message."
            current = fresh  # re-evaluate everything, including whether AI is still needed, from scratch

        log.warning("[whatsapp] gave up merging draft %s after %d version conflicts", draft["id"], MERGE_RETRY_ATTEMPTS)
        return current, "We're processing another message from you right now — please resend your last message in a moment."

    async def _process_policy_message(draft: dict, text: str) -> tuple[dict, str]:
        current = draft
        for _ in range(MERGE_RETRY_ATTEMPTS):
            fields = dict(current.get("fields", {}))
            still_missing = [f for f in POLICY_FIELDS if fields.get(f) is None and not (f == "return_window_hours" and not fields.get("returnable"))]
            answered = parse_policy_answer(text, still_missing)
            fields.update(answered)

            # Return Window is only meaningful when Returnable=Yes — force
            # it to None otherwise, regardless of what was in the combined
            # answer (e.g. "No, 0, No" would otherwise store an
            # out-of-range 0 and fail ProductCreate's own validator at
            # finalize time; caught safely by the existing rollback, but
            # better not to store a meaningless value in the first place).
            if fields.get("returnable") is False:
                fields["return_window_hours"] = None
            remaining = [f for f in POLICY_FIELDS
                         if fields.get(f) is None and not (f == "return_window_hours" and fields.get("returnable") is False)]

            new_state = "AWAITING_CONFIRMATION" if not remaining else "AWAITING_POLICY_DETAILS"
            set_fields = _touch({
                "fields": fields,
                "raw_messages": current.get("raw_messages", []) + [_raw_entry("text", text=text)],
                "state": new_state,
            })
            updated = await _atomic_merge_update(current["id"], current["version"], set_fields)
            if updated is not None:
                if new_state == "AWAITING_CONFIRMATION":
                    n_images = len(updated.get("image_hosted_urls") or [])
                    return updated, format_confirmation_summary(fields, n_images)
                return updated, format_policy_prompt()

            fresh = await drafts.find_one({"id": current["id"]}, {"_id": 0})
            if fresh is None or fresh["state"] in TERMINAL_STATES:
                return current, "Your conversation state just changed — please resend your last message."
            current = fresh

        return current, "We're processing another message from you right now — please resend in a moment."

    async def _process_correction(draft: dict, text: str) -> tuple[dict, str]:
        """Corrections during AWAITING_CONFIRMATION. Deterministic parse
        first (an explicit "Selling Price: 699" or "SP 699" is handled with
        zero AI cost, same as collection); only a genuinely natural-language
        correction ("Actually it's Girls Ethnic Wear") reaches AI, in
        "correct" merge mode (explicit intent to overwrite, not fill-only)."""
        current = draft
        for _ in range(MERGE_RETRY_ATTEMPTS):
            fields = dict(current.get("fields", {}))
            parsed = parse_any(text)

            ai_meta_update = None
            ai_result = None
            if parsed:
                fields, errors = merge_fields(fields, parsed)
            else:
                ai_result, ai_meta_update = await _run_ai_or_none(text, fields, current, "correction")
                errors = {}
                if ai_result is not None:
                    fields = merge_ai_fields(fields, ai_result, mode="correct")

            has_image = bool(current.get("image_hosted_urls"))
            core_missing = compute_core_missing(fields, has_image)
            tax_resolved = taxonomy_resolved(fields)
            new_state = "AWAITING_CONFIRMATION" if (not core_missing and tax_resolved) else "AWAITING_MISSING_DETAILS"

            taxonomy_fallback = current.get("taxonomy_fallback", False)
            if tax_resolved:
                taxonomy_fallback = False
            elif ai_meta_update and not ai_meta_update["last_success"]:
                taxonomy_fallback = True
            elif ai_meta_update and (ai_meta_update["last_confidence"] or 0) < 0.5:
                taxonomy_fallback = True
            elif (ai_result is not None and (ai_result.l1_id or ai_result.l2_id)
                  and not validate_taxonomy(ai_result.l1_id, ai_result.l2_id)):
                # Same "confidently wrong" case as the collection path —
                # AI succeeded but the l1/l2 pair it chose doesn't exist
                # together in the real taxonomy.
                taxonomy_fallback = True
            pending_choice = _fallback_pending_choice(fields) if (new_state != "AWAITING_CONFIRMATION" and taxonomy_fallback) else None

            set_fields = _touch({
                "fields": fields,
                "raw_messages": current.get("raw_messages", []) + [_raw_entry("text", text=text)],
                "missing_fields": core_missing, "invalid_fields": errors,
                "pending_choice": pending_choice, "taxonomy_fallback": taxonomy_fallback,
                "state": new_state,
            })
            if ai_meta_update:
                set_fields["ai_meta"] = ai_meta_update
                set_fields["ai_call_count"] = current.get("ai_call_count", 0) + 1

            updated = await _atomic_merge_update(current["id"], current["version"], set_fields)
            if updated is not None:
                n_images = len(updated.get("image_hosted_urls") or [])
                if new_state == "AWAITING_CONFIRMATION":
                    return updated, format_confirmation_summary(fields, n_images)
                if taxonomy_fallback:
                    return updated, format_taxonomy_fallback_prompt(fields)
                return updated, format_missing_prompt_natural(core_missing)

            fresh = await drafts.find_one({"id": current["id"]}, {"_id": 0})
            if fresh is None or fresh["state"] in TERMINAL_STATES:
                return current, "Your conversation state just changed — please resend your last message."
            current = fresh

        return current, "We're processing another message from you right now — please resend in a moment."

    async def _recompute_after_image(draft: dict) -> tuple[dict, str]:
        """After a captionless image is appended, re-derive state/missing
        fields for the new image count only — no parsing, no AI decision,
        no raw_messages entry (the image itself was already logged by the
        caller). Only meaningful in the collection states; confirmation/
        policy just get a plain acknowledgement since core+taxonomy are
        already settled by the time those states are reached."""
        if draft["state"] not in ("AWAITING_PRODUCT_DETAILS", "AWAITING_MISSING_DETAILS"):
            if draft["state"] == "AWAITING_CONFIRMATION":
                n_images = len(draft.get("image_hosted_urls") or [])
                return draft, format_confirmation_summary(draft.get("fields", {}), n_images)
            return draft, "Got it — photo added."

        current = draft
        for _ in range(MERGE_RETRY_ATTEMPTS):
            fields = current.get("fields", {})
            has_image = bool(current.get("image_hosted_urls"))
            core_missing = compute_core_missing(fields, has_image)
            tax_resolved = taxonomy_resolved(fields)
            new_state = "AWAITING_POLICY_DETAILS" if (not core_missing and tax_resolved) else "AWAITING_MISSING_DETAILS"

            updated = await _atomic_merge_update(current["id"], current["version"],
                                                  _touch({"missing_fields": core_missing, "state": new_state}))
            if updated is not None:
                n_images = len(updated.get("image_hosted_urls") or [])
                return updated, _build_collection_reply(new_state, fields, core_missing, current.get("taxonomy_fallback", False), n_images)
            fresh = await drafts.find_one({"id": current["id"]}, {"_id": 0})
            if fresh is None or fresh["state"] in TERMINAL_STATES:
                return current, "Got it — photo added."
            current = fresh
        return current, "Got it — photo added."

    async def _handle_image(draft: dict, merchant_id: str, image_url: str, caption: str) -> tuple[dict, str]:
        current_count = len(draft.get("image_hosted_urls") or [])
        if current_count >= MAX_IMAGES:
            reply = f"You've already sent the maximum of {MAX_IMAGES} photos for this product."
            if caption.strip():
                _, reply2 = await _route_text_by_state(draft, caption)
                reply = reply2
            return draft, reply

        try:
            uploaded = await cloudinary_service.upload_image_from_url(image_url, "product", merchant_id)
        except HTTPException as e:
            return draft, f"Couldn't process that photo ({e.detail}). Please try sending it again."

        current = draft
        for _ in range(MERGE_RETRY_ATTEMPTS):
            src = current.get("image_source_urls") or []
            hosted = current.get("image_hosted_urls") or []
            pids = current.get("image_public_ids") or []
            if len(hosted) >= MAX_IMAGES:
                return current, f"You've already sent the maximum of {MAX_IMAGES} photos for this product."
            set_fields = _touch({
                "image_source_urls": src + [image_url],
                "image_hosted_urls": hosted + [uploaded["image_url"]],
                "image_public_ids": pids + [uploaded["public_id"]],
                "raw_messages": current.get("raw_messages", []) + [_raw_entry("image", image_url=image_url, text=caption or None)],
                "state": current["state"],
            })
            updated = await _atomic_merge_update(current["id"], current["version"], set_fields)
            if updated is not None:
                current = updated
                break
            fresh = await drafts.find_one({"id": current["id"]}, {"_id": 0})
            if fresh is None or fresh["state"] in TERMINAL_STATES:
                return current, "Your conversation state just changed — please resend your photo."
            current = fresh
        else:
            return current, "We're processing another message from you right now — please resend your photo in a moment."

        if caption.strip():
            return await _route_text_by_state(current, caption)

        # No caption — just recompute completeness/state for the new image
        # count, without treating this as a text message (no AI decision,
        # no phantom empty raw_messages entry).
        return await _recompute_after_image(current)

    async def _route_text_by_state(draft: dict, text: str) -> tuple[dict, str]:
        if draft["state"] in ("AWAITING_PRODUCT_DETAILS", "AWAITING_MISSING_DETAILS"):
            return await _process_collection_message(draft, text)
        if draft["state"] == "AWAITING_POLICY_DETAILS":
            return await _process_policy_message(draft, text)
        if draft["state"] == "AWAITING_CONFIRMATION":
            return await _process_correction(draft, text)
        return draft, _UNRECOGNIZED_MESSAGE

    async def _finalize_product(draft: dict) -> str:
        """Atomically claims AWAITING_CONFIRMATION -> PRODUCT_CREATED, then
        everything up to a confirmed product_id runs inside ONE try/except
        — any failure anywhere in that path rolls the draft back to
        AWAITING_CONFIRMATION with last_error set. PRODUCT_CREATED is
        reachable ONLY via the single line right after
        create_product_for_merchant has already returned successfully."""
        claimed = await drafts.find_one_and_update(
            {"id": draft["id"], "state": "AWAITING_CONFIRMATION"},
            {"$set": {"state": "PRODUCT_CREATED", "is_active": False, "updated_at": datetime.now(timezone.utc)},
             "$inc": {"version": 1}},
        )
        if claimed is None:
            log.warning("[whatsapp] duplicate YES for draft %s ignored (already processed)", draft["id"])
            return ""

        try:
            fields = draft["fields"]
            l1_id = fields["l1_id"]
            l2_id = fields.get("l2_id") or ""
            gender = "unisex" if l1_id not in L2_BY_L1 else ""

            hosted = draft.get("image_hosted_urls") or []
            pids = draft.get("image_public_ids") or []
            if not hosted:
                raise HTTPException(400, "No product photo on file")

            brand_id = None
            if fields.get("brand_raw"):
                brand_id, _unmatched = await resolve_brand(draft["merchant_id"], "whatsapp", fields["brand_raw"])

            from server import ProductCreate  # deferred import — avoids the circular import at module load time
            payload = ProductCreate(
                name=fields["name"], price=fields["price"], mrp=fields.get("mrp"),
                l1_id=l1_id, l2_id=l2_id, gender=gender,
                description=fields.get("description") or "",
                sizes=fields.get("sizes") or [], stock=fields.get("stock"),
                image=hosted[0], image_public_id=pids[0],
                images=hosted, image_public_ids=pids,
                return_eligible=bool(fields.get("returnable")),
                return_window_hours=fields.get("return_window_hours") if fields.get("returnable") else None,
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

        ai_meta = draft.get("ai_meta") or {}
        try:
            await audit_service.log(
                event_type="whatsapp_product_created",
                actor="whatsapp",
                metadata={
                    "channel": "whatsapp", "merchant_id": draft["merchant_id"],
                    "store_id": draft["store_id"], "product_id": doc["id"],
                    "whatsapp_phone": draft["whatsapp_phone"], "price": doc.get("price"),
                    "ai_used": draft.get("ai_call_count", 0) > 0,
                    "ai_call_count": draft.get("ai_call_count", 0),
                    "final_taxonomy_confidence": ai_meta.get("last_confidence"),
                },
            )
        except Exception:
            log.exception("[whatsapp] audit log write failed for product %s (product was still created)", doc["id"])

        return f"✅ Product created: {doc['name']} at ₹{doc['price']}. It's now live on your store."

    @router.post("/inbound")
    @rate_limit("120/minute")
    async def gupshup_inbound(request: Request):
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

            if draft["state"] == "AWAITING_CONFIRMATION" and upper == "YES":
                reply = await _finalize_product(draft)
                if reply:
                    await _reply(provider, phone10, reply)
                return PlainTextResponse("", status_code=200)

            if msg_type == "image" and image_url:
                draft, reply = await _handle_image(draft, merchant_id, image_url, text_body)
            elif msg_type == "text":
                draft, reply = await _route_text_by_state(draft, text_body)
            else:
                reply = _UNRECOGNIZED_MESSAGE
            await _reply(provider, phone10, reply)
            return PlainTextResponse("", status_code=200)
        except Exception:
            log.exception("[whatsapp] unhandled error processing inbound message %s", message_id)
            return PlainTextResponse("", status_code=200)

    return router, ensure_indexes
