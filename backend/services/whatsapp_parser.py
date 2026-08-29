"""Deterministic structured-text parser + validator for the WhatsApp
merchant product-addition flow. Pure functions only — no DB, no I/O — so
the merge/validate logic is unit-testable without a running Mongo.

No AI, no fuzzy matching beyond case-insensitive exact name/slug lookup
against the REAL, existing L1_CATEGORIES/L2_BY_L1 tables (seed_data.py) —
category ids are never hardcoded or duplicated here.

Design (per the revised MVP spec): a merchant sends as many product fields
as they want in one structured message, in any order, over as many
messages as it takes. Each message is parsed, merged into whatever the
draft already has (never overwriting a field that isn't present in THIS
message), then re-validated. Only the fields still missing/invalid after
merging are asked for again.
"""
from __future__ import annotations

import re
from typing import Optional

from seed_data import L1_CATEGORIES, L2_BY_L1

# Canonical field name -> plain-English label used in bot prompts.
# The required-field list lives in ONE place only: compute_missing() below.
FIELD_LABELS = {
    "image": "a product photo",
    "name": "Product Name",
    "category": "Category",
    "product_type": "Product Type",
    "price": "Selling Price",
    "stock": "Stock (e.g. 'Stock per Size: 3;4;5' with matching 'Sizes: S;M;L', or just 'Stock per Size: 10' if it doesn't come in sizes)",
}

_KEY_ALIASES = {
    "product name": "name", "name": "name",
    "description": "description", "desc": "description",
    "category": "category",
    "product type": "product_type", "type": "product_type",
    "mrp": "mrp",
    "selling price": "price", "price": "price",
    "sizes": "sizes", "size": "sizes",
    "stock per size": "stock_per_size", "stock": "stock_per_size",
    "returnable": "returnable", "return eligible": "returnable",
    "return window": "return_window", "return window hours": "return_window",
    "try & buy": "try_and_buy", "try and buy": "try_and_buy", "try&buy": "try_and_buy",
    "brand": "brand",
}

_LINE_RE = re.compile(r"^\s*([A-Za-z][A-Za-z &]*?)\s*[:\-=]\s*(.+?)\s*$")


def parse_structured_text(text: str) -> dict:
    """Line-based `Key: Value` (also accepts `-`/`=` separators) parser.
    Unrecognized keys and unparseable lines are silently ignored — this is
    deliberately forgiving about formatting, matched by strict validation
    of whatever DOES get recognized. Last occurrence of a key wins if
    repeated in the same message."""
    out: dict = {}
    for line in (text or "").splitlines():
        m = _LINE_RE.match(line)
        if not m:
            continue
        key = m.group(1).strip().lower()
        canonical = _KEY_ALIASES.get(key)
        if not canonical:
            continue
        out[canonical] = m.group(2).strip()
    return out


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
# never searched globally, per the spec's explicit instruction.
# ============================================================================

def resolve_l1(raw: str) -> Optional[str]:
    raw_n = raw.strip().lower()
    for c in L1_CATEGORIES:
        if c["name"].strip().lower() == raw_n or c["slug"].strip().lower() == raw_n:
            return c["id"]
    return None


def l1_name(l1_id: str) -> str:
    for c in L1_CATEGORIES:
        if c["id"] == l1_id:
            return c["name"]
    return l1_id


def l2_options_for(l1_id: str) -> list[dict]:
    return sorted(L2_BY_L1.get(l1_id, []), key=lambda s: s.get("order", 0))


def resolve_l2(l1_id: str, raw: str) -> Optional[str]:
    raw_n = raw.strip().lower()
    for s in l2_options_for(l1_id):
        if s["name"].strip().lower() == raw_n or s["slug"].strip().lower() == raw_n:
            return s["id"]
    return None


def l2_name(l1_id: str, l2_id: str) -> str:
    for s in L2_BY_L1.get(l1_id, []):
        if s["id"] == l2_id:
            return s["name"]
    return l2_id


def format_l2_numbered_list(l1_id: str) -> str:
    opts = l2_options_for(l1_id)
    lines = [f"{i}. {o['name']}" for i, o in enumerate(opts, start=1)]
    return "\n".join(lines)


def format_l1_numbered_list() -> str:
    lines = [f"{i}. {c['name']}" for i, c in enumerate(L1_CATEGORIES, start=1)]
    return "\n".join(lines)


# ============================================================================
# Merge — applies one message's parsed fields onto the existing draft
# fields dict. Never clears a field this message didn't mention. Returns
# the updated fields dict and a dict of {field: error message} for
# anything this message supplied but couldn't be resolved.
# ============================================================================

def merge_fields(fields: dict, parsed: dict) -> tuple[dict, dict]:
    fields = dict(fields)  # shallow copy — caller persists the return value
    errors: dict = {}

    if "name" in parsed:
        fields["name"] = parsed["name"]
    if "description" in parsed:
        fields["description"] = parsed["description"]

    if "category" in parsed:
        l1_id = resolve_l1(parsed["category"])
        fields["category_raw"] = parsed["category"]
        if l1_id:
            fields["l1_id"] = l1_id
            # Changing category invalidates any product_type resolved
            # against the OLD category — re-resolve against the new one if
            # we already have a product_type_raw on file.
            if fields.get("product_type_raw"):
                l2_id = resolve_l2(l1_id, fields["product_type_raw"])
                if l2_id:
                    fields["l2_id"] = l2_id
                else:
                    fields.pop("l2_id", None)
        else:
            fields.pop("l1_id", None)
            fields.pop("l2_id", None)
            errors["category"] = (
                f"\"{parsed['category']}\" isn't a category we have. Valid categories:\n"
                f"{format_l1_numbered_list()}\nReply with the correct Category."
            )

    if "product_type" in parsed:
        fields["product_type_raw"] = parsed["product_type"]
        l1_id = fields.get("l1_id")
        if not l1_id:
            # Category not resolved yet — hold the raw value, re-resolve
            # once category is set (handled in the block above).
            fields.pop("l2_id", None)
        else:
            l2_id = resolve_l2(l1_id, parsed["product_type"])
            if l2_id:
                fields["l2_id"] = l2_id
            else:
                fields.pop("l2_id", None)
                errors["product_type"] = (
                    f"\"{parsed['product_type']}\" isn't a {l1_name(l1_id)} product type. "
                    f"Which {l1_name(l1_id)} product type is this?\n{format_l2_numbered_list(l1_id)}\n"
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
        fields.pop("stock", None)  # sizes changed — stock mapping needs recomputing

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
                    "Multiple Stock per Size values were given without a matching Sizes list. "
                    "Please resend Sizes (e.g. 'Sizes: S;M;L') to match."
                )
        elif stock_tokens and sizes_list:
            if len(stock_tokens) != len(sizes_list):
                errors["stock"] = (
                    f"Sizes ({len(sizes_list)}) and Stock per Size ({len(stock_tokens)}) counts don't match. "
                    f"Please resend Stock per Size with exactly {len(sizes_list)} values, one per size, in the same order."
                )
            else:
                qtys = [parse_int(t) for t in stock_tokens]
                if any(q is None or q < 0 for q in qtys):
                    errors["stock"] = "Stock per Size must be whole numbers (e.g. '3;4;5')."
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

    # Cross-field check — only meaningful once both are present, and only
    # re-checked when THIS message touched one of them (avoids re-flagging
    # an already-accepted combination on every unrelated later message).
    if ("mrp" in parsed or "price" in parsed) and fields.get("mrp") is not None and fields.get("price") is not None:
        if fields["price"] > fields["mrp"]:
            errors["price"] = (
                f"Selling Price ({fields['price']}) can't be more than MRP ({fields['mrp']}). "
                f"Please resend a corrected Selling Price or MRP."
            )

    return fields, errors


def compute_missing(fields: dict, has_image: bool) -> list[str]:
    """Which REQUIRED fields still block confirmation. `stock` covers the
    whole sizes+stock_per_size pair — see merge_fields."""
    missing = []
    if not has_image:
        missing.append("image")
    if not fields.get("name"):
        missing.append("name")
    if not fields.get("l1_id"):
        missing.append("category")
    elif not fields.get("l2_id"):
        missing.append("product_type")
    if fields.get("price") is None:
        missing.append("price")
    elif fields.get("mrp") is not None and fields["price"] > fields["mrp"]:
        missing.append("price")  # resolved but invalid combo — blocks confirmation same as absent
    if fields.get("stock") is None:
        missing.append("stock")
    return missing


def format_missing_prompt(missing: list[str], errors: dict, fields: dict) -> str:
    """Builds the reply asking only for what's still needed. `errors`
    (this message's validation failures) get their specific corrective
    text; anything else missing gets a plain one-line ask."""
    lines = []
    handled = set()
    for field, msg in errors.items():
        lines.append(msg)
        handled.add(field)
    plain_missing = [f for f in missing if f not in handled and f not in ("category", "product_type")]
    # category/product_type get their own detailed prompts below when
    # they're missing OUTRIGHT (not just invalid — invalid already handled above).
    if "category" in missing and "category" not in handled:
        lines.append(f"Which category is this?\n{format_l1_numbered_list()}")
    if "product_type" in missing and "product_type" not in handled and fields.get("l1_id"):
        l1_id = fields["l1_id"]
        lines.append(f"Which {l1_name(l1_id)} product type is this?\n{format_l2_numbered_list(l1_id)}\nReply with a number or the product type name.")
    if plain_missing:
        labels = [FIELD_LABELS.get(f, f) for f in plain_missing]
        lines.append("Please also send: " + "; ".join(labels))
    return "\n\n".join(lines) if lines else "Please send the remaining product details."


def format_confirmation_summary(fields: dict) -> str:
    l1_id = fields.get("l1_id")
    l2_id = fields.get("l2_id")
    parts = []
    stock_values = list((fields.get("stock") or {}).values())
    if stock_values and all(v == 0 for v in stock_values):
        # Matches the existing canonical behavior (server.py auto-pauses a
        # product whose total_stock hits 0) — not rejected here, just
        # surfaced so the merchant isn't surprised it's created paused.
        parts.append("⚠️ All stock quantities are 0 — the product will be created but immediately out of stock/paused until you update it.\n")
    parts += [
        "Please confirm this product:",
        f"Name: {fields.get('name', '')}",
    ]
    if fields.get("description"):
        parts.append(f"Description: {fields['description']}")
    parts.append(f"Category: {l1_name(l1_id) if l1_id else ''}")
    parts.append(f"Product Type: {l2_name(l1_id, l2_id) if l1_id and l2_id else ''}")
    if fields.get("mrp") is not None:
        parts.append(f"MRP: {fields['mrp']}")
    parts.append(f"Selling Price: {fields.get('price', '')}")
    stock = fields.get("stock") or {}
    if list(stock.keys()) == ["default"]:
        parts.append(f"Stock: {stock['default']}")
    else:
        parts.append("Stock per Size: " + ", ".join(f"{k}: {v}" for k, v in stock.items()))
    parts.append(f"Returnable: {'Yes' if fields.get('returnable') else 'No'}")
    if fields.get("returnable") and fields.get("return_window_hours"):
        parts.append(f"Return Window: {fields['return_window_hours']}h")
    parts.append(f"Try & Buy: {'Yes' if fields.get('try_and_buy') else 'No'}")
    if fields.get("brand_raw"):
        parts.append(f"Brand: {fields['brand_raw']}")
    parts.append("\nReply YES to create this product, CANCEL to discard, or RESTART to start over.")
    return "\n".join(parts)


def resolve_numbered_choice(pending: dict, raw: str) -> Optional[str]:
    """Resolves a bare-number reply against a previously-shown numbered
    list (currently only used for product_type/L2). Returns the resolved
    id, or None if out of range / not a number."""
    n = parse_int(raw.strip())
    if n is None:
        return None
    options = pending.get("options") or []
    if n < 1 or n > len(options):
        return None
    return options[n - 1]["id"]
