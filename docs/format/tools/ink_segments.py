"""Ink segment files and point data (spec 9) for the reference reader, with only the standard library.

It decodes a segment as spec 9.6 says and reports what it finds in the JSON form of the ink fixtures in
docs/format/fixtures/ink, so its results compare directly with theirs.
"""

from __future__ import annotations

import math
import struct
import zlib

ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"
MAGIC = bytes([0x89, 0x4F, 0x4E, 0x4B, 0x0D, 0x0A, 0x1A, 0x0A])
FOOTER_MAGIC = b"ONKE"
TIME_MIN, TIME_MAX = -62_135_596_800_000, 253_402_300_799_999


def id_text(data: bytes) -> str:
    """The 26-character text of a 16-byte ID (spec 2.4)."""
    value = int.from_bytes(data, "big")
    return "".join(ID_ALPHABET[(value >> (5 * (25 - i))) & 31] for i in range(26))


class SegmentError(Exception):
    """A segment that can't be read at all. `kind` names the error as the ink fixtures do."""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


class Reader:
    """Reads varints from point data, checking that each is at most 5 bytes and in its shortest form."""

    def __init__(self, data: bytes):
        self.data, self.pos = data, 0

    def varint(self) -> int:
        value = 0
        for shift in (0, 7, 14, 21, 28):
            if self.pos >= len(self.data):
                raise ValueError("the point data ended early")
            byte = self.data[self.pos]
            self.pos += 1
            if shift == 28 and byte > 0x0F:
                raise ValueError("a malformed varint")
            value |= (byte & 0x7F) << shift
            if not byte & 0x80:
                if byte == 0 and shift > 0:
                    raise ValueError("an overlong varint")
                return value
        raise ValueError("a malformed varint")

    def zigzag(self) -> int:
        z = self.varint()
        return (z >> 1) ^ -(z & 1)


def decode_points(data: bytes, count: int, channels: int) -> list[list[int]]:
    """Decodes exactly `count` points that use up exactly `data`, as [x, y, pressure, tiltX, tiltY, t]."""
    if count < 1 or count > 200_000 or len(data) < 2 * count:
        raise ValueError("a bad point count")
    reader, points = Reader(data), []
    x = y = p = tx = ty = t = 0
    for i in range(count):
        first = i == 0
        x = (0 if first else x) + reader.zigzag()
        y = (0 if first else y) + reader.zigzag()
        if abs(x) > 2**29 or abs(y) > 2**29:
            raise ValueError("a coordinate out of range")
        if channels & 1:
            p = reader.varint() if first else p + reader.zigzag()
            if not 0 <= p <= 0xFFFF:
                raise ValueError("pressure out of range")
        if channels & 2:
            tx = (0 if first else tx) + reader.zigzag()
            ty = (0 if first else ty) + reader.zigzag()
            if abs(tx) > 9000 or abs(ty) > 9000:
                raise ValueError("tilt out of range")
        if channels & 4:
            dt = reader.varint()
            t = dt if first else t + dt
            if (first and t > 9) or t > 0xFFFFFFFF:
                raise ValueError("time out of range")
        points.append([x, y, p if channels & 1 else 0, tx if channels & 2 else 0, ty if channels & 2 else 0, t])
    if reader.pos != len(data):
        raise ValueError("bytes after the last point")
    return points


def f32(data: bytes, at: int) -> float | None:
    """A finite `f32` at a byte offset, or None."""
    value = struct.unpack_from("<f", data, at)[0]
    return value if math.isfinite(value) else None


def style_at(data: bytes, at: int, color_at: int, width_at: int) -> dict | None:
    width = f32(data, width_at)
    if width is None:
        return None
    return {"tool": data[at], "palette": data[at + 1], "color": list(data[color_at : color_at + 4]), "width": width}


def affine_at(data: bytes, at: int) -> list[float] | None:
    values = [f32(data, at + 4 * i) for i in range(6)]
    return None if any(v is None for v in values) else values


def parse_stroke(body: bytes):
    """A stroke record's body as a dict, `"unknown"`, or a failure reason."""
    if len(body) < 44:
        return "body"
    (flags,) = struct.unpack_from("<H", body, 42)
    if flags & ~0x3F:
        return "unknown"
    if len(body) < 72:
        return "body"
    (start,) = struct.unpack_from("<q", body, 32)
    style = style_at(body, 40, 44, 48)
    if style is None or not TIME_MIN <= start <= TIME_MAX:
        return "body"
    at, transform, origin = 72, None, None
    if flags & 8:
        transform = affine_at(body, at) if len(body) >= at + 24 else None
        if transform is None:
            return "body"
        at += 24
    if flags & 16:
        if len(body) < at + 16:
            return "body"
        origin, at = id_text(body[at : at + 16]), at + 16
    bbox = list(struct.unpack_from("<4i", body, 52))
    (count,) = struct.unpack_from("<I", body, 68)
    try:
        points = decode_points(body[at:], count, flags & 7)
    except ValueError:
        return "points"
    found = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]
    if found != bbox:
        return "points"
    return {
        "kind": "stroke", "id": id_text(body[:16]), "block": id_text(body[16:32]), "start": start,
        "startUnknown": bool(flags & 32), "style": style, "bbox": bbox, "channels": flags & 7,
        "transform": transform, "origin": origin, "points": points,
    }  # fmt: skip


def parse_props(body: bytes):
    """A property record's body as a dict, `"unknown"`, or a failure reason."""
    if len(body) < 20:
        return "body"
    mask, reserved = struct.unpack_from("<HH", body, 16)
    if mask & ~7 or reserved:
        return "unknown"
    record = {"kind": "props", "id": id_text(body[:16]), "style": None, "transform": None, "block": None}
    at = 20
    if mask & 1:
        record["style"] = style_at(body, at, at + 4, at + 8) if len(body) >= at + 12 else None
        if record["style"] is None:
            return "body"
        if struct.unpack_from("<H", body, at + 2)[0]:
            return "unknown"
        at += 12
    if mask & 2:
        affine = affine_at(body, at) if len(body) >= at + 24 else None
        if affine is None:
            return "body"
        identity = body[at : at + 24] == struct.pack("<6f", 1, 0, 0, 1, 0, 0)
        record["transform"], at = ("remove" if identity else affine), at + 24
    if mask & 4:
        if len(body) < at + 16:
            return "body"
        record["block"], at = id_text(body[at : at + 16]), at + 16
    return record if at == len(body) else "body"


def parse_body(kind: int, flags: bytes, body: bytes):
    """A record's body: a dict, `"unknown"` for data from a newer version, or a failure reason."""
    if any(flags):
        return "unknown"
    if kind == 1:
        return parse_stroke(body)
    if kind == 2:
        return parse_props(body)
    if kind == 3:
        return {"kind": "remove", "id": id_text(body)} if len(body) == 16 else "body"
    return "unknown"


def read_frame(data: bytes, pos: int, end: int):
    """The frame at `pos` as (crc, kind, flags, body start, body end), or `truncated` or `length`."""
    if pos + 12 > end:
        return "truncated"
    crc, kind = struct.unpack_from("<IB", data, pos)
    (length,) = struct.unpack_from("<I", data, pos + 8)
    if pos + 12 + length > end:
        return "length"
    return crc, kind, data[pos + 5 : pos + 8], pos + 12, pos + 12 + length


def crc_ok(data: bytes, pos: int, frame) -> bool:
    return zlib.crc32(data[pos + 4 : frame[4]]) == frame[0]


def read_exact(data: bytes, end: int, count: int):
    """Exactly `count` records ending at the footer, trusting the footer's CRC-32, or None."""
    records, unknown, pos = [], 0, 64
    for _ in range(count):
        frame = read_frame(data, pos, end)
        if isinstance(frame, str):
            return None
        parsed = parse_body(frame[1], frame[2], data[frame[3] : frame[4]])
        if parsed == "unknown":
            unknown += 1
        elif isinstance(parsed, str):
            return None
        else:
            records.append(parsed)
        pos = frame[4]
    return (records, unknown) if pos == end else None


def walk(data: bytes, end: int) -> tuple[list, list, int]:
    """Walks the records one at a time (spec 9.6 step 5), skipping damaged ones."""
    records, damaged, unknown, pos, index = [], [], 0, 64, 0
    while pos < end:
        frame = read_frame(data, pos, end)
        if isinstance(frame, str):
            damaged.append({"index": index, "offset": pos, "stroke": None, "reason": frame})
            index += 1
            pos = next((q for q in range(pos + 1, end) if resyncs(data, q, end)), None)
            if pos is None:
                break
            continue
        parsed = parse_body(frame[1], frame[2], data[frame[3] : frame[4]]) if crc_ok(data, pos, frame) else "checksum"
        if parsed == "unknown":
            unknown += 1
        elif isinstance(parsed, str):
            readable = frame[1] in (1, 2, 3) and frame[3] + 16 <= len(data)
            stroke = id_text(data[frame[3] : frame[3] + 16]) if readable else None
            damaged.append({"index": index, "offset": pos, "stroke": stroke, "reason": parsed})
        else:
            records.append(parsed)
        index, pos = index + 1, frame[4]
    return records, damaged, unknown


def resyncs(data: bytes, pos: int, end: int) -> bool:
    frame = read_frame(data, pos, end)
    return not isinstance(frame, str) and not any(frame[2]) and crc_ok(data, pos, frame)


def read_header(data: bytes) -> tuple[dict, int]:
    if len(data) < 72 or data[:8] != MAGIC:
        raise SegmentError("syntax", "not an ink segment")
    version, flags, count = struct.unpack_from("<HHI", data, 8)
    if version == 0:
        raise SegmentError("syntax", "segment version 0")
    if version > 1:
        raise SegmentError("newerVersion", f"segment version {version}")
    if zlib.crc32(data[:60]) != struct.unpack_from("<I", data, 60)[0]:
        raise SegmentError("checksum", "a damaged header")
    if flags or struct.unpack_from("<I", data, 56)[0]:
        raise SegmentError("unknownRecord", "header flags from a newer version")
    (created,) = struct.unpack_from("<q", data, 48)
    if not TIME_MIN <= created <= TIME_MAX:
        raise SegmentError("validation", "the time is out of range")
    return {"created": created, "id": id_text(data[16:32]), "page": id_text(data[32:48])}, count


def decode_segment(data: bytes, expect: dict, page: str) -> dict:
    """Decodes a segment file as spec 9.6 says, in the JSON form of the ink fixtures."""
    header, count = read_header(data)
    if header["id"] != expect["id"] or header["page"] != page:
        raise SegmentError("validation", "the segment's IDs don't match its entry and page")
    footer_at = len(data) - 8
    stored_crc = struct.unpack_from("<I", data, footer_at)[0]
    footer_ok = data.endswith(FOOTER_MAGIC) and stored_crc == zlib.crc32(data[:footer_at])
    result = {"damaged": [], "footerOk": footer_ok, "header": header, "records": [], "unknownRecords": 0}
    if footer_ok:
        if (expect["bytes"], int(expect["crc32"], 16), expect["records"]) != (len(data), stored_crc, count):
            raise SegmentError("checksum", "the segment doesn't match its entry")
        exact = read_exact(data, footer_at, count)
        if exact is not None:
            result["records"], result["unknownRecords"] = exact
            return result
    end = footer_at if data.endswith(FOOTER_MAGIC) else len(data)
    result["records"], result["damaged"], result["unknownRecords"] = walk(data, end)
    return result


def replay(record_lists: list[list[dict]]) -> dict[str, dict]:
    """The live strokes after applying every record in order (spec 8.3), by ID."""
    live: dict[str, dict] = {}
    for record in (r for records in record_lists for r in records):
        if record["kind"] == "stroke":
            live[record["id"]] = dict(record)
        elif record["kind"] == "remove":
            live.pop(record["id"], None)
        elif record["id"] in live:
            stroke = live[record["id"]]
            stroke["style"] = record["style"] or stroke["style"]
            stroke["block"] = record["block"] or stroke["block"]
            if record["transform"] is not None:
                identity = record["transform"] == "remove" or record["transform"] == [1, 0, 0, 1, 0, 0]
                stroke["transform"] = None if identity else record["transform"]
    return live
