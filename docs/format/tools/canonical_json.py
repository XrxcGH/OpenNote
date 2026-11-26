"""The canonical JSON of spec 2.2, as a version 1 writer writes `page.json`.

It knows the key order of the version 1 objects of a page and treats every other key as unknown: unknown keys come
after the known ones, in code point order, and unknown objects have their keys in code point order at every level.
The tests use it to show that a version 1 writer writes a page with version 2 keys byte for byte (R-JSON-1).
"""

from __future__ import annotations

import json
import math

PAGE = ("formatVersion", "minReaderVersion", "minWriterVersion", "kind", "id", "title", "created", "modified", "tags")
PAGE += ("view", "blocks", "assets", "ink", "recordings", "encryption", "revision")
VIEW = ("layout", "mode", "paper", "background", "contentWidth", "readingOrder")
PAPER = ("size", "orientation", "width", "height", "margins")
BACKGROUND = ("pattern", "spacing", "color", "marginLine", "template")
BLOCK = ("id", "type", "order", "frame", "lock", "created", "modified", "data", "fallback")
FRAME = ("x", "y", "w", "h", "rotate")
FALLBACK = ("markdown", "image")
TEXT = ("markdown", "ids", "tags", "styles", "checked")
TABLE = ("header", "columns", "rows")
COLUMN = ("id", "width")
ROW = ("id", "cells")
CELL = ("markdown",)
REVISION = ("id", "parents", "ancestors", "savedAt", "device", "writer")
DEVICE = ("id", "label")


def number(value: float | int) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int) or (isinstance(value, float) and value.is_integer() and abs(value) < 2**53):
        return str(int(value))
    if not math.isfinite(value):
        raise ValueError("NaN and infinity are never valid")
    return repr(value)


def string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def scalar(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, (bool, int, float)):
        return number(value)
    return string(value)


def ordered(obj: dict, known: tuple) -> list[str]:
    first = [k for k in known if k in obj]
    return first + sorted(k for k in obj if k not in known)


def write(value, schema, indent: int = 0) -> str:
    """`schema` maps a key to (known keys of its value, schema of its children), or is None for unknown objects."""
    pad = "  " * (indent + 1)
    if isinstance(value, dict):
        if not value:
            return "{}"
        known, children = schema if schema else ((), {})
        keys = ordered(value, known)
        parts = []
        for k in keys:
            child = children.get(k) if children else None
            parts.append(f"{pad}{string(k)}: {write(value[k], child, indent + 1)}")
        return "{\n" + ",\n".join(parts) + "\n" + "  " * indent + "}"
    if isinstance(value, list):
        if not value:
            return "[]"
        if all(not isinstance(x, (dict, list)) for x in value):
            return "[" + ", ".join(scalar(x) for x in value) + "]"
        parts = [f"{pad}{write(x, schema, indent + 1)}" for x in value]
        return "[\n" + ",\n".join(parts) + "\n" + "  " * indent + "]"
    return scalar(value)


def block_schema(block: dict):
    data = {"text": (TEXT, {}), "table": (TABLE, {"columns": (COLUMN, {}), "rows": (ROW, {"cells": None})})}
    children = {"frame": (FRAME, {}), "fallback": (FALLBACK, {}), "data": data.get(block.get("type"))}
    return BLOCK, children


def write_page(page: dict) -> str:
    """A `page.json` as a version 1 writer writes it, with a final newline."""
    view = (VIEW, {"paper": (PAPER, {}), "background": (BACKGROUND, {})})
    revision = (REVISION, {"device": (DEVICE, {})})
    top = ordered(page, PAGE)
    pad = "  "
    parts = []
    for key in top:
        value = page[key]
        if key == "blocks" and value:
            items = [pad + pad + write(b, block_schema(b), 2) for b in value]
            text = "[\n" + ",\n".join(items) + "\n" + pad + "]"
        else:
            schema = {"view": view, "revision": revision}.get(key)
            text = write(value, schema, 1)
        parts.append(f"{pad}{string(key)}: {text}")
    return "{\n" + ",\n".join(parts) + "\n}\n"
