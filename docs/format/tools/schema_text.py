"""Schemas of the version 2 data of text: paragraphs, lists, notes, comments, suggestions, layout, views, and
named styles (spec 4.6, 5.4.2, 5.4.3, and 6.8 to 6.12)."""

from __future__ import annotations

import unicodedata

import format_v2 as v2
from schema_base import *  # noqa: F403

# Section 6.8 to 6.12.
BORDER_STYLES = (
    "single", "double", "dotted", "dashed", "thick", "triple", "thinThickSmallGap", "thickThinSmallGap", "wave",
    "doubleWave", "dashDotStroked", "threeDEmboss", "threeDEngrave", "inset", "outset",
)  # fmt: skip
SHADE_PATTERNS = (
    "clear", "solid", "horzStripe", "vertStripe", "reverseDiagStripe", "diagStripe", "horzCross", "diagCross",
    "thinHorzStripe", "thinVertStripe", "thinReverseDiagStripe", "thinDiagStripe", "thinHorzCross", "thinDiagCross",
)
SHADE_PATTERNS += tuple(f"pct{n}" for n in (5, 10, 12, 15, 20, 25, 30, 35, 37, 40, 45, 50, 55, 60, 62, 65, 70, 75))
SHADE_PATTERNS += tuple(f"pct{n}" for n in (80, 85, 87, 90, 95))
PT = points(-1584, 1584, "0.05")
PT_POS = points(0, 1584, "0.05")
SPACE = either(PT_POS, enum("auto"))
LINE = either(
    obj({"rule": enum("multiple"), "value": points(0.06, 132, "0.01")}, ("rule", "value")),
    obj({"rule": enum("exact", "atLeast"), "value": points(0.7, 1584, "0.05")}, ("rule", "value")),
)
SIDE = obj(
    {"style": enum(*BORDER_STYLES), "width": points(0.25, 6, "0.125"), "space": integer(0, 31), "color": ANY_COLOR}
)
TAB = obj(
    {
        "pos": PT_POS,
        "align": enum("start", "center", "end", "decimal", "bar", "clear"),
        "leader": enum("none", "dot", "hyphen", "underscore", "heavy", "middleDot"),
    },
    ("pos",),
)


def tabs(value, path):
    problems = array(TAB, 0, 64)(value, path)
    if not problems:
        spots = [t["pos"] for t in value]
        if spots != sorted(set(spots)):
            problems.append(f"{path}: stops not sorted by pos, each once")
    return problems


PARA_KEYS = {
    "align": enum("start", "center", "end", "justify", "distribute"),
    "indent": obj({"start": PT, "end": PT, "first": PT}),
    "before": SPACE,
    "after": SPACE,
    "contextual": BOOL,
    "line": LINE,
    "keepNext": BOOL,
    "keepLines": BOOL,
    "breakBefore": BOOL,
    "widows": BOOL,
    "tabs": tabs,
    "border": obj({side: SIDE for side in ("top", "bottom", "start", "end", "between")}),
    "shade": obj({"fill": ANY_COLOR, "pattern": enum(*SHADE_PATTERNS), "color": ANY_COLOR}),
    "dir": enum("rtl", "ltr"),
    "lang": LANG,
    "outline": integer(1, 9),
    "dropCap": obj(
        {"mode": enum("drop", "margin"), "lines": integer(1, 10), "distance": PT_POS},
        ("mode",),
    ),
    "list": obj({"id": ok(lambda v: isinstance(v, str) and is_short(v), "a list ID"), "restart": BOOL}),
    "hyphenate": BOOL,
}
PARAS = mapping(is_id, obj(PARA_KEYS), 100_000, "an element ID")
LIST_FORMATS = (
    "decimal", "decimalZero", "lowerLetter", "upperLetter", "lowerRoman", "upperRoman", "ordinal", "cardinalText",
    "ordinalText", "bullet", "none", "hebrew1", "hebrew2", "arabicAlpha", "arabicAbjad", "hindiNumbers", "thaiNumbers",
    "chineseCounting", "japaneseCounting", "koreanCounting",
)  # fmt: skip
LEVEL = obj(
    {
        "format": enum(*LIST_FORMATS),
        "text": text(0, 64),
        "start": integer(0, 32767),
        "indent": PT_POS,
        "hanging": PT_POS,
        "symbol": ok(lambda v: isinstance(v, str) and len(v) == 1 and unicodedata.category(v) != "Cc", "one code point"),
        "font": FONT,
        "align": enum("start", "center", "end"),
    }
)
LISTS = mapping(is_short, obj({"levels": array(LEVEL, 1, 9)}, ("levels",)), 256, "a list ID")
MD64 = utf8(65536)
NOTES = mapping(is_id, obj({"kind": enum("foot", "end"), "markdown": MD64}, ("markdown",)), 10_000, "an ID")
REPLY = obj({"author": text(1, 100), "time": WHEN, "markdown": MD64}, ("author", "time", "markdown"))
COMMENT = obj(
    {"author": text(1, 100), "time": WHEN, "markdown": MD64, "replies": array(REPLY, 0, 256), "resolved": BOOL},
    ("author", "time", "markdown"),
)
COMMENTS = mapping(is_id, COMMENT, 10_000, "an ID")


def suggestion(value, path):
    problems = obj(
        {"kind": enum("ins", "del", "fmt"), "author": text(1, 100), "time": WHEN, "before": MD64},
        ("kind", "author", "time"),
    )(value, path)
    if isinstance(value, dict) and ("before" in value) != (value.get("kind") == "fmt"):
        problems.append(f"{path}.before: present exactly when kind is fmt (R-SUG-1)")
    return problems


SUGGESTIONS = mapping(is_id, suggestion, 10_000, "an ID")
LAYOUT = obj({"columns": integer(1, 4), "gap": PT_POS, "rule": BOOL})
TEXT_DATA = {"paras": PARAS, "lists": LISTS, "notes": NOTES, "comments": COMMENTS, "suggestions": SUGGESTIONS}
TEXT_DATA["layout"] = LAYOUT

# Sections 5.4.2 and 5.4.3.
VIEW_TEXT = obj(
    {
        "defaultTab": points(1, 1584, "0.05"),
        "hyphenate": BOOL,
        "lineNumbers": obj(
            {"start": integer(1, 32767), "countBy": integer(1, 100), "restart": enum("page", "continuous")}
        ),
        "pageNumbers": obj(
            {
                "format": enum("decimal", "lowerRoman", "upperRoman", "lowerLetter", "upperLetter"),
                "start": integer(0, 32767),
            }
        ),
    }
)
BAND_PARTS = {"left": text(0, 200), "center": text(0, 200), "right": text(0, 200)}
BAND = obj({**BAND_PARTS, "firstPage": obj(BAND_PARTS)})
VIEW_PRINT = obj({"header": BAND, "footer": BAND})

# Section 4.6. The version 1 key `color` holds only the colors of version 1 (R-COL-1).
V1_COLOR = ok(lambda v: v2.color(v, "pen highlighter hex"), "a version 1 color (R-COL-1)")
STYLE_KEYS = {
    "font": either(text(1, 200), FONT),
    "size": points(1, 1000, "0.01"),
    "color": V1_COLOR,
    "textColor": ANY_COLOR,
    "spaceBefore": points(0, 1000, "0.01"),
    "spaceAfter": points(0, 1000, "0.01"),
    "lineHeight": points(0.5, 10, "0.01"),
    "type": enum("paragraph", "character"),
    "label": text(1, 60),
    "basedOn": STYLE_NAME,
    "next": STYLE_NAME,
    "order": integer(0, 9999),
    "hidden": BOOL,
    "sizePt": points(1, 1638, "0.5"),
    "weight": points(100, 900, "100"),
    "italic": BOOL,
    "underline": enum(*v2.UNDERLINES, "none"),
    "strike": enum("single", "double", "none"),
    "caps": enum("small", "all", "none"),
    "tracking": PT,
    "highlight": COLOR_OR_NONE,
    "list": obj({"id": ok(lambda v: isinstance(v, str) and is_short(v), "a list ID"), "level": integer(1, 9)}),
}
STYLE_KEYS.update({key: PARA_KEYS[key] for key in ("align", "indent", "before", "after", "line", "contextual")})
STYLE_KEYS.update({key: PARA_KEYS[key] for key in ("keepNext", "keepLines", "widows", "tabs", "border", "shade")})
STYLE_KEYS.update({key: PARA_KEYS[key] for key in ("outline", "dir", "lang")})
def style_order(names) -> list:
    """Section 4.1: the version 1 names in their order, then the other names in code point order."""
    first = [n for n in v2.STYLE_NAMES_V1 if n in names]
    return first + sorted(n for n in names if n not in v2.STYLE_NAMES_V1)


NOTEBOOK_STYLES = mapping(lambda name: isinstance(name, str), obj(STYLE_KEYS), 64, "a style name", style_order)
PAGE_STYLES = mapping(lambda name: isinstance(name, str), obj(STYLE_KEYS), 64, "a style name")
HEX = ok(lambda v: v2.color(v, "hex"), "#rrggbb")
THEME_FONT = ok(lambda v: v2.font_name(v, tokens=False), "a font name")
THEME = obj(
    {
        "fonts": obj({key: THEME_FONT for key in ("heading", "body", "mono")}),
        "colors": obj({key: HEX for key in v2.THEME_COLORS}),
    }
)
STYLES_CHANGED = mapping(lambda name: isinstance(name, str), WHEN, 64, "a style name")


def style_versions(styles: dict, path: str) -> list[str]:
    """R-STY-2: a writer that writes a version 2 key also writes the version 1 key that can hold the value."""
    problems = []
    for name, style in styles.items():
        pairs = [("sizePt", "size"), ("before", "spaceBefore"), ("after", "spaceAfter")]
        for new, old in pairs:
            value = style.get(new)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                expected = round(value * 4 / 3 + 1e-9, 2)
                if 0 <= expected <= 1000 and style.get(old) != expected:
                    problems.append(f"{path}.{name}.{old}: {expected}, the value of {new} in page units (R-STY-2)")
        text_color = style.get("textColor")
        if v2.color(text_color, "pen highlighter hex") and style.get("color") != text_color:
            problems.append(f"{path}.{name}.color: {text_color}, the value of textColor (R-STY-2)")
        if v2.color(text_color, "theme") and "color" in style:
            problems.append(f"{path}.{name}.color: left out beside a theme color in textColor (R-STY-2)")
        line = style.get("line")
        if isinstance(line, dict) and line.get("rule") == "multiple" and 0.5 <= line.get("value", 0) <= 10:
            if style.get("lineHeight") != line["value"]:
                problems.append(f"{path}.{name}.lineHeight: {line['value']} (R-STY-2)")
    return problems
