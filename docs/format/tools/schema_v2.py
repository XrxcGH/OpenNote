"""Checks the version 2 data of pages and notebooks against the types, ranges, and limits of the spec.

Each check returns a list of problems, each a path and what is wrong. The fixtures must have none, except where a
case says which problems a reader must find. Keys a schema does not list are reported too, so a fixture never holds
a key by mistake.
"""

from __future__ import annotations

import format_v2 as v2
from schema_base import obj, enum
from schema_sheet import SHEET_KEYS, sheet_problems  # noqa: F401
from schema_text import (
    NOTEBOOK_STYLES, PAGE_STYLES, STYLES_CHANGED, TEXT_DATA, THEME, VIEW_PRINT, VIEW_TEXT, style_versions,
)  # fmt: skip


def page_problems(page: dict) -> list[str]:
    """Every version 2 value of a page, checked against its schema."""
    problems = []
    view = page.get("view") or {}
    if "text" in view:
        problems += VIEW_TEXT(view["text"], "view.text")
    if "print" in view:
        problems += VIEW_PRINT(view["print"], "view.print")
    if "styles" in page:
        problems += PAGE_STYLES(page["styles"], "styles") + style_versions(page["styles"], "styles")
    if "theme" in page:
        problems += THEME(page["theme"], "theme")
    for i, block in enumerate(page.get("blocks", [])):
        data = block.get("data") or {}
        path = f"blocks[{i}].data"
        for key, schema in TEXT_DATA.items():
            if key in data and (block.get("type") == "text" or key in ("notes", "comments", "suggestions")):
                problems += schema(data[key], f"{path}.{key}")
        if block.get("type") == "table" and "sheet" in data:
            problems += sheet_problems(data["sheet"], f"{path}.sheet")
        if block.get("type") == "break":
            problems += obj({"kind": enum("page", "column")})(data, path)
            if block.get("fallback") != {"markdown": "---"}:
                problems.append(f"blocks[{i}].fallback: exactly {{\"markdown\": \"---\"}} (R-BRK-2)")
        if block.get("type") == "text":
            problems += mark_problems(data.get("markdown", ""), f"{path}.markdown")
    return problems


def notebook_problems(notebook: dict) -> list[str]:
    problems = []
    if "styles" in notebook:
        problems += NOTEBOOK_STYLES(notebook["styles"], "styles") + style_versions(notebook["styles"], "styles")
    if "theme" in notebook:
        problems += THEME(notebook["theme"], "theme")
    if "stylesChanged" in notebook:
        problems += STYLES_CHANGED(notebook["stylesChanged"], "stylesChanged")
    return problems


def mark_problems(markdown: str, path: str) -> list[str]:
    """Every known mark in the Markdown has a value its grammar accepts (it would be foreign otherwise)."""
    problems = []
    for part in v2.inline_containers(markdown):
        for node in v2.read_inline(part):
            for mark in node.get("marks", []):
                if not tree_mark_ok(mark):
                    problems.append(f"{path}: mark {mark!r} outside its grammar")
    return problems


def tree_mark_ok(mark) -> bool:
    """Whether a mark of a neutral tree holds values its grammar accepts (Appendix D, section 7.10)."""
    if isinstance(mark, str):
        return mark in ("strong", "emphasis", "strike", "underline", "highlight", "sub", "sup", "code")
    if not isinstance(mark, dict) or len(mark) != 1:
        return False
    k, v = next(iter(mark.items()))
    if k == "link":
        return isinstance(v, str)
    if k == "foreign":
        parsed = v2.parse_open_tag(v) if isinstance(v, str) else None
        return parsed is not None and v2.known_mark(*parsed) is None
    tag = v2.parse_open_tag(v2.open_tag(mark)) if isinstance(v, (str, dict)) else None
    try:
        return tag is not None and v2.known_mark(*tag) == mark
    except (KeyError, TypeError):
        return False
