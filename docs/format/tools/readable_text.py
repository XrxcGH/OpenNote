"""Text, numbers, and checksums that the reference reader's readable copies share (spec 2.2, 2.3, and 11)."""

from __future__ import annotations

import json
import math
import zlib
from pathlib import Path

from markdown_text import WHITE_SPACE

YAML_ESCAPED = {chr(0x2028), chr(0x2029), chr(0xFEFF)}


def strip(text: str) -> str:
    """Trims Unicode white space from both ends, as Rust's `str::trim` does."""
    start, end = 0, len(text)
    while start < end and text[start] in WHITE_SPACE:
        start += 1
    while end > start and text[end - 1] in WHITE_SPACE:
        end -= 1
    return text[start:end]


def one_line(text: str) -> str:
    """Text for one line: line breaks become spaces."""
    return text.replace("\r\n", " ").replace("\r", " ").replace("\n", " ")


def quoted(text: str) -> str:
    """A JSON string as spec 2.2 writes it, with C1 controls and line separators escaped too, for YAML."""
    short = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}
    out = []
    for c in text:
        if c in short:
            out.append(short[c])
        elif ord(c) < 0x20 or 0x7F <= ord(c) <= 0x9F or c in YAML_ESCAPED:
            out.append(f"\\u{ord(c):04x}")
        else:
            out.append(c)
    return '"' + "".join(out) + '"'


def round_half_away(x: float) -> float:
    """Rounds half away from zero, as Rust's `f64::round` does (spec 2.1)."""
    a = abs(x)
    whole = math.floor(a)
    return math.copysign(whole + 1.0 if a - whole >= 0.5 else whole, x)


def fixed(value: float, decimals: int) -> str:
    """A number rounded to `decimals` decimals, without an exponent, trailing zeros, or `-0` (spec 2.3)."""
    if not math.isfinite(value):
        return "0"
    scale = 10**decimals
    scaled = round_half_away(value * scale)
    if not math.isfinite(scaled) or abs(scaled) >= 2.0**53:
        return str(max(-(2**127), min(2**127 - 1, int(round_half_away(value)))))
    n = int(scaled)
    whole, fraction = divmod(abs(n), scale)
    text = ("-" if n < 0 else "") + str(whole)
    if fraction:
        text += "." + str(fraction).rjust(decimals, "0").rstrip("0")
    return text


def seal(text: str) -> str:
    """Fills in a readable copy's checksum: the CRC-32 of the file with the checksum's digits as zeros."""
    found = [text.find(m) + len(m) for m in ('checksum: "crc32:', 'checksum": "crc32:') if m in text]
    at = min(found)
    crc = zlib.crc32(text.encode("utf-8"))
    return text[:at] + f"{crc:08x}" + text[at + 8 :]


def read_json(path: Path) -> dict:
    """A JSON file, read as spec 2.2 says: with or without a byte order mark, and without duplicate keys."""

    def no_duplicates(pairs):
        keys = [key for key, _ in pairs]
        if len(keys) != len(set(keys)):
            raise ValueError(f"{path}: a duplicate key")
        return dict(pairs)

    return json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=no_duplicates)


def is_floating(block: dict) -> bool:
    frame = block.get("frame") or {}
    return frame.get("x") is not None and frame.get("y") is not None
