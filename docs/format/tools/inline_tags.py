"""The reserved inline tag grammar of Markdown 2, the marks it names, and their nesting order (spec 7.9 and 7.10)."""

from __future__ import annotations

import re
import unicodedata

from values_v2 import (
    BOXES, EFFECTS, HEX, ID, OTF, PENS, UNDERLINES, V1_HIGHLIGHTS, V1_SIZES, color, font_name, lang,
    number_text, style_name, tokens,
)  # fmt: skip

# Spec 7.9: the reserved inline tag grammar.
NAMES = ("span", "u", "del", "mark", "ins", "s")
V1_SIMPLE = {"<u>": "u", "<sub>": "sub", "<sup>": "sup", "<em>": "em", "<strong>": "strong", "<del>": "del"}
V1_SIMPLE["<mark>"] = "mark"
V1_SIMPLE_MARKS = {"u": "underline", "sub": "sub", "sup": "sup", "em": "emphasis", "strong": "strong"}
V1_SIMPLE_MARKS.update({"del": "strike", "mark": "highlight"})
OPEN_TAG = re.compile(r"<(span|u|del|mark|ins|s)((?: (?:lang|dir|data-[a-z0-9-]{1,16})=\"[^\"<>&]{0,200}\")+)>")
ATTR = re.compile(r" (lang|dir|data-[a-z0-9-]{1,16})=\"([^\"]*)\"")
CLOSE_TAG = re.compile(r"</(span|u|del|mark|ins|s|sub|sup|em|strong)>")
MAX_ATTRS = 8
MAX_DEPTH = 32
# CommonMark raw HTML, so a tag that is not in the grammar is still read as one piece of literal text.
RAW_OPEN = re.compile(
    r"<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s\"'=<>`]+|'[^']*'|\"[^\"]*\"))?)*\s*/?>"
)
RAW_CLOSE = re.compile(r"</[A-Za-z][A-Za-z0-9-]*\s*>")


def is_control(c: str) -> bool:
    return unicodedata.category(c) == "Cc"


def parse_open_tag(raw: str) -> tuple[str, tuple] | None:
    """The tag name and attributes of an opening tag in the reserved grammar (R-INL-1 to R-INL-4), or None."""
    found = OPEN_TAG.fullmatch(raw)
    if not found or any(is_control(c) for c in raw):
        return None
    attrs = tuple(ATTR.findall(found.group(2)))
    names = [name for name, _ in attrs]
    if len(attrs) > MAX_ATTRS or any(a >= b for a, b in zip(names, names[1:])):
        return None
    return found.group(1), attrs


SPAN_ONE = {
    "data-font": ("font", lambda v: font_name(v)),
    "data-size": ("size", lambda v: v in V1_SIZES or number_text(v, 1, 1638, "0.5")),
    "data-weight": ("weight", lambda v: number_text(v, 100, 900, "100", (400, 700))),
    "data-caps": ("caps", lambda v: v in ("small", "all")),
    "data-tracking": ("tracking", lambda v: number_text(v, -1584, 1584, "0.05", (0,))),
    "data-scale": ("scale", lambda v: number_text(v, 1, 600, "1", (100,))),
    "data-shift": ("shift", lambda v: number_text(v, -1584, 1584, "0.5", (0,))),
    "data-kern": ("kern", lambda v: v == "0" or number_text(v, 1, 1638, "0.5")),
    "data-otf": ("otf", lambda v: tokens(v, OTF)),
    "data-effect": ("effect", lambda v: tokens(v, EFFECTS) and not ("emboss" in v and "engrave" in v)),
    "data-shade": ("shade", lambda v: color(v)),
    "data-color": ("color", lambda v: color(v)),
    "lang": ("lang", lang),
    "dir": ("dir", lambda v: v in ("rtl", "ltr")),
    "data-comment": ("comment", lambda v: bool(ID.fullmatch(v))),
    "data-ins": ("ins", lambda v: bool(ID.fullmatch(v))),
    "data-del": ("del", lambda v: bool(ID.fullmatch(v))),
    "data-fmt": ("fmt", lambda v: bool(ID.fullmatch(v))),
    "data-style": ("style", style_name),
    "data-float": ("float", lambda v: v in ("start", "end")),
}


def known_mark(name: str, attrs: tuple) -> object | None:
    """The mark of a tag in the grammar when it is one of the marks of spec 7.10 (R-INL-7), or None (foreign)."""
    keys = tuple(k for k, _ in attrs)
    values = dict(attrs)
    line, line_color = values.get("data-line"), values.get("data-line-color")
    if name == "u":
        if keys == ("data-line",) and line in UNDERLINES[1:]:
            return {"underline": {"line": line}}
        if keys == ("data-line", "data-line-color") and line in UNDERLINES[1:] and color(line_color):
            return {"underline": {"line": line, "color": line_color}}
        if keys == ("data-line-color",) and color(line_color):
            return {"underline": {"color": line_color}}
        return None
    if name == "del":
        return {"strike": "double"} if keys == ("data-line",) and line == "double" else None
    if name == "mark":
        value = values.get("data-color")
        return {"highlight": value} if keys == ("data-color",) and color(value) and value != "honey" else None
    if name != "span":
        return None
    box, box_color = values.get("data-box"), values.get("data-box-color")
    if keys == ("data-box",) and box in BOXES:
        return {"box": {"style": box}}
    if keys == ("data-box", "data-box-color") and box in BOXES and color(box_color):
        return {"box": {"style": box, "color": box_color}}
    if len(keys) == 1 and keys[0] in SPAN_ONE:
        kind, check = SPAN_ONE[keys[0]]
        return {kind: values[keys[0]]} if check(values[keys[0]]) else None
    return None


# Spec 7.10: the canonical nesting order, outermost first.
ORDER = [
    "float", "link", "comment", "ins", "del", "fmt", "dir", "lang", "style", "strong", "weight", "emphasis", "strike",
    "underline", "highlight", "shade", "color", "font", "size", "caps", "tracking", "scale", "shift", "kern", "otf",
    "effect", "box", "sub", "foreign", "code",
]  # fmt: skip
SHOWS_ON_SPACES = ("strike", "highlight", "shade", "box", "ins", "del", "foreign")


def kind(mark: object) -> str:
    return mark if isinstance(mark, str) else next(iter(mark))


def mark_key(mark: object) -> tuple:
    k = kind(mark)
    rank = ORDER.index("sub" if k == "sup" else k)
    second = mark[k] if k in ("comment", "foreign") else ""
    return rank, second


def sort_marks(marks: list) -> list:
    out: list = []
    for mark in sorted(marks, key=mark_key):
        if mark not in out:
            out.append(mark)
    return out


def shows_on_spaces(mark: object) -> bool:
    k = kind(mark)
    if k == "underline":
        return mark == "underline" or mark["underline"].get("line") != "words"
    return k in SHOWS_ON_SPACES


def is_v1_mark(mark: object) -> bool:
    """Whether a version 1 reader reads the mark (spec 7.3 and 7.4), so it does not raise the version."""
    if isinstance(mark, str):
        return True
    k, v = next(iter(mark.items()))
    return (
        k == "link"
        or (k == "highlight" and v in V1_HIGHLIGHTS)
        or (k == "color" and (v in PENS or bool(HEX.fullmatch(v))))
        or (k == "size" and v in V1_SIZES)
    )
