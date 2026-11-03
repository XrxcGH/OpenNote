"""Stamping (spec 15.2 and 15.6), and what a reader computes from spreadsheet data and named styles (spec 4.6
and 6.3)."""

from __future__ import annotations

import json
import re

from inline_read import read_inline, readable_text
from inline_tags import is_v1_mark

def needs_v2(content: list[dict]) -> bool:
    """Whether inline content holds a version 2 construct (R-STAMP-8, R-STAMP-9)."""
    for node in content:
        if "footnote" in node:
            return True
        if any(not is_v1_mark(mark) for mark in node.get("marks", [])):
            return True
    return False


def inline_containers(markdown: str) -> list[str]:
    """The inline text of each paragraph, heading, list item, and quote line, outside fenced code."""
    parts, fence, current = [], False, []
    for line in markdown.split("\n"):
        stripped = line.lstrip(" >")
        if stripped.startswith("```"):
            fence = not fence
            continue
        if fence:
            continue
        stripped = re.sub(r"^(#{1,6} |[-+] (\[[ x]\] )?|[0-9]{1,9}[.)] )", "", stripped.lstrip(" "))
        if not stripped:
            parts.append("\n".join(current))
            current = []
        else:
            current.append(stripped)
    parts.append("\n".join(current))
    return [part for part in parts if part]


def markdown_needs_v2(markdown: str) -> bool:
    return any(needs_v2(read_inline(part)) for part in inline_containers(markdown))


def is_formula(markdown: str) -> bool:
    """A formula cell (R-SHT-5): its readable text starts with `=`."""
    return readable_text(markdown).startswith("=")


def stamp(page: dict) -> dict:
    """The version keys a writer gives the page (R-VER-6, R-STAMP-1 to R-STAMP-13)."""
    current = page.get("formatVersion", 1)
    if isinstance(current, int) and current > 2:
        keep = {"formatVersion": current, "minReaderVersion": page.get("minReaderVersion", 1)}
        keep["minWriterVersion"] = page.get("minWriterVersion", current)
        return keep
    version = 2 if any(block_needs_v2(block) for block in page.get("blocks", [])) else 1
    return {"formatVersion": version, "minReaderVersion": 1, "minWriterVersion": version}


def block_needs_v2(block: dict) -> bool:
    kind_ = block.get("type")
    data = block.get("data") or {}
    if kind_ == "break":
        return True
    if kind_ not in ("text", "table"):
        return False
    if any(data.get(key) for key in ("notes", "comments", "suggestions")):
        return True
    if kind_ == "text":
        return markdown_needs_v2(data.get("markdown", ""))
    cells = [cell.get("markdown", "") for row in data.get("rows", []) for cell in (row.get("cells") or {}).values()]
    if any(markdown_needs_v2(md) for md in cells):
        return True
    return sheet_needs_v2(data.get("sheet"), cells)


def sheet_needs_v2(sheet: object, cells: list[str]) -> bool:
    """R-STAMP-12 and R-STAMP-13."""
    if not isinstance(sheet, dict):
        return False
    if any(sheet.get(key) for key in ("merges", "names", "validation", "conditional", "values")):
        return True
    return "v" in sheet and any(is_formula(md) for md in cells)


def read_permission(page: dict, reader: int) -> str:
    """What a reader of version `reader` does with a file (R-VER-4): edit, readOnly, or pageMd."""
    formats = page.get("formatVersion")
    if not isinstance(formats, int) or formats < 1:
        return "notOpenNote"
    readers = page.get("minReaderVersion", 1)
    writers = page.get("minWriterVersion", formats)
    if not (isinstance(writers, int) and readers <= writers <= formats):
        writers = formats
    if readers > reader:
        return "pageMd"
    if formats <= reader or (reader >= 2 and writers <= reader):
        return "edit"
    return "readOnly"


# Spec 6.3: style IDs and the fingerprint of cached values.
FNV_OFFSET = 0xCBF29CE484222325
FNV_PRIME = 0x100000001B3
BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def fnv1a64(data: bytes) -> int:
    h = FNV_OFFSET
    for byte in data:
        h = ((h ^ byte) * FNV_PRIME) & 0xFFFFFFFFFFFFFFFF
    return h


def compact_json(value: object) -> str:
    """Canonical JSON in compact form: keys in code point order at every level, no whitespace (R-SHT-6)."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def style_id(style: dict, taken: dict | None = None) -> str:
    """The ID a writer gives a style (R-SHT-6). `taken` maps IDs already in the table to their styles."""
    taken = taken or {}
    body = compact_json(style)
    n = 0
    while True:
        h = fnv1a64((body if n == 0 else f"{body}#{n}").encode("utf-8")) % 36**6
        digits = ""
        for _ in range(6):
            h, r = divmod(h, 36)
            digits = BASE36[r] + digits
        if digits not in taken or taken[digits] == style:
            return digits
        n += 1


def fingerprint(data: dict) -> str:
    """`valuesOf` of a table block's data (R-SHT-18)."""
    columns = [c["id"] for c in data.get("columns", [])]
    rows = []
    for row in data.get("rows", []):
        cells = row.get("cells") or {}
        rows.append([row["id"], [(cells.get(c) or {}).get("markdown", "") for c in columns]])
    doc = [bool(data.get("header", False)), columns, rows, data.get("smart")]
    return "fnv1a:%016x" % fnv1a64(compact_json(doc).encode("utf-8"))


def formula_cells(data: dict) -> list[list[str]]:
    """The formula cells of a table block (R-SHT-5), as [row ID, column ID] in table order."""
    columns = [c["id"] for c in data.get("columns", [])]
    found = []
    for row in data.get("rows", []):
        cells = row.get("cells") or {}
        found += [[row["id"], c] for c in columns if c in cells and is_formula(cells[c].get("markdown", ""))]
    return found


def orphans(data: dict) -> list[str]:
    """Entries of `data.sheet` that name a row or column the table no longer has (R-SHT-2), as paths."""
    sheet = data.get("sheet") or {}
    rows = {r["id"] for r in data.get("rows", [])}
    cols = {c["id"] for c in data.get("columns", [])}
    found = [f"cols.{c}" for c in sheet.get("cols", {}) if c not in cols]
    found += [f"rows.{r}" for r in sheet.get("rows", {}) if r not in rows]
    for key in ("cells", "notes", "values"):
        for r, by_col in sheet.get(key, {}).items():
            if r not in rows:
                found.append(f"{key}.{r}")
            else:
                found += [f"{key}.{r}.{c}" for c in by_col if c not in cols]
    return found


def active_merges(data: dict) -> list[str]:
    """The merges a reader uses (R-SHT-12): valid, larger than one cell, and not overlapping a lower ID."""
    sheet = data.get("sheet") or {}
    rows = {r["id"]: i for i, r in enumerate(data.get("rows", []))}
    cols = {c["id"]: i for i, c in enumerate(data.get("columns", []))}
    used: list[tuple[int, int, int, int]] = []
    active = []
    for merge_id in sorted(sheet.get("merges", {})):
        merge = sheet["merges"][merge_id]
        try:
            (r1, c1), (r2, c2) = merge["from"], merge["to"]
            box = (min(rows[r1], rows[r2]), max(rows[r1], rows[r2]), min(cols[c1], cols[c2]), max(cols[c1], cols[c2]))
        except (KeyError, TypeError, ValueError):
            continue
        if box[0] == box[1] and box[2] == box[3]:
            continue
        if any(not (box[1] < u[0] or u[1] < box[0] or box[3] < u[2] or u[3] < box[2]) for u in used):
            continue
        used.append(box)
        active.append(merge_id)
    return active


def values_fresh(data: dict) -> bool:
    """Whether `values` may be used as current results (R-SHT-18)."""
    sheet = data.get("sheet") or {}
    return "valuesOf" in sheet and sheet["valuesOf"] == fingerprint(data)


def style_chain(styles: dict, name: str) -> list[str]:
    """A style and the styles it is based on, toward the root (R-STY-4)."""
    chain, seen = [], set()
    while name in styles and name not in seen and len(chain) <= 16:
        chain.append(name)
        seen.add(name)
        style = styles[name]
        parent = style.get("basedOn")
        if parent is None and name != "normal" and style.get("type", "paragraph") == "paragraph":
            parent = "normal"
        if parent in styles and styles[parent].get("type", "paragraph") != style.get("type", "paragraph"):
            break
        name = parent
    return chain


def merge_styles(a: dict, b: dict) -> dict:
    """Two copies of a notebook's `styles` and `stylesChanged`, merged style by style (R-STY-9)."""
    styles_a, styles_b = a.get("styles", {}), b.get("styles", {})
    times_a, times_b = a.get("stylesChanged", {}), b.get("stylesChanged", {})
    styles, times = {}, {}
    for name in sorted(set(styles_a) | set(styles_b)):
        if name not in styles_b or (name in styles_a and styles_a[name] == styles_b[name]):
            styles[name] = styles_a[name]
        elif name not in styles_a:
            styles[name] = styles_b[name]
        else:
            ta, tb = times_a.get(name, ""), times_b.get(name, "")
            if ta != tb:
                styles[name] = styles_a[name] if ta > tb else styles_b[name]
            else:
                styles[name] = max(styles_a[name], styles_b[name], key=compact_json)
    for name in sorted(set(times_a) | set(times_b)):
        times[name] = max(times_a.get(name, ""), times_b.get(name, ""))
    return {"styles": styles, "stylesChanged": times}
