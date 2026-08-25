"""xlsx template + parser for merchant bulk product upload.

The template uses Excel data-validation dropdowns so merchants can't fat-finger an L1
or L2 name — every cell is constrained to a known value. The Returnable column is also
a Yes/No dropdown. Sizes + stock are typed manually because they are per-product.
"""
from __future__ import annotations

import io
import re
from typing import Iterable

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation

from seed_data import L1_CATEGORIES, L2_BY_L1

L1_NAMES = [c["name"] for c in L1_CATEGORIES]
L1_NAME_TO_ID = {c["name"].lower(): c["id"] for c in L1_CATEGORIES}
L2_NAME_TO_ID: dict[tuple[str, str], str] = {}
for lid, subs in L2_BY_L1.items():
    for s in subs:
        L2_NAME_TO_ID[(lid, s["name"].lower())] = s["id"]
ALL_L2_NAMES = sorted({s["name"] for subs in L2_BY_L1.values() for s in subs})
GENDERS = ["women", "men", "unisex", "kids"]
YES_NO = ["Yes", "No"]

HEADERS = [
    "product name", "product description",
    "l1 category", "l2 category", "gender",
    "mrp", "selling price",
    "sizes", "stock_per_size",
    "returnable", "return window (hours)", "try & buy",
    "brand",
]
# 10 example rows the merchant can replace.
EXAMPLES = [
    ["Indigo Block-Print Kurta", "Pure cotton hand-block",
     "Women", "Kurtas & Suits", "", 3499, 1899, "S;M;L;XL", "50;100;39;10", "Yes", 24, "No"],
    ["Oversized Tee", "240GSM oversized graphic tee",
     "Men", "T-Shirts", "", 1499, 899, "M;L;XL", "30;45;20", "Yes", 24, "No"],
    ["White Court Sneakers", "Classic low-top court sneakers",
     "Footwear", "Casual Shoes", "", 4999, 3499, "7;8;9;10", "8;12;10;6", "No", "", "Yes"],
]


def _add_dropdown(ws, col_letter: str, options: list[str], first_row: int = 2, last_row: int = 200):
    formula = '"' + ",".join(options) + '"'
    dv = DataValidation(type="list", formula1=formula, allow_blank=True, showDropDown=False)
    dv.add(f"{col_letter}{first_row}:{col_letter}{last_row}")
    ws.add_data_validation(dv)


def _l1_range_name(l1_name: str) -> str:
    """Excel defined names can't contain spaces/most punctuation and can't
    start with a digit — sanitize the L1 display name into a stable,
    collision-free range name (e.g. "Lingerie & Innerwear" -> L2_Lingerie___Innerwear)."""
    cleaned = re.sub(r"[^A-Za-z0-9_]", "_", l1_name)
    if cleaned[:1].isdigit():
        cleaned = "_" + cleaned
    return f"L2_{cleaned}"


def _add_l2_dependent_dropdown(wb, ws, l1_col: str, l2_col: str, first_row: int = 2, last_row: int = 200):
    """Real Excel-native L1→L2 dependent dropdown (G12 P1-9) — replaces the
    old flat, unfiltered "every L2 in the whole taxonomy" list, which let a
    merchant pick e.g. "Sarees" under L1 "Men" with zero warning until the
    server silently skipped the row. Standard technique: one named range per
    L1 on a hidden helper sheet, L2 column validated via an INDIRECT formula
    keyed off that row's own L1 cell — so the visible dropdown itself only
    ever offers L2 values valid for whatever L1 the merchant already chose.
    """
    helper = wb.create_sheet("L2Lists")
    helper.sheet_state = "hidden"
    for col_idx, l1 in enumerate(L1_CATEGORIES, start=1):
        subs = L2_BY_L1.get(l1["id"], [])
        col_letter = get_column_letter(col_idx)
        helper.cell(row=1, column=col_idx, value=l1["name"])
        if not subs:
            # No L2s for this L1 — still define a (single blank-cell) named
            # range so INDIRECT resolves to something valid rather than a
            # #REF! error when the merchant opens the L2 dropdown for it.
            helper.cell(row=2, column=col_idx, value=None)
            ref = f"'L2Lists'!${col_letter}$2:${col_letter}$2"
        else:
            for i, s in enumerate(subs, start=2):
                helper.cell(row=i, column=col_idx, value=s["name"])
            ref = f"'L2Lists'!${col_letter}$2:${col_letter}${len(subs) + 1}"
        wb.defined_names[_l1_range_name(l1["name"])] = DefinedName(_l1_range_name(l1["name"]), attr_text=ref)

    # Excel formulas can't regex-replace arbitrary characters the way
    # `_l1_range_name` does in Python — this chains one SUBSTITUTE per
    # special character actually present in today's L1 names (space, &).
    # A future L1 name introducing a new punctuation character needs a
    # matching SUBSTITUTE added here to stay in sync with `_l1_range_name`.
    formula = f'INDIRECT("L2_"&SUBSTITUTE(SUBSTITUTE(${l1_col}{first_row}," ","_"),"&","_"))'
    dv = DataValidation(type="list", formula1=formula, allow_blank=True, showDropDown=False, showErrorMessage=False)
    dv.add(f"{l2_col}{first_row}:{l2_col}{last_row}")
    ws.add_data_validation(dv)


def build_template_xlsx() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Products"

    header_fill = PatternFill("solid", fgColor="1A2B4C")
    header_font = Font(bold=True, color="FFFFFF")
    for i, h in enumerate(HEADERS, start=1):
        c = ws.cell(row=1, column=i, value=h)
        c.fill = header_fill
        c.font = header_font
        c.alignment = Alignment(vertical="center")
    ws.row_dimensions[1].height = 26
    widths = [28, 30, 14, 22, 12, 10, 10, 22, 22, 12, 18, 12, 20]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

    for r, row in enumerate(EXAMPLES, start=2):
        for c, val in enumerate(row, start=1):
            ws.cell(row=r, column=c, value=val)

    # Dropdowns
    _add_dropdown(ws, "C", L1_NAMES)
    _add_l2_dependent_dropdown(wb, ws, l1_col="C", l2_col="D")
    _add_dropdown(ws, "E", GENDERS)
    _add_dropdown(ws, "J", YES_NO)
    _add_dropdown(ws, "L", YES_NO)

    # Instructions sheet
    info = wb.create_sheet("How to fill")
    info["A1"] = "Lokl bulk product upload — instructions"
    info["A1"].font = Font(bold=True, size=14)
    info_lines = [
        "",
        "• Fill one row per product on the 'Products' sheet.",
        "• Click into the l1 category cell first — a DROPDOWN arrow appears on the right.",
        "  Then click into l2 category: its dropdown automatically shows ONLY the sub-categories",
        "  valid for whatever l1 category you picked on that row. Pick l1 before l2, or the l2",
        "  dropdown will still be showing the previous row's options.",
        "  You cannot type custom categories: only listed values are accepted.",
        "• See the 'L1 → L2 reference' sheet for the full category tree at a glance.",
        "• sizes: comma or semicolon-separated, e.g.  S,M,L,XL  or  S;M;L;XL  or  7;8;9;10",
        "• stock_per_size: same count as sizes, e.g. 50,100,39,10 — quantity per size.",
        "• returnable: Yes / No. Defaults to No if blank. (Innerwear, perishables: keep No.)",
        "• return window (hours): only used when returnable is Yes. Whole number, 1-24. Defaults to 24 if blank.",
        "• try & buy: Yes / No — can the customer try this on at the door and only pay for what they keep?",
        "  Defaults to No if blank.",
        "• brand: optional. Matches an existing brand by name (case-insensitive) from Lokl's brand list.",
        "  Brands can't be created from this sheet — an unrecognized name is noted in the upload summary",
        "  and the product is still created, just without a brand tag. Check spelling or ask Lokl to add it.",
        "• mrp / price are in INR and must be positive numbers.",
        "• After upload, every row appears in Products as a draft — add images & tweak before go-live.",
    ]
    for i, line in enumerate(info_lines, start=2):
        info.cell(row=i, column=1, value=line)
    info.column_dimensions["A"].width = 100

    # L1 → L2 reference table — gives merchants the full category tree at a glance
    ref = wb.create_sheet("L1 → L2 reference")
    ref["A1"] = "Category (L1)"
    ref["B1"] = "Sub-category (L2)"
    for c in ("A1", "B1"):
        ref[c].font = header_font
        ref[c].fill = header_fill
        ref[c].alignment = Alignment(vertical="center")
    ref.row_dimensions[1].height = 24
    ref.column_dimensions["A"].width = 24
    ref.column_dimensions["B"].width = 38
    row = 2
    for c in L1_CATEGORIES:
        subs = L2_BY_L1.get(c["id"], [])
        if not subs:
            ref.cell(row=row, column=1, value=c["name"])
            ref.cell(row=row, column=2, value="(no sub-category — leave l2 category blank)").font = Font(italic=True, color="888888")
            row += 1
        else:
            for s in subs:
                ref.cell(row=row, column=1, value=c["name"])
                ref.cell(row=row, column=2, value=s["name"])
                row += 1

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


_HEADER_ALIAS = {
    "product name":        "name",
    "product_name":        "name",
    "l1 category":         "l1",
    "l1_category":         "l1",
    "l2 category":         "l2",
    "l2_category":         "l2",
    "l2 sub-category":     "l2",
    "selling price":       "price",
    "selling_price":       "price",
    "sale price":          "price",
    "stock per size":      "stock_per_size",
    "stock":               "stock_per_size",
    "product description": "description",
    "brand name":          "brand",
    "brand_name":          "brand",
    "return window (hours)": "return_window_hours",
    "return_window_hours":   "return_window_hours",
    "return window":         "return_window_hours",
    "try & buy":             "try_at_doorstep",
    "try and buy":           "try_at_doorstep",
    "try_at_doorstep":       "try_at_doorstep",
}


def parse_uploaded_xlsx(data: bytes) -> list[dict]:
    """Parse the merchant's uploaded xlsx into row dicts using header names.
    Tolerates extra/blank columns and the 'How to fill' sheet.
    Maps l1_category → l1 and l2_subcategory → l2 so _row_to_product in
    server.py can consume the output without modification.

    Each row dict carries `_row_num` — the real spreadsheet row number
    (1-indexed, matching what a merchant sees in Excel) — so server.py can
    produce row-specific error messages instead of a bare, unindexed reason
    (G12 P1-10/11).
    """
    wb = load_workbook(io.BytesIO(data), data_only=True)
    ws = wb["Products"] if "Products" in wb.sheetnames else wb.active
    headers: list[str] = []
    rows: list[dict] = []
    for row_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if row_idx == 1:
            raw = [str(h).strip().lower() if h is not None else "" for h in row]
            headers = [_HEADER_ALIAS.get(h, h) for h in raw]
            continue
        if not any(v not in (None, "") for v in row):
            continue
        d = {h: row[i] if i < len(row) else None for i, h in enumerate(headers) if h}
        d["_row_num"] = row_idx
        rows.append(d)
    return rows
