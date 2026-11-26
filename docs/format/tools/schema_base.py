"""The pieces the schema checks of format version 2 are built from: each check returns its problems."""

from __future__ import annotations

import re

import format_v2 as v2

TIMESTAMP = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z")
SHORT_ID = re.compile(r"[a-z0-9]{1,16}")
STYLE_ID = re.compile(r"[0-9a-z]{1,16}")
LOOK = re.compile(r"[a-z0-9-]{1,32}")
NAME = re.compile(r"[^\W\d][\w.]{0,254}|\\[\w.]{0,254}")
CELL_REF = re.compile(r"[A-Za-z]{1,3}[0-9]{1,7}|[RrCc]|[Rr][0-9]+|[Cc][0-9]+|[Rr][0-9]+[Cc][0-9]+")
ERRORS = ("#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#SPILL!", "#CALC!", "#FIELD!", "#BUSY!")


def check(value, schema, path: str) -> list[str]:
    return schema(value, path)


def ok(test, what: str):
    def run(value, path):
        return [] if test(value) else [f"{path}: {what}"]

    return run


def enum(*values):
    return ok(lambda v: isinstance(v, str) and v in values, "one of " + ", ".join(values))


BOOL = ok(lambda v: isinstance(v, bool), "a boolean")
ANY_COLOR = ok(v2.color, "a color (Appendix D.7)")
COLOR_OR_NONE = ok(lambda v: v == "none" or v2.color(v), "a color or none")
FONT = ok(v2.font_name, "a font name or token (Appendix D.2)")
LANG = ok(v2.lang, "a language tag (Appendix D.8)")
WHEN = ok(lambda v: isinstance(v, str) and bool(TIMESTAMP.fullmatch(v)), "a timestamp")
ELEMENT_ID = ok(lambda v: isinstance(v, str) and bool(v2.ID.fullmatch(v)), "an ID")
STYLE_NAME = ok(v2.style_name, "a style name")
STYLE_REF = ok(lambda v: isinstance(v, str) and bool(STYLE_ID.fullmatch(v)), "a style ID")


def integer(lo, hi):
    return ok(lambda v: v2.json_int(v, lo, hi), f"an integer from {lo} to {hi}")


def points(lo, hi, step):
    return ok(lambda v: v2.json_number(v, lo, hi, step), f"a number from {lo} to {hi}, step {step}")


def text(lo, hi):
    return ok(lambda v: isinstance(v, str) and lo <= len(v) <= hi, f"a string of {lo} to {hi} characters")


def utf8(limit):
    return ok(lambda v: isinstance(v, str) and len(v.encode("utf-8")) <= limit, f"text of at most {limit} bytes")


def either(*schemas):
    def run(value, path):
        results = [schema(value, path) for schema in schemas]
        return [] if any(not r for r in results) else min(results, key=len)

    return run


def obj(fields: dict, required: tuple = ()):
    def run(value, path):
        if not isinstance(value, dict):
            return [f"{path}: an object"]
        problems = [f"{path}.{key}: required" for key in required if key not in value]
        for key, item in value.items():
            if key not in fields:
                problems.append(f"{path}.{key}: not a key of this object")
            else:
                problems += fields[key](item, f"{path}.{key}")
        return problems

    return run


def array(item, lo, hi):
    def run(value, path):
        if not isinstance(value, list) or not lo <= len(value) <= hi:
            return [f"{path}: an array of {lo} to {hi} items"]
        return [p for i, x in enumerate(value) for p in item(x, f"{path}[{i}]")]

    return run


def mapping(key_test, item, limit, what, order=sorted):
    def run(value, path):
        if not isinstance(value, dict) or len(value) > limit:
            return [f"{path}: a map of at most {limit} entries"]
        problems = [] if list(value) == order(value) else [f"{path}: keys not in the written order (R-JSON-2)"]
        for key, x in value.items():
            if not key_test(key):
                problems.append(f"{path}: key {key!r} is not {what}")
            problems += item(x, f"{path}.{key}")
        return problems

    return run


def is_id(key):
    return bool(v2.ID.fullmatch(key))


def is_short(key):
    return bool(SHORT_ID.fullmatch(key))
