"""Schemas of `data.sheet`, the spreadsheet data of tables (spec 6.3)."""

from __future__ import annotations

import re

import format_v2 as v2
from schema_base import *  # noqa: F403
from schema_text import *  # noqa: F403

# Section 6.3: data.sheet.
UNDER_CELL = enum(*v2.UNDERLINES, *v2.ACCOUNTING, "none")
FONT_OBJ = obj(
    {
        "family": FONT,
        "size": points(1, 1638, "0.5"),
        "weight": points(100, 900, "100"),
        "bold": BOOL,
        "italic": BOOL,
        "underline": UNDER_CELL,
        "strike": enum("single", "double", "none"),
        "color": ANY_COLOR,
        "script": enum("super", "sub", "none"),
    }
)
PATTERNS = (
    "solid", "gray125", "gray0625", "lightGray", "mediumGray", "darkGray", "darkHorizontal", "darkVertical",
    "darkDown", "darkUp", "darkGrid", "darkTrellis", "lightHorizontal", "lightVertical", "lightDown", "lightUp",
    "lightGrid", "lightTrellis",
)  # fmt: skip
STOP = obj({"at": points(0, 1, "0.0001"), "color": ANY_COLOR}, ("at", "color"))


def stops(value, path):
    problems = array(STOP, 2, 8)(value, path)
    if not problems and [s["at"] for s in value] != sorted(s["at"] for s in value):
        problems.append(f"{path}: stops in increasing order")
    return problems


FILL = either(
    COLOR_OR_NONE,
    obj({"pattern": enum(*PATTERNS), "color": ANY_COLOR, "back": ANY_COLOR}, ("pattern",)),
    obj({"gradient": obj({"angle": integer(0, 359), "stops": stops}, ("stops",))}, ("gradient",)),
)
CELL_BORDERS = (
    "thin", "medium", "thick", "hair", "dotted", "dashed", "mediumDashed", "dashDot", "mediumDashDot", "dashDotDot",
    "mediumDashDotDot", "slantDashDot", "double", "none",
)  # fmt: skip
CELL_SIDE = obj({"style": enum(*CELL_BORDERS), "color": ANY_COLOR, "width": points(0.25, 6, "0.125")}, ("style",))
PAD = obj({side: PT_POS for side in "trbl"})
ALIGN = obj(
    {
        "h": enum("general", "left", "center", "right", "fill", "justify", "centerAcross", "distributed"),
        "v": enum("top", "middle", "bottom", "justify", "distributed"),
        "wrap": enum("wrap", "overflow", "clip"),
        "shrink": BOOL,
        "rotate": either(integer(-90, 90), enum("stacked")),
        "indent": integer(0, 15),
        "dir": enum("context", "ltr", "rtl"),
    }
)
CELL_STYLE = obj(
    {
        "fmt": text(1, 255),
        "font": FONT_OBJ,
        "fill": FILL,
        "border": obj({side: CELL_SIDE for side in ("t", "r", "b", "l", "du", "dd")}),
        "align": ALIGN,
        "pad": PAD,
        "protect": obj({"locked": BOOL, "hideFormula": BOOL}),
    }
)
ELEMENTS = ("whole", "header", "total", "firstCol", "lastCol", "band1", "band2", "colBand1", "colBand2")


def is_name(key):
    return isinstance(key, str) and bool(NAME.fullmatch(key)) and not CELL_REF.fullmatch(key)


LOOK_NAME = ok(lambda v: isinstance(v, str) and bool(LOOK.fullmatch(v)), "a look name")
TABLE = obj(
    {
        "style": STYLE_REF,
        "look": either(LOOK_NAME, obj({e: STYLE_REF for e in ELEMENTS})),
        "band": obj({"rows": BOOL, "cols": BOOL}),
        "emphasis": obj({"firstCol": BOOL, "lastCol": BOOL, "totalRow": BOOL}),
        "freeze": obj({"rows": integer(0, 1_000_000), "cols": integer(0, 1_000_000)}),
        "pad": PAD,
        "grid": BOOL,
        "name": ok(is_name, "a name (R-SHT-13)"),
    }
)
COL = obj({"style": STYLE_REF, "hidden": BOOL, "level": integer(0, 7), "collapsed": BOOL})
ROW = obj(
    {
        "style": STYLE_REF,
        "height": points(1, 10000, "0.01"),
        "exact": BOOL,
        "hidden": BOOL,
        "level": integer(0, 7),
        "collapsed": BOOL,
    }
)
CORNER = ok(
    lambda v: isinstance(v, list) and len(v) == 2 and all(isinstance(x, str) and is_id(x) for x in v),
    "[row ID, column ID]",
)
MERGE = obj({"from": CORNER, "to": CORNER}, ("from", "to"))
NAMED = obj({"ref": text(1, 8192), "scope": enum("table", "page"), "comment": text(0, 255)}, ("ref",))
RANGE = either(
    obj({"col": ELEMENT_ID}, ("col",)),
    obj({"row": ELEMENT_ID}, ("row",)),
    obj({"from": CORNER, "to": CORNER}, ("from", "to")),
)
RANGES = array(RANGE, 1, 64)
OPS = ("between", "notBetween", "equal", "notEqual", "greater", "less", "greaterOrEqual", "lessOrEqual")
MESSAGE = obj({"title": text(0, 32), "text": text(0, 255)})
VALIDATION = obj(
    {
        "ranges": RANGES,
        "kind": enum("any", "whole", "decimal", "list", "date", "time", "textLength", "custom", "checkbox"),
        "op": enum(*OPS),
        "a": text(0, 8192),
        "b": text(0, 8192),
        "items": array(text(1, 255), 1, 1000),
        "source": text(1, 8192),
        "dropDown": BOOL,
        "checked": text(0, 255),
        "unchecked": text(0, 255),
        "ignoreBlank": BOOL,
        "alert": enum("stop", "warning", "information"),
        "input": MESSAGE,
        "error": MESSAGE,
    },
    ("ranges",),
)
AT = ("min", "max", "num", "percent", "percentile", "formula")
SCALE_STOP = obj({"at": enum(*AT), "value": text(0, 8192), "color": ANY_COLOR}, ("at", "color"))
BAR_END = obj({"at": enum("auto", *AT), "value": text(0, 8192)}, ("at",))
THRESHOLD = obj(
    {"at": enum("num", "percent", "percentile", "formula"), "value": text(0, 8192), "gte": BOOL},
    ("at", "value"),
)
PERIODS = ("yesterday", "today", "tomorrow", "last7Days", "lastWeek", "thisWeek", "nextWeek", "lastMonth")
PERIODS += ("thisMonth", "nextMonth")
ICON_SETS = ("3Arrows", "3Triangles", "3TrafficLights", "3Signs", "3Symbols", "3Flags", "3Stars", "4Arrows")
ICON_SETS += ("4Rating", "5Arrows", "5Rating", "5Quarters", "5Boxes")
COMMON = {"ranges": RANGES, "order": integer(1, 256), "type": enum(""), "stop": BOOL, "style": STYLE_REF}
TYPES = {
    "cell": {"op": enum(*OPS), "a": text(0, 8192), "b": text(0, 8192)},
    "text": {"op": enum("contains", "notContains", "begins", "ends"), "text": text(1, 255)},
    "date": {"period": enum(*PERIODS)},
    "blank": {}, "noBlank": {}, "error": {}, "noError": {}, "duplicate": {}, "unique": {},
    "top": {"rank": integer(1, 1000), "percent": BOOL, "bottom": BOOL},
    "average": {"below": BOOL, "equal": BOOL, "stdDev": integer(0, 3)},
    "formula": {"a": text(1, 8192)},
    "scale": {"stops": array(SCALE_STOP, 2, 3)},
    "bar": {
        "color": ANY_COLOR, "gradient": BOOL, "border": ANY_COLOR, "min": BAR_END, "max": BAR_END,
        "negative": ANY_COLOR, "axis": enum("auto", "middle", "none"), "barOnly": BOOL,
    },
    "icons": {"set": enum(*ICON_SETS), "reverse": BOOL, "iconOnly": BOOL, "thresholds": array(THRESHOLD, 2, 4)},
}  # fmt: skip


def conditional(value, path):
    if not isinstance(value, dict) or value.get("type") not in TYPES:
        return [f"{path}.type: one of " + ", ".join(TYPES)]
    fields = {**COMMON, **TYPES[value["type"]], "type": enum(value["type"])}
    if value["type"] in ("scale", "bar", "icons"):
        del fields["style"]
    return obj(fields, ("ranges", "order", "type"))(value, path)


NOTE = obj({"markdown": MD64, "at": WHEN}, ("markdown", "at"))


def cached(value, path):
    if value is None or isinstance(value, bool):
        return []
    if isinstance(value, (int, float)):
        return [] if value == value and abs(value) != float("inf") else [f"{path}: a finite number"]
    if isinstance(value, str):
        return [] if len(value) <= 32767 else [f"{path}: at most 32,767 characters"]
    if isinstance(value, dict) and list(value) == ["e"] and isinstance(value["e"], str):
        return []
    return [f"{path}: a number, string, boolean, null, or {{\"e\": token}}"]


def by_cell(item, limit):
    return mapping(is_id, mapping(is_id, item, 100_000, "a column ID"), limit, "a row ID")


FINGERPRINT = re.compile(r"fnv1a:[0-9a-f]{16}")
SHEET_KEYS = {
    "v": integer(1, 2**31),
    "styles": mapping(lambda k: bool(STYLE_ID.fullmatch(k)), CELL_STYLE, 4096, "a style ID"),
    "table": TABLE,
    "cols": mapping(is_id, COL, 100_000, "a column ID"),
    "rows": mapping(is_id, ROW, 1_000_000, "a row ID"),
    "cells": by_cell(STYLE_REF, 1_000_000),
    "merges": mapping(is_short, MERGE, 10_000, "a merge ID"),
    "names": mapping(is_name, NAMED, 1024, "a name (R-SHT-13)"),
    "validation": mapping(is_short, VALIDATION, 256, "a rule ID"),
    "conditional": mapping(is_short, conditional, 256, "a rule ID"),
    "notes": by_cell(NOTE, 10_000),
    "values": by_cell(cached, 1_000_000),
    "valuesOf": ok(lambda v: isinstance(v, str) and bool(FINGERPRINT.fullmatch(v)), "fnv1a: and 16 hex digits"),
    "links": mapping(lambda k: isinstance(k, str) and 1 <= len(k) <= 1000, ELEMENT_ID, 1024, "a page title"),
}
SHEET = obj(SHEET_KEYS)


TOTALS = (("cells", 1_000_000, "cells"), ("notes", 10_000, "notes"), ("values", 1_000_000, "values"))


def over_limit(sheet: dict, path: str) -> list[str]:
    """The limits of section 16 count the entries of every row together, not the rows."""
    found = []
    for key, limit, what in TOTALS:
        rows = sheet.get(key)
        if isinstance(rows, dict) and all(isinstance(by_col, dict) for by_col in rows.values()):
            if sum(len(by_col) for by_col in rows.values()) > limit:
                found.append(f"{path}.{key}: at most {limit:,} {what} per table")
    return found


def sheet_problems(sheet: dict, path: str) -> list[str]:
    problems = SHEET(sheet, path)
    problems += over_limit(sheet, path)
    names = [n.lower() for n in sheet.get("names", {})]
    if len(names) != len(set(names)):
        problems.append(f"{path}.names: unique without regard to case (R-SHT-13)")
    for rule_id, rule in sheet.get("conditional", {}).items():
        if isinstance(rule, dict) and rule.get("type") == "icons" and "thresholds" in rule:
            icons = int(rule.get("set", "3")[0])
            if len(rule["thresholds"]) != icons - 1:
                problems.append(f"{path}.conditional.{rule_id}.thresholds: one fewer than the icons (R-SHT-15)")
    return problems
