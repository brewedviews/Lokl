"""xlsx template + parser for merchant bulk product upload.

The template uses Excel data-validation dropdowns so merchants can't fat-finger an L1
or L2 name — every cell is constrained to a known value. The Returnable column is also
a Yes/No dropdown. Sizes + stock are typed manually because they are per-product.
"""
from __future__ import annotations

import io
from typing import Iterable

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
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
    "name", "description",
    "l1", "l2", "gender",
    "mrp", "price",
    "sizes", "stock_per_size",
    "returnable",
]
# 10 example rows the merchant can replace.
EXAMPLES = [
    ["Indigo Block-Print Kurta", "Pure cotton hand-block",
     "Women", "Kurtas & Suits", "", 3499, 1899, "S;M;L;XL", "50;100;39;10", "Yes"],
    ["Oversized Tee", "240GSM oversized graphic tee",
     "Men", "T-Shirts", "", 1499, 899, "M;L;XL", "30;45;20", "Yes"],
    ["White Court Sneakers", "Classic low-top court sneakers",
     "Footwear", "Casual Shoes", "", 4999, 3499, "7;8;9;10", "8;12;10;6", "No"],
]


def _add_dropdown(ws, col_letter: str, options: list[str], first_row: int = 2, last_row: int = 200):
    formula = '"' + ",".join(options) + '"'
    dv = DataValidation(type="list", formula1=formula, allow_blank=True, showDropDown=False)
    dv.add(f"{col_letter}{first_row}:{col_letter}{last_row}")
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
    widths = [28, 30, 14, 22, 12, 10, 10, 22, 22, 12]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

    for r, row in enumerate(EXAMPLES, start=2):
        for c, val in enumerate(row, start=1):
            ws.cell(row=r, column=c, value=val)

    # Dropdowns
    _add_dropdown(ws, "C", L1_NAMES)
    _add_dropdown(ws, "D", ALL_L2_NAMES)
    _add_dropdown(ws, "E", GENDERS)
    _add_dropdown(ws, "J", YES_NO)

    # Instructions sheet
    info = wb.create_sheet("How to fill")
    info["A1"] = "Lokl bulk product upload — instructions"
    info["A1"].font = Font(bold=True, size=14)
    info_lines = [
        "",
        "• Fill one row per product on the 'Products' sheet.",
        "• Click into the l1 / l2 / gender / returnable cells — a DROPDOWN arrow appears on the right.",
        "  You cannot type custom categories: only listed values are accepted.",
        "• See the 'L1 → L2 reference' sheet for which sub-category belongs to which category.",
        "• For categories without sub-categories (Footwear, Streetwear, Kids, etc.) leave l2 blank.",
        "• sizes: semicolon-separated, e.g.  S;M;L;XL  or  7;8;9;10",
        "• stock_per_size: same length as sizes, e.g. 50;100;39;10 — quantity per size.",
        "• returnable: Yes / No. Defaults to No if blank. (Innerwear, perishables: keep No.)",
        "• mrp / price are in INR.",
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
            ref.cell(row=row, column=2, value="(no sub-category — leave l2 blank)").font = Font(italic=True, color="888888")
            row += 1
        else:
            for s in subs:
                ref.cell(row=row, column=1, value=c["name"])
                ref.cell(row=row, column=2, value=s["name"])
                row += 1

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def parse_uploaded_xlsx(data: bytes) -> list[dict]:
    """Parse the merchant's uploaded xlsx into row dicts using header names.
    Tolerates extra/blank columns and the 'How to fill' sheet.
    """
    wb = load_workbook(io.BytesIO(data), data_only=True)
    ws = wb["Products"] if "Products" in wb.sheetnames else wb.active
    headers: list[str] = []
    rows: list[dict] = []
    for row_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if row_idx == 1:
            headers = [str(h).strip().lower() if h is not None else "" for h in row]
            continue
        if not any(v not in (None, "") for v in row):
            continue
        d = {h: row[i] if i < len(row) else None for i, h in enumerate(headers) if h}
        rows.append(d)
    return rows
