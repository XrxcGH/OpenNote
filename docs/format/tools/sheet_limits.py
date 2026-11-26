"""Expands the directives of `fixtures/table-sheet/limits/cases.json` into a literal page.

A case at a limit is too big to keep as text (a million cells), so the file says how to build it. The directives
are the only thing in the file that is not plain JSON, and they are all here:

- `{"$limit": offset}`: the number of the variant (the limit, or one past it) plus `offset`
- `{"$chars": "a", "count": N}`: the string `a` repeated N times
- `{"$list": {"count": N, "value": V}}`: a list of N copies of V
- `{"$map": {"count": N, "key": "Name%05d", "value": V}}`: a map of N entries; the key is the printf format
  applied to 1, 2, and so on, or a `$chars` directive when N is 1. Every format writes keys that sort in
  the order they were made
- `{"$cells": {"count": N, "perRow": M, "value": V}}`: a map from a row ID to a map from a column ID to V,
  N cells in all, M to a row (the last row holds the rest)

`count` is a number, or the word `limit` for the number of the variant. Row IDs are `ROW % 1`, `ROW % 2`, and so
on, and column IDs are `COL % 1`, `COL % 2`, and so on. Like the rest of the Python reference reader, this
uses only the standard library.
"""

from __future__ import annotations

import copy

ROW = "01m3sbcmtr%016x"
COL = "01m3sbcmtk%016x"
DIRECTIVES = ("$limit", "$chars", "$list", "$map", "$cells")


def _count(value: object, limit: int) -> int:
    if value == "limit":
        return limit
    assert isinstance(value, int) and not isinstance(value, bool), f"a count is a number or 'limit', not {value!r}"
    return value


def expand(node: object, limit: int) -> object:
    """`node` with every directive replaced by what it builds, for the variant numbered `limit`."""
    if isinstance(node, list):
        return [expand(item, limit) for item in node]
    if not isinstance(node, dict):
        return node
    found = [key for key in node if key in DIRECTIVES]
    if not found:
        return {key: expand(item, limit) for key, item in node.items()}
    (name,) = found
    if name == "$limit":
        assert list(node) == ["$limit"]
        return limit + node["$limit"]
    if name == "$chars":
        assert sorted(node) == ["$chars", "count"]
        return node["$chars"] * _count(node["count"], limit)
    spec = node[name]
    assert list(node) == [name]
    count = _count(spec["count"], limit)
    if name == "$list":
        return [expand(copy.deepcopy(spec["value"]), limit) for _ in range(count)]
    if name == "$map":
        key = spec["key"]
        if isinstance(key, dict):
            assert count == 1, "a key that is built is for a map of one entry"
            return {expand(key, limit): expand(copy.deepcopy(spec["value"]), limit)}
        return {key % (i + 1): expand(copy.deepcopy(spec["value"]), limit) for i in range(count)}
    per_row = spec["perRow"]
    value = expand(spec["value"], limit)
    rows: dict = {}
    for n in range(count):
        row, column = divmod(n, per_row)
        rows.setdefault(ROW % (row + 1), {})[COL % (column + 1)] = value
    return rows


def build(case: dict, template: dict, limit: int) -> dict:
    """The page of one variant of a case: the file's table, with the case's `sheet` expanded into it."""
    page = copy.deepcopy(template)
    page["blocks"][0]["data"]["sheet"] = expand(case["sheet"], limit)
    return page
