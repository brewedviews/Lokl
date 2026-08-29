"""OpenAI-backed structured extraction for the WhatsApp product-addition
flow — an ASSISTIVE FALLBACK, never the default parser.

`routes/whatsapp.py` always attempts deterministic parsing first
(`services/whatsapp_parser.py`'s strict + loose extractors) and only calls
into this module when deterministic parsing genuinely cannot resolve what's
needed: messy/unstructured natural language, or taxonomy classification
that has no explicit Category/Product Type given. That decision is made by
the caller — this module has no opinion on when it should run.

Hard rules enforced by this module's own design:
  - Text only. No image bytes/URLs are ever sent here — no vision model,
    no exceptions. Photos are stored and attached to the product directly;
    they never reach OpenAI.
  - Never touches Mongo, never calls _create_product_for_merchant. Pure
    function: text + context in, structured JSON out.
  - Always returns schema-validated JSON via OpenAI's structured-output
    mode — never freeform text the caller has to regex-parse.
  - The CALLER is responsible for re-validating every field (numeric
    sanity, taxonomy whitelist against seed_data.py) before trusting this
    output. This module's job is understanding, not correctness
    enforcement — "AI is for understanding and classification; the
    backend remains the source of truth" per the product spec.

Provider is isolated behind this one module specifically so a future
provider swap (a different vendor, a different SDK) never touches
routes/whatsapp.py or whatsapp_parser.py.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Optional

# OpenAI's own error responses echo back a partially-masked copy of
# whatever key was actually sent (confirmed live: an invalid key produced
# "Incorrect API key provided: sk-fake-**********************only" in the
# exception message) — low-severity on its own, but "never log the key"
# is explicit, so any api-key-shaped substring is scrubbed before an
# exception's message is ever logged or included in AIExtractionError.
_KEY_PATTERN = re.compile(r"sk-[A-Za-z0-9_\-]{4,}")


def _redact(msg: str) -> str:
    return _KEY_PATTERN.sub("sk-***REDACTED***", msg or "")

log = logging.getLogger("lokl.whatsapp.ai")

_MODEL = os.environ.get("OPENAI_WHATSAPP_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
_TIMEOUT_SECONDS = 8.0
_MAX_ATTEMPTS = 2  # one bounded retry on transient failure — same convention as
                    # cloudinary_service._UPLOAD_MAX_ATTEMPTS: never indefinite.

# Structured-output schema — OpenAI enforces this shape server-side, so the
# response is guaranteed valid JSON matching this contract or the API call
# itself fails (caught below), never a freeform string the caller must parse.
_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": ["string", "null"]},
        "description": {"type": ["string", "null"]},
        "mrp": {"type": ["number", "null"]},
        "price": {"type": ["number", "null"]},
        "brand": {"type": ["string", "null"]},
        "stock": {
            "type": "array",
            "description": "One entry per size mentioned. Empty array if the merchant gave no size/stock info.",
            "items": {
                "type": "object",
                "properties": {"size": {"type": "string"}, "qty": {"type": "integer"}},
                "required": ["size", "qty"],
                "additionalProperties": False,
            },
        },
        "l1_id": {"type": ["string", "null"], "description": "Must be one of the l1_id values supplied in the taxonomy, or null."},
        "l2_id": {"type": ["string", "null"], "description": "Must be one of the l2_id values under the chosen l1_id, or null."},
        "confidence": {"type": "number", "description": "0.0-1.0 confidence in the taxonomy classification specifically."},
        "unresolved": {
            "type": "array", "items": {"type": "string"},
            "description": "Names of fields you could not confidently determine from the given text.",
        },
    },
    "required": ["name", "description", "mrp", "price", "brand", "stock", "l1_id", "l2_id", "confidence", "unresolved"],
    "additionalProperties": False,
}


class AIExtractionError(Exception):
    """Raised on ANY failure — missing API key, timeout, API error,
    malformed/schema-invalid output. Callers MUST catch this and degrade
    safely: never let it become a webhook 500, never let it corrupt the
    draft, never treat a failure as a resolved field."""


@dataclass
class AIExtraction:
    name: Optional[str] = None
    description: Optional[str] = None
    mrp: Optional[float] = None
    price: Optional[float] = None
    brand: Optional[str] = None
    stock: dict = field(default_factory=dict)   # size -> qty
    l1_id: Optional[str] = None
    l2_id: Optional[str] = None
    confidence: float = 0.0
    unresolved: list = field(default_factory=list)
    model: str = _MODEL


def _client():
    # Deferred import: server.py must still boot even if the `openai`
    # package or key isn't present (matches ai_enhance.py's own precedent
    # of a late import so an optional AI feature can't break the whole app).
    from openai import AsyncOpenAI
    api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise AIExtractionError("OPENAI_API_KEY not configured")
    return AsyncOpenAI(api_key=api_key, timeout=_TIMEOUT_SECONDS)


def _system_prompt(taxonomy: list[dict]) -> str:
    lines = [
        "You extract structured product-listing data from a merchant's WhatsApp "
        "messages for an Indian fashion/lifestyle marketplace. Only use information "
        "the merchant actually stated or clearly implied — never invent facts, "
        "never guess a price or stock number that wasn't given.",
        "You MUST choose l1_id/l2_id ONLY from the exact taxonomy below, or return "
        "null for both if you are not reasonably confident. Never invent a category "
        "or id that is not listed here.",
        "Taxonomy (l1_id: l1_name -> l2_id=l2_name, ...):",
    ]
    for l1 in taxonomy:
        l2s = ", ".join(f'{o["l2_id"]}={o["l2_name"]}' for o in l1["l2_options"])
        lines.append(f'- {l1["l1_id"]}: {l1["l1_name"]} -> {l2s}')
    return "\n".join(lines)


async def extract(*, raw_text: str, current_fields: dict, taxonomy: list[dict],
                   merchant_context: Optional[dict] = None, reason: str = "") -> AIExtraction:
    """Text-only structured extraction/classification.

    `raw_text` should be just the merchant text relevant to whatever's
    unresolved — the CALLER decides what's worth sending (don't re-send
    already-confidently-structured content), not this function.
    `current_fields` lets the model avoid re-deriving what's already known
    and focus on what's actually missing/ambiguous.
    NEVER pass image URLs/bytes as part of any argument here."""
    user_payload = {
        "merchant_text": raw_text,
        "already_known_fields": current_fields,
        "merchant_context": merchant_context or {},
        "reason_for_call": reason,
    }
    last_err: Optional[Exception] = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            client = _client()
            resp = await client.chat.completions.create(
                model=_MODEL,
                messages=[
                    {"role": "system", "content": _system_prompt(taxonomy)},
                    {"role": "user", "content": json.dumps(user_payload)},
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": "product_extraction", "schema": _SCHEMA, "strict": True},
                },
                temperature=0,
            )
            raw = resp.choices[0].message.content
            data = json.loads(raw)
            stock = {str(s["size"]).strip(): int(s["qty"]) for s in (data.get("stock") or []) if s.get("size")}
            return AIExtraction(
                name=data.get("name"), description=data.get("description"),
                mrp=data.get("mrp"), price=data.get("price"), brand=data.get("brand"),
                stock=stock, l1_id=data.get("l1_id"), l2_id=data.get("l2_id"),
                confidence=float(data.get("confidence") or 0.0),
                unresolved=[str(x) for x in (data.get("unresolved") or [])],
            )
        except Exception as e:  # noqa: BLE001 — deliberately broad: any failure degrades the same way
            last_err = e
            log.warning("[whatsapp-ai] extraction attempt %d/%d failed (reason=%s): %s",
                        attempt, _MAX_ATTEMPTS, reason, _redact(str(e)))
    raise AIExtractionError(_redact(str(last_err)))
