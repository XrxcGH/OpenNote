"""Writes the journal fixtures of spec Appendix B.6 from the values below, with the Python standard library only.

Run it from this folder: python make_journal_fixtures.py. The files it writes are committed, so readers in
other languages can test against them without running it.
"""

import gzip
import json
import struct
import zlib
from pathlib import Path

HERE = Path(__file__).parent
MAGIC = bytes([0x89, 0x4F, 0x4E, 0x4A, 0x0D, 0x0A, 0x1A, 0x0A])
ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"
NL = chr(10)

NOTEBOOK = "01m3s9q9xbpmxwz4cz4ht6twg9"
SECTION = "01m3s9v8ym7yt5c8yb61tthbwt"
PAGE = "01m3sa12426sg32pmtyffjaqcf"
BASE = "01m3sa8yf8bryf28a7sjgb7mmc"
TEXT_BLOCK = "01m3sa14y9zszek1wdk3snddsn"
INK_BLOCK = "01m3sa1242ayy4avvsz3yx5gxj"
DEVICE = "01m1e34qm04rx4vfj1927vgwgm"
IDENTITY = "5eed" + "00" * 22

# The stroke record of spec Appendix B.2: bytes 0x40 to 0xa7 of the segment file.
STROKE_RECORD = bytes.fromhex(
    "4a6c2287010000005c00000001a0f2a4"
    "71691ba7573640bbbb13a9e201a0f2a0"
    "888257bc456f79f8fdd2c3b26971a4f2"
    "a0010000000105002b2521ff00000040"
    "8002000000050000d0020000a0050000"
    "03000000800a801480800200408001bc"
    "142a60c001dc1e29"
)


def id_bytes(text):
    """The 16 bytes of an ID in its text form (spec 2.4)."""
    value = 0
    for char in text:
        value = value * 32 + ALPHABET.index(char)
    return value.to_bytes(16, "big")


def canonical(value, indent=0):
    """JSON in the canonical form of spec 2.2, for the small documents here: 2 spaces per level, and arrays of
    scalars on one line."""
    pad = "  " * indent
    inner = "  " * (indent + 1)
    if isinstance(value, dict):
        if not value:
            return "{}"
        items = [f"{inner}{json.dumps(k, ensure_ascii=False)}: {canonical(v, indent + 1)}" for k, v in value.items()]
        return "{" + NL + ("," + NL).join(items) + NL + pad + "}"
    if isinstance(value, list):
        if all(not isinstance(v, (dict, list)) for v in value):
            return "[" + ", ".join(json.dumps(v, ensure_ascii=False) for v in value) + "]"
        items = [inner + canonical(v, indent + 1) for v in value]
        return "[" + NL + ("," + NL).join(items) + NL + pad + "]"
    return json.dumps(value, ensure_ascii=False)


def document(value):
    """A whole JSON file: canonical, with a final newline."""
    return (canonical(value) + NL).encode()


def base_page(blocks):
    """A page.json with these blocks, at the base revision."""
    return {
        "formatVersion": 1,
        "minReaderVersion": 1,
        "kind": "opennote.page",
        "id": PAGE,
        "title": "Photosynthesis",
        "created": "2026-09-30T14:03:22.114Z",
        "modified": "2026-09-30T14:05:40.020Z",
        "tags": ["biology"],
        "view": {},
        "blocks": blocks,
        "revision": {
            "id": BASE,
            "parents": [],
            "ancestors": [],
            "savedAt": "2026-09-30T14:05:40.520Z",
            "device": {"id": DEVICE, "label": "Windows device GWGM"},
            "writer": "OpenNote 0.4.0 (windows)",
        },
    }


def header(page_json, anchor):
    """A generation header (spec 20.5) with the gzipped base snapshot."""
    meta = json.dumps(
        {
            "app": "OpenNote 0.4.0 (windows)",
            "boot": "fixture-boot",
            "device": DEVICE,
            "notebookIdentity": IDENTITY,
            "notebookPath": "C:\\Users\\Sam\\Notes\\Biology",
            "section": SECTION,
        },
        separators=(",", ":"),
    ).encode()
    base = gzip.compress(page_json, mtime=0)
    length = 100 + len(meta) + len(base) + 4
    fixed = MAGIC + struct.pack("<HHI", 1, 0, length)
    fixed += id_bytes(NOTEBOOK) + id_bytes(PAGE) + id_bytes(BASE)
    fixed += struct.pack("<QQqHHII", 1, anchor, 1790777261000, 1, 0, len(meta), len(base))
    body = fixed + meta + base
    return body + struct.pack("<I", zlib.crc32(body))


def record(seq, kind, value, blob=b""):
    """A record (spec 20.6): frame, JSON, and blob."""
    data = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()
    rest = struct.pack("<IQBBHI", len(data) + len(blob), seq, kind, 0, 0, len(data)) + data + blob
    return struct.pack("<I", zlib.crc32(rest)) + rest


def text_edits():
    """A page with one text block, two edits in the journal, and a save that never replaced page.json."""
    markdown = "## Light reactions\n\nThe thylakoid membrane"
    block = {
        "id": TEXT_BLOCK,
        "type": "text",
        "order": "a0",
        "created": "2026-09-30T14:03:25.001Z",
        "modified": "2026-09-30T14:05:40.020Z",
        "data": {"markdown": markdown},
    }
    page_json = document(base_page([block]))
    edit = {
        "txn": "01m3sa8z1czh26f1rsnav197pg",
        "at": "2026-09-30T14:07:41.100Z",
        "origin": "local",
        "client": "main-1",
        "ops": [
            {
                "op": "editText",
                "block": TEXT_BLOCK,
                "splices": [{"at": len(markdown.encode()), "del": "", "ins": " holds chlorophyll a."}],
                "stamps": ["2026-09-30T14:05:40.020Z", "2026-09-30T14:07:41.100Z"],
            }
        ],
    }
    rename = {
        "txn": "01m3sa8z1d0000000000000000",
        "at": "2026-09-30T14:07:42.000Z",
        "origin": "local",
        "client": "main-1",
        "ops": [
            {
                "op": "setPage",
                "before": {"title": "Photosynthesis", "tags": ["biology"]},
                "after": {"title": "Photosynthesis notes", "tags": ["biology", "exam/unit-3"]},
            }
        ],
    }
    save_begin = {"revision": "01m3sa90000000000000000000", "throughSeq": 2}
    wal = header(page_json, 0) + record(1, 1, edit) + record(2, 1, rename) + record(3, 2, save_begin)
    edited = dict(block, modified="2026-09-30T14:07:41.100Z", data={"markdown": markdown + " holds chlorophyll a."})
    expected = base_page([edited])
    expected.update(title="Photosynthesis notes", tags=["biology", "exam/unit-3"], modified="2026-09-30T14:07:42.000Z")
    return page_json, wal, document(expected)


def ink_progress():
    """A page with a handwriting layer, and the stroke of spec 9.7 still being drawn when the app stopped."""
    block = {
        "id": INK_BLOCK,
        "type": "ink",
        "order": "a0",
        "frame": {"x": 0, "y": 0},
        "created": "2026-09-30T14:03:22.114Z",
        "modified": "2026-09-30T14:05:40.020Z",
        "data": {"role": "layer"},
    }
    page_json = document(base_page([block]))
    progress = {"stroke": "01m3sa8wb93eknedj0qexh7af2"}
    wal = header(page_json, 41) + record(42, 3, progress, STROKE_RECORD)
    return page_json, wal


def write(folder, files):
    target = HERE / folder
    target.mkdir(exist_ok=True)
    for name, data in files.items():
        (target / name).write_bytes(data)


def main():
    wal_name = f"{PAGE}-0000000000000001.wal"
    page_json, wal, expected = text_edits()
    write("text-edits", {"page.json": page_json, wal_name: wal, "expected.json": expected})
    page_json, wal = ink_progress()
    write("ink-progress", {"page.json": page_json, wal_name: wal})
    save_begin = {"revision": "01m3sa8yf8bryf28a7sjgb7mmc", "throughSeq": 1043}
    (HERE / "save-begin-b3.bin").write_bytes(record(1044, 2, save_begin))


if __name__ == "__main__":
    main()
