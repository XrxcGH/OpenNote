"""The value grammars of format version 2 that text marks, styles, and cell styles share (spec Appendix D)."""

from __future__ import annotations

import re
import unicodedata
from decimal import Decimal

# Appendix D: the shared value grammars.
PENS = ("ink", "indigo", "brick", "fern", "plum", "amber", "walnut")
HIGHLIGHTERS = ("honey", "mint", "rose", "apricot", "lilac")
THEME_COLORS = ("accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "text", "background")
THEME_FONTS = ("+body", "+heading", "+mono")
UNDERLINES = (
    "single", "double", "words", "thick", "dotted", "dottedHeavy", "dash", "dashedHeavy", "dashLong",
    "dashLongHeavy", "dotDash", "dashDotHeavy", "dotDotDash", "dashDotDotHeavy", "wave", "wavyHeavy", "wavyDouble",
)  # fmt: skip
ACCOUNTING = ("singleAccounting", "doubleAccounting")
OTF = ("clig-none", "dlig", "hlig", "liga-none", "lnum", "onum", "pnum", "tnum", "zero") + tuple(
    f"ss{n:02d}" for n in range(1, 21)
)
EFFECTS = ("emboss", "engrave", "outline", "shadow")
BOXES = ("single", "double", "dotted", "dashed", "thick")
V1_SIZES = ("small", "large", "xlarge")
V1_HIGHLIGHTS = ("mint", "rose", "apricot", "lilac")
STYLE_NAMES_V1 = ("normal", "h1", "h2", "h3", "h4", "h5", "h6", "title", "quote", "code")
STYLE_NAMES_V2 = ("subtitle", "citation", "h7", "h8", "h9", "quote2")

ID = re.compile(r"[0-7][0-9a-hjkmnp-tv-z]{25}")
HEX = re.compile(r"#[0-9a-f]{6}")
NUMBER = re.compile(r"-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?")
LANG = re.compile(r"[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?")
USER_STYLE = re.compile(r"u-[a-z0-9-]{1,32}")


def number_text(text: object, lo: float, hi: float, step: str, exclude: tuple = ()) -> bool:
    """A number written as text (R-VAL-1): shortest decimal form, in range, on the step, not an excluded value."""
    if not isinstance(text, str) or not NUMBER.fullmatch(text) or text == "-0":
        return False
    return number_value(Decimal(text), lo, hi, step, exclude)


def number_value(value: Decimal, lo: float, hi: float, step: str, exclude: tuple = ()) -> bool:
    if not Decimal(str(lo)) <= value <= Decimal(str(hi)):
        return False
    if (value / Decimal(step)) % 1 != 0:
        return False
    return value not in {Decimal(str(x)) for x in exclude}


def json_number(value: object, lo: float, hi: float, step: str = "0.01") -> bool:
    """A JSON number in range and on the step (R-VAL-1). Booleans are not numbers."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return number_value(Decimal(repr(value)), lo, hi, step)


def json_int(value: object, lo: int, hi: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and lo <= value <= hi


def font_name(text: object, tokens: bool = True) -> bool:
    """A font name or a theme token (R-VAL-2)."""
    if not isinstance(text, str):
        return False
    if text in THEME_FONTS:
        return tokens
    if not 1 <= len(text) <= 63 or text.endswith(" "):
        return False

    def letter_or_digit(c: str) -> bool:
        return unicodedata.category(c)[0] in "LN"

    return letter_or_digit(text[0]) and all(letter_or_digit(c) or c in " ._+-" for c in text[1:])


def color(text: object, kinds: str = "pen highlighter hex theme") -> bool:
    """A color (R-VAL-7): a pen or highlighter name, `#rrggbb`, or `theme:NAME`, as `kinds` allows."""
    if not isinstance(text, str):
        return False
    return bool(
        ("pen" in kinds and text in PENS)
        or ("highlighter" in kinds and text in HIGHLIGHTERS)
        or ("hex" in kinds and HEX.fullmatch(text))
        or ("theme" in kinds and text.startswith("theme:") and text[6:] in THEME_COLORS)
    )


def lang(text: object) -> bool:
    """A language tag (R-VAL-9)."""
    return isinstance(text, str) and (text == "zxx" or bool(LANG.fullmatch(text)))


def style_name(text: object) -> bool:
    """A style name (R-STY-3)."""
    if not isinstance(text, str):
        return False
    return text in STYLE_NAMES_V1 or text in STYLE_NAMES_V2 or bool(USER_STYLE.fullmatch(text))


def tokens(text: str, allowed: tuple) -> bool:
    """Space-separated tokens, sorted in code point order, unique, at least one, all from `allowed`."""
    parts = text.split(" ")
    return all(p in allowed for p in parts) and parts == sorted(set(parts))
