"""Deterministic structured-text parser + validator for the WhatsApp
merchant product-addition flow. Pure functions only — no DB, no I/O, no AI
— so the merge/validate logic is unit-testable without a running Mongo or
an OpenAI key.

Two deterministic extraction layers, both producing the SAME canonical
intermediate shape ({"name": "...", "mrp": "899", ...} — string values,
merged by merge_fields()) so callers never need to care which one fired:

  - parse_structured_text(): strict `Key: Value` lines (unchanged from the
    original template-based flow — kept for merchants who still use it).
  - parse_loose_fields(): regex-based recognition of common inline formats
    that don't use the strict line shape — "MRP 899 SP 399", "S=3 M=4 L=5",
    "S 3 M 4 L 5". This is a FORMAT convention (universal size
    abbreviations + a following number), not a product-keyword dictionary
    — it never tries to guess what a product IS, only how a merchant wrote
    a price/size/stock down.

Only when BOTH of these find nothing usable (or taxonomy remains
unresolved) does routes/whatsapp.py escalate to services/whatsapp_ai.py —
that decision lives in the route, not here. This module has no AI
dependency at all.

Category ids are validated ONLY against the real, existing
L1_CATEGORIES/L2_BY_L1 tables (seed_data.py) — never hardcoded/duplicated.
"""
from __future__ import annotations

import re
from typing import Optional

from seed_data import L1_CATEGORIES, L2_BY_L1

# Canonical field name -> plain-English label used in the SHORT natural
# missing-field prompt. Category/product_type are deliberately absent —
# taxonomy is resolved silently (deterministically or via AI) rather than
# ever being surfaced as something the merchant must fill in directly; the
# numbered-list prompts further down are shown ONLY as an explicit fallback
# when both deterministic resolution and AI classification fail.
_NATURAL_LABELS = {
    "image": "a product photo",
    "name": "the product name",
    "price": "the selling price",
    "stock": "the stock quantity",
}

_KEY_ALIASES = {
    "product name": "name", "name": "name",
    "description": "description", "desc": "description",
    "category": "category",
    "product type": "product_type", "type": "product_type",
    "mrp": "mrp",
    "selling price": "price", "price": "price", "sp": "price",
    "sizes": "sizes", "size": "sizes",
    "stock per size": "stock_per_size", "stock": "stock_per_size",
    "returnable": "returnable", "return eligible": "returnable",
    "return window": "return_window", "return window hours": "return_window",
    "try & buy": "try_and_buy", "try and buy": "try_and_buy", "try&buy": "try_and_buy",
    "brand": "brand",
}

_LINE_RE = re.compile(r"^\s*([A-Za-z][A-Za-z &]*?)\s*[:\-=]\s*(.+?)\s*$")

# _LINE_RE's value capture is greedy to end-of-line — correct when a message
# puts one field per line, but wrong when a merchant puts several fields on
# ONE comma/pipe-separated line, e.g. "Product name - Black Jeans, mrp 1099,
# sp 799, stock 4": without this, "name" would swallow the entire rest of
# the line. _truncate_free_text_value() cuts a free-text field's value at
# the first point that looks like another recognized field label, so the
# loose parser (which scans the whole original text independently) is free
# to pick up the mrp/price/stock that follows.
_TRUNCATE_LABELS_SORTED = sorted(_KEY_ALIASES.keys(), key=len, reverse=True)
_TRUNCATE_AT_NEXT_FIELD_RE = re.compile(
    r"[,;|]\s*(?:" + "|".join(re.escape(k) for k in _TRUNCATE_LABELS_SORTED) + r")\b",
    re.IGNORECASE,
)


def _truncate_free_text_value(value: str) -> str:
    m = _TRUNCATE_AT_NEXT_FIELD_RE.search(value)
    return value[:m.start()].strip() if m else value


def parse_structured_text(text: str) -> dict:
    """Line-based `Key: Value` (also accepts `-`/`=` separators) parser.
    Unrecognized keys and unparseable lines are silently ignored. Last
    occurrence of a key wins if repeated in the same message."""
    out: dict = {}
    for line in (text or "").splitlines():
        m = _LINE_RE.match(line)
        if not m:
            continue
        key = m.group(1).strip().lower()
        canonical = _KEY_ALIASES.get(key)
        if not canonical:
            continue
        value = m.group(2).strip()
        if canonical == "name":
            value = _truncate_free_text_value(value)
        out[canonical] = value
    return out


# ============================================================================
# Loose inline extraction — deterministic, regex-based, format-only (not a
# product-keyword dictionary). Produces the same canonical string-value
# shape as parse_structured_text() above.
# ============================================================================

_NUM_FRAGMENT = r"(\d+(?:,\d{3})*(?:\.\d+)?)"  # comma allowed only as a real thousands-group separator, never trailing punctuation
_LOOSE_MRP_RE = re.compile(rf"\bmrp\b\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*{_NUM_FRAGMENT}", re.IGNORECASE)
_LOOSE_SP_RE = re.compile(rf"\b(?:selling\s*price|sp)\b\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*{_NUM_FRAGMENT}", re.IGNORECASE)

# Standard, universal apparel size abbreviations ONLY — a format
# convention, never a taxonomy/keyword mapping. Numeric size domains
# (waist, shoe) are handled separately below via _NUMERIC_SIZE_STOCK_GROUP_RE
# (an explicit "SIZE-QTY" hyphenated-pair convention), since a bare numeric
# size mixed in with other numbers (price etc.) would otherwise be
# genuinely ambiguous without that explicit pairing.
_SIZE_TOKENS = ("XXXL", "XXL", "XL", "XXS", "XS", "S", "M", "L", "2XL", "3XL", "4XL")
_SIZE_ALT = "|".join(sorted(_SIZE_TOKENS, key=len, reverse=True))
# No trailing \b after the size token: "L4"/"S7" (no separator at all)
# would otherwise fail, since a letter immediately followed by a digit has
# no word boundary between them. The leading boundary is deliberately
# whitespace-or-start-of-string rather than a generic \b: a generic \b
# would (wrongly) match the "s" in "Levi's" (preceded by an apostrophe,
# a non-word character) as size token "S" if a number followed nearby —
# confirmed a real risk for product names containing numbers, e.g.
# "Levi's 511 Jeans". MRP/SP spans are already blanked out before this
# runs, so "SP 399" can't be misread as size "S" either way.
_LOOSE_SIZE_STOCK_RE = re.compile(rf"(?:^|(?<=\s))({_SIZE_ALT})\s*[:=\-]?\s*(\d+)", re.IGNORECASE)

# Bare "stock 4" / "Stock: 4" with no size breakdown at all — a single
# total, matching the existing {"default": n} single-bucket convention.
# Only consulted when no per-size breakdown was found (see below) — a real
# per-size split always takes precedence over a stray "stock" word.
_LOOSE_STOCK_RE = re.compile(rf"\bstock\b\s*[:\-]?\s*{_NUM_FRAGMENT}", re.IGNORECASE)

# Numeric waist/size-stock pairs — "stock 30-2, 32-4, 34-5" — for jeans/
# trousers/footwear where sizes are numeric (waist inches, shoe size)
# rather than S/M/L. A DIFFERENT format convention from the letter-size
# tokens above: each pair is explicitly "SIZE-QTY" (hyphen-joined), and the
# whole group must follow the literal "stock" label. MRP/SP are never
# written as "NUM-NUM" (they're extracted above under their own "mrp"/"sp"
# keywords and already blanked out by this point), so a hyphenated pair
# after "stock" is unambiguous and can't be confused with a price or a
# random number elsewhere in the product name. Tried BEFORE the letter-size
# regex and the bare-stock regex: a bare-stock match on "stock 30" alone
# (stopping at the hyphen, since _NUM_FRAGMENT doesn't include "-") would
# otherwise silently truncate this pattern and leak "-2, 32-4, 34-5" into
# the name remainder.
_NUMERIC_SIZE_STOCK_GROUP_RE = re.compile(
    r"\bstock\b\s*[:\-]?\s*((?:\d{1,3}\s*-\s*\d{1,4}\s*(?:[,;/]\s*)?)+)", re.IGNORECASE,
)
_NUMERIC_PAIR_RE = re.compile(r"(\d{1,3})\s*-\s*(\d{1,4})")


def parse_loose_fields_with_remainder(text: str) -> tuple[dict, str]:
    """Regex-based extraction for inline formats like "MRP 899 SP 399",
    "S=3 M=4 L=5", "S 3 M 4 L 5", "L4 S7". Each recognized span is blanked
    out of the working buffer before the next pattern runs, so e.g. the
    "399" in "SP 399" is never later mistaken for a stray stock number.
    Returns (fields, remainder) — `remainder` is whatever text is left
    after removing every matched span, e.g. "Pink tshirt" out of "Pink
    tshirt, M 2 L 4 S 7, mrp 899, SP 399". Callers use this to also try
    inferring a product name from clearly-leftover text even on an
    otherwise-messy single line, without needing AI for that part."""
    out: dict = {}
    working = text or ""

    m = _LOOSE_MRP_RE.search(working)
    if m:
        out["mrp"] = m.group(1)
        working = working[:m.start()] + (" " * (m.end() - m.start())) + working[m.end():]

    m = _LOOSE_SP_RE.search(working)
    if m:
        out["price"] = m.group(1)
        working = working[:m.start()] + (" " * (m.end() - m.start())) + working[m.end():]

    numeric_group_m = _NUMERIC_SIZE_STOCK_GROUP_RE.search(working)
    numeric_pairs = _NUMERIC_PAIR_RE.findall(numeric_group_m.group(1)) if numeric_group_m else []
    if numeric_pairs:
        sizes = {}
        for size, qty in numeric_pairs:
            sizes[size] = qty  # last occurrence wins on a repeated size
        out["sizes"] = ";".join(sizes.keys())
        out["stock_per_size"] = ";".join(sizes.values())
        working = (working[:numeric_group_m.start()]
                   + (" " * (numeric_group_m.end() - numeric_group_m.start()))
                   + working[numeric_group_m.end():])
    else:
        matches = list(_LOOSE_SIZE_STOCK_RE.finditer(working))
        if matches:
            sizes: dict = {}
            for mm in matches:
                sizes[mm.group(1).upper()] = mm.group(2)  # last occurrence wins on a repeated token
            out["sizes"] = ";".join(sizes.keys())
            out["stock_per_size"] = ";".join(sizes.values())
            for mm in reversed(matches):  # remove from the end so earlier spans' indices stay valid
                working = working[:mm.start()] + (" " * (mm.end() - mm.start())) + working[mm.end():]
        else:
            # No per-size breakdown found — check for a bare "stock 4" /
            # "Stock: 4" total instead. Previously unhandled by any
            # deterministic layer, forcing an AI call for something this
            # obviously structured.
            m = _LOOSE_STOCK_RE.search(working)
            if m:
                out["stock_per_size"] = m.group(1)
                working = working[:m.start()] + (" " * (m.end() - m.start())) + working[m.end():]

    remainder = re.sub(r"[\s,;:\-]+", " ", working).strip()
    # A leading label WORD (e.g. "stock" in "stock M2 L3 XL1") isn't part
    # of any matched span above — only the size+number pairs are consumed
    # — so it survives as a stranded word and would otherwise leak into a
    # name candidate as "... stock". Strip it as a final cleanup pass, only
    # when found as a standalone word (never part of legitimate leftover
    # text otherwise).
    if out:
        remainder = re.sub(r"\b(?:stock|sizes?)\b", "", remainder, flags=re.IGNORECASE)
        remainder = re.sub(r"\s+", " ", remainder).strip()
    return out, remainder


def parse_loose_fields(text: str) -> dict:
    fields, _ = parse_loose_fields_with_remainder(text)
    return fields


def parse_any(text: str) -> dict:
    """Combines both deterministic layers. Strict `Key: Value` lines take
    precedence over loose inline matches for the same field."""
    loose = parse_loose_fields(text)
    strict = parse_structured_text(text)
    return {**loose, **strict}


def infer_name_from_remainder(remainder: str, already_has_name: bool) -> Optional[str]:
    """Applied to whatever text is LEFT after loose MRP/SP/size-stock spans
    are stripped out — this is what lets "Pink tshirt, M 2 L 4 S 7, mrp
    899, SP 399" still get a deterministic name ("Pink tshirt") without
    needing AI for that part, matching the same plausibility checks as
    infer_name_from_single_line() below."""
    if already_has_name:
        return None
    r = (remainder or "").strip()
    if not (3 <= len(r) <= 60):
        return None
    if parse_number(r) is not None:
        return None
    if r.upper() in ("YES", "CANCEL", "RESTART"):
        return None
    return r


def infer_name_from_first_line(text: str, already_has_name: bool) -> Optional[str]:
    """The other common natural pattern — a bare name on the FIRST line,
    followed by explicit Key:Value lines, e.g. "Blue Bag\nSelling Price:
    299\nCategory: Accessories\n...". Only looks at line 1 specifically
    (never scans every line looking for a name), and only when that line
    doesn't itself look like a recognized Key:Value line or contain any
    loose MRP/price/size-stock pattern — genuinely multi-line messages
    only, single-line messages are handled by infer_name_from_single_line."""
    if already_has_name:
        return None
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    if len(lines) < 2:
        return None
    first = lines[0]
    if not (3 <= len(first) <= 60):
        return None
    if parse_number(first) is not None:
        return None
    if first.upper() in ("YES", "CANCEL", "RESTART"):
        return None
    if _LINE_RE.match(first):
        return None
    if _LOOSE_MRP_RE.search(first) or _LOOSE_SP_RE.search(first) or _LOOSE_SIZE_STOCK_RE.search(first):
        return None
    return first


def infer_name_from_single_line(text: str, already_has_name: bool, loose_matched: dict) -> Optional[str]:
    """A deterministic (not AI) heuristic for the common natural pattern of
    sending the product name as its own plain line/message — e.g. "Pink
    tshirt" or "Girls pink frock" sent alone. Only fires when: no name is
    set yet, the message is a single line, nothing else was recognized in
    it (if it also contains MRP/SP/size patterns, that's the messier
    single-line case like "Pink tshirt, M 2 L4 S7, mrp 899, SP 399" —
    genuinely mixed content that's correctly left for AI, not guessed at
    here), and the line is a plausible name length and not a bare number
    or a command word."""
    if already_has_name or loose_matched:
        return None
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    if len(lines) != 1:
        return None
    line = lines[0]
    if not (3 <= len(line) <= 60):
        return None
    if parse_number(line) is not None:
        return None
    if line.strip().upper() in ("YES", "CANCEL", "RESTART"):
        return None
    if _LINE_RE.match(line):  # looks like an unrecognized "Key: Value" line, not a name
        return None
    return line


def split_list(raw: str) -> list[str]:
    """Splits on ; , or / — the three separators the spec calls out."""
    parts = re.split(r"[;,/]", raw)
    return [p.strip() for p in parts if p.strip()]


def parse_bool(raw: str) -> Optional[bool]:
    v = raw.strip().lower()
    if v in ("yes", "y", "true", "1"):
        return True
    if v in ("no", "n", "false", "0"):
        return False
    return None


def parse_number(raw: str) -> Optional[float]:
    """Rejects negative input outright rather than silently stripping the
    sign — price/mrp/stock are never legitimately negative, and turning a
    typo'd "-100" into a valid-looking "100" would hide the mistake."""
    raw = raw.strip()
    if raw.startswith("-"):
        return None
    cleaned = re.sub(r"[^\d.]", "", raw)
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_int(raw: str) -> Optional[int]:
    n = parse_number(raw)
    if n is None:
        return None
    return int(n)


# ============================================================================
# Category resolution — matched ONLY against the real, existing seed_data
# tables. l2 is always resolved WITHIN the already-resolved l1's own list —
# never searched globally.
# ============================================================================

# Every function below that resolves/validates/lists categories accepts an
# OPTIONAL l1_categories/l2_by_l1 override, defaulting to the static
# seed_data lists (100% unchanged behavior for any caller that doesn't pass
# one — every existing test keeps working as-is). routes/whatsapp.py fetches
# the LIVE, paused-aware equivalent once per inbound message (mirroring
# server.py's own _active_l1_l2_ids()) and passes it through, so a category
# an admin has paused (e.g. the old Ethnic/Footwear/Lingerie/Accessories/
# Beauty/Sports L1s) can never be AI-classified into, confirmed, or typed in
# directly here — closing the gap where WhatsApp's own taxonomy checks used
# to trust the static list even after the real /categories endpoint (and
# _validate_l1_l2 at actual product-creation time) had already deactivated
# it, which is what previously let a merchant get all the way to "Invalid
# l1_id" at creation after WhatsApp had already shown a clean confirmation.

def resolve_l1(raw: str, l1_categories: Optional[list] = None) -> Optional[str]:
    l1_categories = L1_CATEGORIES if l1_categories is None else l1_categories
    raw_n = raw.strip().lower()
    for c in l1_categories:
        if c["name"].strip().lower() == raw_n or c["slug"].strip().lower() == raw_n:
            return c["id"]
    return None


def l1_name(l1_id: str, l1_categories: Optional[list] = None) -> str:
    l1_categories = L1_CATEGORIES if l1_categories is None else l1_categories
    for c in l1_categories:
        if c["id"] == l1_id:
            return c["name"]
    return l1_id


def l2_options_for(l1_id: str, l2_by_l1: Optional[dict] = None) -> list[dict]:
    l2_by_l1 = L2_BY_L1 if l2_by_l1 is None else l2_by_l1
    return sorted(l2_by_l1.get(l1_id, []), key=lambda s: s.get("order", 0))


def resolve_l2(l1_id: str, raw: str, l2_by_l1: Optional[dict] = None) -> Optional[str]:
    raw_n = raw.strip().lower()
    for s in l2_options_for(l1_id, l2_by_l1):
        if s["name"].strip().lower() == raw_n or s["slug"].strip().lower() == raw_n:
            return s["id"]
    return None


def l2_name(l1_id: str, l2_id: str, l2_by_l1: Optional[dict] = None) -> str:
    l2_by_l1 = L2_BY_L1 if l2_by_l1 is None else l2_by_l1
    for s in l2_by_l1.get(l1_id, []):
        if s["id"] == l2_id:
            return s["name"]
    return l2_id


# ============================================================================
# Deterministic taxonomy HINT resolution — a performance optimization, not
# a keyword dictionary. Two rules, both grounded directly in the real,
# existing taxonomy data (never a hardcoded product-type mapping table):
#
#   1. Gender words (men/mens/women/womens/...) map to the L1 category of
#      the SAME NAME — this is grammatical normalization of an L1 category
#      that already exists, not an invented association.
#   2. A category/product-type hint is accepted ONLY when a word from the
#      merchant's text is a literal substring of an EXISTING L2's own name
#      or slug (e.g. "hoodie" is a real substring of the real L2 name
#      "Sweaters & Hoodies") — never a guessed synonym.
#
# Returns a FULL (l1_id, l2_id) pair or None — deliberately all-or-nothing.
# A partial hint (gender known, category not) is not applied at all; AI
# remains the unchanged fallback for anything not this directly resolvable,
# exactly as before. This only ever SKIPS an AI call that would have had to
# happen anyway — it never weakens validate_taxonomy(), which still runs
# unconditionally wherever taxonomy is assigned.
# ============================================================================

_GENDER_WORD_TO_L1_NAME = {
    "men": "Men", "man": "Men", "mens": "Men",
    "women": "Women", "woman": "Women", "womens": "Women", "ladies": "Women",
    "boy": "Kids", "boys": "Kids", "girl": "Kids", "girls": "Kids",
    "kids": "Kids", "kid": "Kids", "baby": "Kids",
}


def resolve_gender_l1_hint(text: str, l1_categories: Optional[list] = None) -> Optional[str]:
    l1_categories = L1_CATEGORIES if l1_categories is None else l1_categories
    words = re.findall(r"[a-zA-Z]+", (text or "").lower())
    for w in words:
        target_name = _GENDER_WORD_TO_L1_NAME.get(w)
        if target_name:
            for c in l1_categories:
                if c["name"] == target_name:
                    return c["id"]
    return None


def resolve_category_l2_hint(text: str, l1_id: str, l2_by_l1: Optional[dict] = None) -> Optional[str]:
    words = re.findall(r"[a-zA-Z]+", (text or "").lower())
    for w in words:
        if len(w) < 3:
            continue  # avoid trivial short-word false positives ("in", "of", ...)
        for o in l2_options_for(l1_id, l2_by_l1):
            haystack = f"{o['name']} {o['slug']}".lower()
            if w in haystack:
                return o["id"]
    return None


def resolve_taxonomy_hint(text: str, l1_categories: Optional[list] = None,
                           l2_by_l1: Optional[dict] = None) -> Optional[tuple[str, str]]:
    """Full local resolution only — returns None if either half can't be
    confidently determined from the real taxonomy data, so the caller
    falls through to the existing AI escalation unchanged."""
    l1_id = resolve_gender_l1_hint(text, l1_categories)
    if not l1_id:
        return None
    l2_id = resolve_category_l2_hint(text, l1_id, l2_by_l1)
    if not l2_id:
        return None
    return l1_id, l2_id


# ============================================================================
# Bulk multi-product detection — a STRUCTURAL signal only, never an NLU
# judgment call. Requires EVERY non-blank line of the message to
# independently carry a full MRP + Selling Price + stock signature before
# treating the message as multiple products at all. A normal single-product
# multiline message (one field spread per line, e.g. "Product name: X\n
# Selling Price: 299\nCategory: ...") never matches — no single line there
# carries all three fields by itself — so it always falls through to the
# unchanged single-product path untouched. This is deliberately
# all-or-nothing/conservative per the product spec's explicit instruction
# not to guess at multi-product intent from weaker signals.
# ============================================================================

def detect_multi_product_lines(text: str) -> Optional[list[str]]:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    if len(lines) < 2:
        return None
    for ln in lines:
        loose, _ = parse_loose_fields_with_remainder(ln)
        if not (loose.get("mrp") and loose.get("price") and loose.get("stock_per_size")):
            return None
    return lines


def taxonomy_payload(l1_categories: Optional[list] = None, l2_by_l1: Optional[dict] = None) -> list[dict]:
    """The REAL, complete taxonomy in a compact shape for the AI prompt —
    the single source AI is ever given; it must choose from exactly this.
    Callers MUST pass the live, paused-aware taxonomy here in production —
    an AI never even offered a deactivated category can't classify into
    it."""
    l1_categories = L1_CATEGORIES if l1_categories is None else l1_categories
    return [
        {
            "l1_id": c["id"], "l1_name": c["name"],
            "l2_options": [{"l2_id": o["id"], "l2_name": o["name"]} for o in l2_options_for(c["id"], l2_by_l1)],
        }
        for c in l1_categories
    ]


def validate_taxonomy(l1_id: Optional[str], l2_id: Optional[str], l2_by_l1: Optional[dict] = None) -> bool:
    """Whitelist check — the ONLY thing standing between an AI-hallucinated
    (or deactivated) category and a corrupted product. Never trust AI
    taxonomy output without this. Pass the live, paused-aware l2_by_l1 in
    production so a category an admin has deactivated is never accepted as
    valid here, even though it's still structurally present in the static
    seed_data tables."""
    l2_by_l1 = L2_BY_L1 if l2_by_l1 is None else l2_by_l1
    if not l1_id or not l2_id or l1_id not in l2_by_l1:
        return False
    return any(o["id"] == l2_id for o in l2_by_l1[l1_id])


def format_l2_numbered_list(l1_id: str, l2_by_l1: Optional[dict] = None) -> str:
    opts = l2_options_for(l1_id, l2_by_l1)
    lines = [f"{i}. {o['name']}" for i, o in enumerate(opts, start=1)]
    return "\n".join(lines)


def format_l1_numbered_list(l1_categories: Optional[list] = None) -> str:
    l1_categories = L1_CATEGORIES if l1_categories is None else l1_categories
    lines = [f"{i}. {c['name']}" for i, c in enumerate(l1_categories, start=1)]
    return "\n".join(lines)


# ============================================================================
# Merge — applies one message's parsed fields onto the existing draft
# fields dict. Never clears a field this message didn't mention. Returns
# the updated fields dict and a dict of {field: error message} for
# anything this message supplied but couldn't be resolved.
# ============================================================================

def merge_fields(fields: dict, parsed: dict, l1_categories: Optional[list] = None,
                  l2_by_l1: Optional[dict] = None) -> tuple[dict, dict]:
    fields = dict(fields)  # shallow copy — caller persists the return value
    errors: dict = {}

    if "name" in parsed:
        fields["name"] = parsed["name"]
    if "description" in parsed:
        fields["description"] = parsed["description"]

    if "category" in parsed:
        l1_id = resolve_l1(parsed["category"], l1_categories)
        fields["category_raw"] = parsed["category"]
        if l1_id:
            fields["l1_id"] = l1_id
            if fields.get("product_type_raw"):
                l2_id = resolve_l2(l1_id, fields["product_type_raw"], l2_by_l1)
                if l2_id:
                    fields["l2_id"] = l2_id
                else:
                    fields.pop("l2_id", None)
        else:
            fields.pop("l1_id", None)
            fields.pop("l2_id", None)
            errors["category"] = (
                f"\"{parsed['category']}\" isn't a category we have. Valid categories:\n"
                f"{format_l1_numbered_list(l1_categories)}\nReply with the correct Category."
            )

    if "product_type" in parsed:
        fields["product_type_raw"] = parsed["product_type"]
        l1_id = fields.get("l1_id")
        if not l1_id:
            fields.pop("l2_id", None)
        else:
            l2_id = resolve_l2(l1_id, parsed["product_type"], l2_by_l1)
            if l2_id:
                fields["l2_id"] = l2_id
            else:
                fields.pop("l2_id", None)
                errors["product_type"] = (
                    f"\"{parsed['product_type']}\" isn't a {l1_name(l1_id, l1_categories)} product type. "
                    f"Which {l1_name(l1_id, l1_categories)} product type is this?\n{format_l2_numbered_list(l1_id, l2_by_l1)}\n"
                    f"Reply with a number or the product type name."
                )

    if "mrp" in parsed:
        n = parse_number(parsed["mrp"])
        if n is not None and n > 0:
            fields["mrp"] = n
        else:
            fields.pop("mrp", None)
            errors["mrp"] = f"\"{parsed['mrp']}\" isn't a valid MRP. Please resend MRP as a plain number (e.g. 999)."

    if "price" in parsed:
        n = parse_number(parsed["price"])
        if n is not None and n > 0:
            fields["price"] = n
        else:
            fields.pop("price", None)
            errors["price"] = f"\"{parsed['price']}\" isn't a valid Selling Price. Please resend as a plain number (e.g. 799)."

    if "sizes" in parsed:
        fields["sizes_list"] = split_list(parsed["sizes"])
        fields.pop("stock", None)

    if "stock_per_size" in parsed:
        fields["stock_tokens"] = split_list(parsed["stock_per_size"])
        fields.pop("stock", None)

    if "sizes" in parsed or "stock_per_size" in parsed:
        sizes_list = fields.get("sizes_list")
        stock_tokens = fields.get("stock_tokens")
        if stock_tokens and not sizes_list:
            if len(stock_tokens) == 1:
                qty = parse_int(stock_tokens[0])
                if qty is not None and qty >= 0:
                    fields["stock"] = {"default": qty}
                else:
                    errors["stock"] = f"\"{stock_tokens[0]}\" isn't a valid stock quantity."
            else:
                errors["stock"] = (
                    "Multiple stock values were given without matching sizes. "
                    "Please resend sizes to match (e.g. 'S;M;L')."
                )
        elif stock_tokens and sizes_list:
            if len(stock_tokens) != len(sizes_list):
                errors["stock"] = (
                    f"Sizes ({len(sizes_list)}) and stock values ({len(stock_tokens)}) counts don't match. "
                    f"Please resend stock with exactly {len(sizes_list)} values, one per size, in the same order."
                )
            else:
                qtys = [parse_int(t) for t in stock_tokens]
                if any(q is None or q < 0 for q in qtys):
                    errors["stock"] = "Stock values must be whole numbers (e.g. '3;4;5')."
                else:
                    fields["sizes"] = sizes_list
                    fields["stock"] = dict(zip(sizes_list, qtys))

    if "returnable" in parsed:
        b = parse_bool(parsed["returnable"])
        if b is None:
            errors["returnable"] = f"\"{parsed['returnable']}\" isn't Yes/No. Please resend Returnable as Yes or No."
        else:
            fields["returnable"] = b

    if "return_window" in parsed:
        n = parse_int(parsed["return_window"])
        if n is None or n < 1 or n > 24:
            errors["return_window"] = "Return Window must be a number of hours between 1 and 24."
        else:
            fields["return_window_hours"] = n

    if "try_and_buy" in parsed:
        b = parse_bool(parsed["try_and_buy"])
        if b is None:
            errors["try_and_buy"] = f"\"{parsed['try_and_buy']}\" isn't Yes/No. Please resend Try & Buy as Yes or No."
        else:
            fields["try_and_buy"] = b

    if "brand" in parsed:
        fields["brand_raw"] = parsed["brand"]

    if ("mrp" in parsed or "price" in parsed) and fields.get("mrp") is not None and fields.get("price") is not None:
        if fields["price"] > fields["mrp"]:
            errors["price"] = (
                f"Selling Price ({fields['price']}) can't be more than MRP ({fields['mrp']}). "
                f"Please resend a corrected Selling Price or MRP."
            )

    return fields, errors


def merge_ai_fields(fields: dict, ai, mode: str, l2_by_l1: Optional[dict] = None) -> dict:
    """Merges an AIExtraction into `fields`. Two modes:

    - "fill": used while COLLECTING core info. Only fills fields that are
      CURRENTLY unset — AI output must never blindly overwrite information
      the merchant (or deterministic parsing) already provided.
    - "correct": used when the merchant sends a natural-language
      CORRECTION at confirmation time — the merchant's explicit intent is
      to change something, so non-null AI fields are applied directly.

    Either way, taxonomy is ALWAYS re-validated against the real tables
    before being accepted — this is the one non-negotiable gate."""
    fields = dict(fields)
    overwrite = (mode == "correct")

    def _set(key, value):
        if value is None:
            return
        if overwrite or fields.get(key) is None:
            fields[key] = value

    _set("name", ai.name)
    _set("description", ai.description)
    if ai.mrp is not None and ai.mrp > 0:
        _set("mrp", ai.mrp)
    if ai.price is not None and ai.price > 0:
        _set("price", ai.price)
    _set("brand_raw", ai.brand)

    if ai.stock:
        if overwrite or fields.get("stock") is None:
            fields["sizes"] = list(ai.stock.keys())
            fields["stock"] = dict(ai.stock)

    if ai.l1_id and ai.l2_id and validate_taxonomy(ai.l1_id, ai.l2_id, l2_by_l1):
        if overwrite or not fields.get("l1_id"):
            fields["l1_id"] = ai.l1_id
            fields["l2_id"] = ai.l2_id

    if fields.get("mrp") is not None and fields.get("price") is not None and fields["price"] > fields["mrp"]:
        # A correction that creates an invalid combo — drop price so it's
        # asked for again rather than silently keeping an invalid product.
        fields.pop("price", None)

    return fields


def compute_core_missing(fields: dict, has_image: bool) -> list[str]:
    """Core fields the merchant is asked for DIRECTLY, in plain language.
    Taxonomy is deliberately NOT here — it's resolved silently
    (deterministically or via AI) and only surfaces to the merchant via
    the explicit numbered-list fallback when both fail."""
    missing = []
    if not has_image:
        missing.append("image")
    if not fields.get("name"):
        missing.append("name")
    if fields.get("price") is None:
        missing.append("price")
    elif fields.get("mrp") is not None and fields["price"] > fields["mrp"]:
        missing.append("price")
    if fields.get("stock") is None:
        missing.append("stock")
    return missing


def taxonomy_resolved(fields: dict, l2_by_l1: Optional[dict] = None) -> bool:
    return validate_taxonomy(fields.get("l1_id"), fields.get("l2_id"), l2_by_l1)


def format_missing_prompt_natural(missing: list[str]) -> str:
    labels = [_NATURAL_LABELS[f] for f in missing if f in _NATURAL_LABELS]
    if not labels:
        return "Send me a bit more about the product whenever you're ready."
    if len(labels) == 1:
        return f"Please send {labels[0]}."
    if len(labels) == 2:
        return f"Please send {labels[0]} and {labels[1]}."
    return "Please send: " + ", ".join(labels) + "."


def format_taxonomy_fallback_prompt(fields: dict, l1_categories: Optional[list] = None,
                                     l2_by_l1: Optional[dict] = None) -> str:
    """Shown ONLY when deterministic resolution AND AI classification have
    both failed/been low-confidence — never as the default path."""
    l1_id = fields.get("l1_id")
    if l1_id:
        return f"Which product type is this?\n{format_l2_numbered_list(l1_id, l2_by_l1)}\nReply with a number or the product type name."
    return f"Which category is this?\n{format_l1_numbered_list(l1_categories)}"


def resolve_numbered_choice(pending: dict, raw: str) -> Optional[str]:
    n = parse_int(raw.strip())
    if n is None:
        return None
    options = pending.get("options") or []
    if n < 1 or n > len(options):
        return None
    return options[n - 1]["id"]


# ============================================================================
# Policy questions (Returnable / Return Window / Try & Buy) — always
# deterministic, no AI. Handles a combined single-line answer
# ("Yes, 24 hours, No") as well as field-by-field answers across separate
# messages ("Returnable Yes", then "24", then "Try & Buy No").
# ============================================================================

_RETURNABLE_RE = re.compile(r"\breturnable\b\s*[:\-]?\s*(yes|no|y|n)\b", re.IGNORECASE)
_TRY_BUY_RE = re.compile(r"\btry\s*(?:&|and)?\s*buy\b\s*[:\-]?\s*(yes|no|y|n)\b", re.IGNORECASE)
_HOURS_RE = re.compile(r"\b(\d{1,3})\s*(?:hours?|hrs?|h)\b", re.IGNORECASE)
_BARE_YN_RE = re.compile(r"^\s*(yes|no|y|n)\s*$", re.IGNORECASE)
_BARE_NUM_RE = re.compile(r"^\s*(\d{1,3})\s*$")


def parse_policy_answer(text: str, still_missing: list[str]) -> dict:
    """Returns a dict subset of {"returnable": bool, "return_window_hours": int,
    "try_and_buy": bool} — only keys it could confidently determine.
    `still_missing` (e.g. ["returnable", "return_window_hours", "try_and_buy"])
    disambiguates a bare "24" or bare "Yes" answer to a single-field
    question versus part of a combined line."""
    text = text or ""
    out: dict = {}

    m = _RETURNABLE_RE.search(text)
    if m:
        out["returnable"] = parse_bool(m.group(1))
    m = _TRY_BUY_RE.search(text)
    if m:
        out["try_and_buy"] = parse_bool(m.group(1))
    m = _HOURS_RE.search(text)
    if m:
        out["return_window_hours"] = int(m.group(1))

    # Combined "Yes, 24 hours, No" form fills in whatever the keyword
    # regexes above didn't already find — NOT gated on `out` being empty,
    # since e.g. the hours regex alone matching shouldn't block returnable/
    # try_and_buy from also being picked up via the comma-split positions.
    parts = [p.strip() for p in re.split(r"[,\n]", text) if p.strip()]
    if len(parts) >= 3:
        if "returnable" not in out:
            m0 = _BARE_YN_RE.match(parts[0])
            if m0:
                out["returnable"] = parse_bool(m0.group(1))
        if "return_window_hours" not in out:
            d = re.search(r"\d+", parts[1])
            if d:
                out["return_window_hours"] = int(d.group(0))
        if "try_and_buy" not in out:
            m2 = _BARE_YN_RE.match(parts[2])
            if m2:
                out["try_and_buy"] = parse_bool(m2.group(1))
    elif len(parts) == 1 and not out:
            # A single bare token answering whichever ONE field is
            # currently outstanding — never guessed if more than one
            # field is still missing (genuinely ambiguous which it answers).
            token = parts[0]
            if len(still_missing) == 1:
                field = still_missing[0]
                if field == "return_window_hours":
                    nm = _BARE_NUM_RE.match(token)
                    if nm:
                        out["return_window_hours"] = int(nm.group(1))
                elif field in ("returnable", "try_and_buy"):
                    ynm = _BARE_YN_RE.match(token)
                    if ynm:
                        out[field] = parse_bool(ynm.group(1))
    return out


def format_policy_prompt() -> str:
    return (
        "Almost done! Please send:\n"
        "Returnable: Yes/No\n"
        "Return Window: hours\n"
        "Try & Buy: Yes/No\n\n"
        "(e.g. \"Yes, 24 hours, No\")"
    )


# ============================================================================
# Confirmation summary — no internal IDs ever shown.
# ============================================================================

def _format_inr(n) -> str:
    try:
        n = float(n)
    except (TypeError, ValueError):
        return str(n)
    if n == int(n):
        return f"₹{int(n):,}"
    return f"₹{n:,.2f}"


def format_confirmation_summary(fields: dict, n_images: int = 0) -> str:
    l1_id = fields.get("l1_id")
    l2_id = fields.get("l2_id")
    lines = []
    stock = fields.get("stock") or {}
    stock_values = list(stock.values())
    if stock_values and all(v == 0 for v in stock_values):
        lines.append("⚠️ All stock quantities are 0 — the product will be created but immediately out of stock/paused until you update it.\n")

    lines.append("Please confirm this product:\n")
    lines.append(fields.get("name", ""))
    if l1_id and l2_id:
        lines.append(f"{l2_name(l1_id, l2_id)} · {l1_name(l1_id)}")
    lines.append("")
    if fields.get("mrp") is not None:
        lines.append(f"MRP: {_format_inr(fields['mrp'])}")
    lines.append(f"Selling Price: {_format_inr(fields.get('price', 0))}")
    if stock:
        if len(stock) == 1:
            # A single stock entry is a plain total regardless of what key
            # it's stored under — deliberately NOT keyed on the literal
            # string "default": AI-filled stock (merge_ai_fields) isn't
            # guaranteed to use that exact placeholder, and showing
            # whatever key it DID pick (e.g. "null", "none") verbatim would
            # leak an internal placeholder to the merchant. One real size
            # explicitly given by the merchant would also just show as a
            # plain total here — an accepted, minor simplification.
            lines.append(f"Stock: {next(iter(stock.values()))}")
        else:
            lines.append("Sizes: " + ", ".join(f"{k} ({v})" for k, v in stock.items()))
    lines.append("")
    ret_line = "Returnable: Yes" if fields.get("returnable") else "Returnable: No"
    if fields.get("returnable") and fields.get("return_window_hours"):
        ret_line += f" · {fields['return_window_hours']} hours"
    lines.append(ret_line)
    lines.append(f"Try & Buy: {'Yes' if fields.get('try_and_buy') else 'No'}")
    if fields.get("brand_raw"):
        lines.append(f"Brand: {fields['brand_raw']}")
    if n_images:
        lines.append(f"Photos: {n_images}")
    lines.append("")
    lines.append("Reply YES to add it, or send any correction.")
    return "\n".join(lines)
