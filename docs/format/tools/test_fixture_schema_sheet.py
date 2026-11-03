"""Checks every fixture of `fixtures/table-sheet/` against the schema of `data.sheet` (spec 6.3).

Besides the schema, it checks what a schema cannot: that each fixture names rules of the spec, that every key and
every named value of the spec has a fixture, that the numbers respect their ranges (restated here, apart from the
reader's code, so a reader bug can't make a wrong fixture pass), that style IDs are the ones a writer derives, that
the keys are in code point order, and that a page Beta 8 wrote reads back unchanged. The limits have their own
test, `test_sheet_limits.py`. Run it with
`python -m unittest discover -s docs/format/tools -p "test_*.py" -v` from the repository.
"""

import json
import re
import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import canonical_json  # noqa: E402
import format_v2 as v2  # noqa: E402
import schema_base  # noqa: E402
import schema_sheet  # noqa: E402
import schema_v2  # noqa: E402

FORMAT = Path(__file__).resolve().parents[1]
FOLDER = FORMAT / "fixtures" / "table-sheet"
SPEC = (FORMAT / "README.md").read_text(encoding="utf-8")
CASE_KEYS = {"name", "rules", "page", "stamp", "problems", "expect"}
STAMP_KEYS = ["formatVersion", "minReaderVersion", "minWriterVersion"]
SIDES = ("t", "r", "b", "l", "du", "dd")
SHORT_ID = re.compile(r"[a-z0-9]{1,16}")


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def cases() -> dict[str, dict]:
    return {path.name: load(path) for path in sorted(FOLDER.glob("*.json"))}


def sheet_of(case: dict) -> dict:
    return case["page"]["blocks"][0]["data"].get("sheet", {})


def valid_sheets() -> list[tuple[str, dict]]:
    return [(name, sheet_of(case)) for name, case in cases().items() if not case.get("problems")]


def walk(node, path=()):
    """Every (path, value) of a JSON value, with list items under `[]`."""
    yield path, node
    items = node.items() if isinstance(node, dict) else enumerate(node) if isinstance(node, list) else ()
    for key, item in items:
        yield from walk(item, path + (key if isinstance(node, dict) else "[]",))


def styles() -> list[tuple[str, str, dict]]:
    return [(name, sid, style) for name, sheet in valid_sheets() for sid, style in sheet.get("styles", {}).items()]


def style_paths() -> set[str]:
    return {".".join(path) for _, _, style in styles() for path, _ in walk(style)}


def under(*prefix: str) -> set:
    """The scalars found at a path of the valid sheets, where `*` stands for any key."""
    found = set()
    for _, sheet in valid_sheets():
        found |= {value for path, value in walk(sheet) if matches(prefix, path) and isinstance(value, str)}
    return found


def matches(pattern: tuple, path: tuple) -> bool:
    return len(pattern) == len(path) and all(p in ("*", q) for p, q in zip(pattern, path))


def icons(rule: dict) -> int:
    """How many thresholds an icon set needs: one fewer than its icons."""
    return int(rule.get("set", "3")[0]) - 1


def on_step(value, lo, hi, step) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    d = Decimal(repr(value))
    return Decimal(str(lo)) <= d <= Decimal(str(hi)) and (d / Decimal(step)) % 1 == 0


class ShapeTest(unittest.TestCase):
    def test_there_are_cases(self) -> None:
        self.assertGreaterEqual(len(cases()), 30)

    def test_every_case_has_its_fields(self) -> None:
        for name, case in cases().items():
            with self.subTest(case=name):
                self.assertLessEqual(set(case), CASE_KEYS)
                self.assertTrue({"name", "rules", "page", "stamp"} <= set(case))
                self.assertTrue(isinstance(case["name"], str) and case["name"])
                self.assertTrue(case["rules"] and all(re.fullmatch(r"R-[A-Z]+-[0-9]+", r) for r in case["rules"]))
                self.assertEqual(sorted(case["stamp"]), STAMP_KEYS)
                self.assertEqual([b["type"] for b in case["page"]["blocks"]], ["table"])
                self.assertEqual(case["page"]["kind"], "opennote.page")

    def test_every_fixture_passes_the_schema(self) -> None:
        for name, case in cases().items():
            with self.subTest(case=name):
                found = schema_v2.page_problems(case["page"])
                if "problems" in case:
                    self.assertTrue(case["problems"], "a case with problems lists them")
                self.assertEqual(sorted(found), sorted(case.get("problems", [])))

    def test_a_writer_stamps_each_page_as_the_case_says(self) -> None:
        for name, case in cases().items():
            with self.subTest(case=name):
                self.assertEqual(v2.stamp(case["page"]), case["stamp"])

    def test_a_case_with_problems_has_a_sheet_a_reader_still_keeps(self) -> None:
        for name, case in cases().items():
            with self.subTest(case=name):
                self.assertTrue(sheet_of(case) or "problems" not in case, "R-SHT-1")

    def test_every_rule_is_in_the_spec_and_every_rule_of_the_sheet_has_a_case(self) -> None:
        spec = set(re.findall(r"`(R-[A-Z]+-[0-9]+)`", SPEC))
        cited = {rule for case in cases().values() for rule in case["rules"]}
        cited |= {rule for case in load(FOLDER / "limits" / "cases.json")["cases"] for rule in case["rules"]}
        self.assertEqual(sorted(cited - spec), [])
        paras = load(FORMAT / "fixtures" / "markdown" / "paras" / "cases.json")["cases"]
        elsewhere = {rule for case in paras for rule in case["rules"]}
        wanted = {rule for rule in spec if rule.startswith("R-SHT-")}
        self.assertEqual(sorted(wanted - cited - elsewhere), [])

    def test_the_readme_names_every_file(self) -> None:
        readme = (FOLDER / "README.md").read_text(encoding="utf-8")
        for path in [*FOLDER.glob("*.json"), FOLDER / "limits" / "cases.json"]:
            with self.subTest(file=path.name):
                self.assertIn(f"`{path.relative_to(FOLDER).as_posix()}`", readme)


class CoverageTest(unittest.TestCase):
    """The spec names every key and every value: a valid fixture shows each one."""

    def test_every_key_of_the_sheet_has_a_fixture(self) -> None:
        keys = {key for _, sheet in valid_sheets() for key in sheet}
        self.assertEqual(sorted(keys), sorted(schema_sheet.SHEET_KEYS))
        for key in schema_sheet.SHEET_KEYS:
            with self.subTest(key=key):
                self.assertTrue(any(sheet.get(key) for _, sheet in valid_sheets()), "a fixture holds a real one")

    def test_every_style_key_is_shown(self) -> None:
        shown = style_paths()
        wanted = (
            "fmt font.family font.size font.weight font.bold font.italic font.underline font.strike font.color "
            "font.script fill fill.pattern fill.color fill.back fill.gradient.angle fill.gradient.stops "
            "border.t border.r border.b border.l border.du border.dd border.t.style border.t.color "
            "border.t.width align.h align.v align.wrap align.shrink align.rotate align.indent align.dir "
            "pad.t pad.r pad.b pad.l protect.locked protect.hideFormula"
        ).split()
        for path in wanted:
            with self.subTest(key=path):
                self.assertIn(path, shown)

    def test_every_table_row_and_column_key_is_shown(self) -> None:
        seen = {path for _, sheet in valid_sheets() for path, _ in walk(sheet)}
        wanted = "style look band.rows band.cols emphasis.firstCol emphasis.lastCol emphasis.totalRow freeze.rows "
        for path in (wanted + "freeze.cols pad.t grid name").split():
            with self.subTest(table=path):
                self.assertIn(("table", *path.split(".")), seen)
        for element in schema_sheet.ELEMENTS:
            self.assertIn(("table", "look", element), seen)
        for group, key in [(g, k) for g in ("cols", "rows") for k in ("style", "hidden", "level", "collapsed")]:
            with self.subTest(group=group, key=key):
                self.assertTrue(any(p[0] == group and p[-1] == key for p in seen))
        self.assertTrue(any(p[0] == "rows" and p[-1] == "height" for p in seen))
        self.assertTrue(any(p[0] == "rows" and p[-1] == "exact" for p in seen))

    def test_every_named_value_is_shown(self) -> None:
        text_ops = ("contains", "notContains", "begins", "ends")
        checks = {
            "underline": ((*v2.UNDERLINES, *v2.ACCOUNTING, "none"), under("styles", "*", "font", "underline")),
            "strike": (("single", "double", "none"), under("styles", "*", "font", "strike")),
            "script": (("super", "sub", "none"), under("styles", "*", "font", "script")),
            "pattern": (schema_sheet.PATTERNS, under("styles", "*", "fill", "pattern")),
            "h": (
                ("general", "left", "center", "right", "fill", "justify", "centerAcross", "distributed"),
                under("styles", "*", "align", "h"),
            ),
            "v": (("top", "middle", "bottom", "justify", "distributed"), under("styles", "*", "align", "v")),
            "wrap": (("wrap", "overflow", "clip"), under("styles", "*", "align", "wrap")),
            "dir": (("context", "ltr", "rtl"), under("styles", "*", "align", "dir")),
            "kind": (
                ("any", "whole", "decimal", "list", "date", "time", "textLength", "custom", "checkbox"),
                under("validation", "*", "kind"),
            ),
            "validation op": (schema_sheet.OPS, under("validation", "*", "op")),
            "alert": (("stop", "warning", "information"), under("validation", "*", "alert")),
            "type": (tuple(schema_sheet.TYPES), under("conditional", "*", "type")),
            "cell op": (schema_sheet.OPS + text_ops, under("conditional", "*", "op")),
            "period": (schema_sheet.PERIODS, under("conditional", "*", "period")),
            "icon set": (schema_sheet.ICON_SETS, under("conditional", "*", "set")),
            "axis": (("auto", "middle", "none"), under("conditional", "*", "axis")),
            "scale at": (schema_sheet.AT, under("conditional", "*", "stops", "[]", "at")),
            "scope": (("table", "page"), under("names", "*", "scope")),
        }
        for name, (wanted, found) in checks.items():
            with self.subTest(value=name):
                self.assertEqual(sorted(set(wanted) - found), [])

    def test_every_border_style_and_side_is_shown(self) -> None:
        shown = set().union(*(under("styles", "*", "border", side, "style") for side in SIDES))
        self.assertEqual(sorted(set(schema_sheet.CELL_BORDERS) - shown), [])
        for side in SIDES:
            self.assertTrue(under("styles", "*", "border", side, "style"), side)

    def test_error_tokens_and_the_shapes_of_cached_values(self) -> None:
        values = [(path, value) for _, sheet in valid_sheets() for path, value in walk(sheet.get("values", {}))]
        tokens = {value for path, value in values if path[-1:] == ("e",)}
        self.assertTrue({"#DIV/0!", "#SPILL!"} <= tokens)
        self.assertTrue(tokens - set(schema_base.ERRORS), "an error token that no reader knows is kept (R-SHT-17)")
        kinds = {"error" if isinstance(v, dict) else type(v).__name__ for p, v in values if len(p) == 2}
        self.assertEqual(sorted(kinds), ["NoneType", "bool", "error", "float", "int", "str"])


class ValueTest(unittest.TestCase):
    """The ranges of spec 6.3, restated apart from the reader."""

    RANGES = {
        ("font", "size"): (1, 1638, "0.5"),
        ("font", "weight"): (100, 900, "100"),
        ("border", "*", "width"): (0.25, 6, "0.125"),
        ("pad", "*"): (0, 1584, "0.05"),
        ("align", "rotate"): (-90, 90, "1"),
        ("align", "indent"): (0, 15, "1"),
        ("fill", "gradient", "stops", "[]", "at"): (0, 1, "0.0001"),
    }

    def ranged(self) -> list[tuple[str, tuple, object, tuple]]:
        found = []
        for name, sid, style in styles():
            for path, value in walk(style):
                found += [(name, path, value, rng) for pat, rng in self.RANGES.items() if matches(pat, path)]
        return found

    def test_numbers_of_the_valid_styles_are_in_range(self) -> None:
        for name, path, value, (lo, hi, step) in self.ranged():
            with self.subTest(case=name, path=path):
                self.assertTrue(value == "stacked" or on_step(value, lo, hi, step), value)

    def test_gradients_have_2_to_8_stops_and_an_angle_below_360(self) -> None:
        gradients = [(n, s["fill"]["gradient"]) for n, _, s in styles() if "gradient" in (s.get("fill") or {})]
        self.assertTrue(gradients)
        for name, gradient in gradients:
            with self.subTest(case=name):
                self.assertTrue(2 <= len(gradient["stops"]) <= 8)
                self.assertEqual([s["at"] for s in gradient["stops"]], sorted(s["at"] for s in gradient["stops"]))
                self.assertTrue(0 <= gradient.get("angle", 0) <= 359)

    def test_row_and_column_settings_are_in_range(self) -> None:
        entries = [(n, e) for n, sheet in valid_sheets() for k in ("rows", "cols") for e in sheet.get(k, {}).values()]
        for name, entry in entries:
            with self.subTest(case=name):
                self.assertTrue(on_step(entry.get("height", 1), 1, 10000, "0.01"))
                self.assertTrue(0 <= entry.get("level", 0) <= 7)

    def test_conditional_formats_are_in_range(self) -> None:
        rules = [(n, rid, r) for n, sheet in valid_sheets() for rid, r in sheet.get("conditional", {}).items()]
        for name, rid, rule in rules:
            with self.subTest(case=name, rule=rid):
                self.assertTrue(SHORT_ID.fullmatch(rid))
                self.assertTrue(1 <= rule["order"] <= 256)
                self.assertTrue(1 <= rule.get("rank", 1) <= 1000)
                self.assertTrue(0 <= rule.get("stdDev", 0) <= 3)
                self.assertEqual(len(rule.get("thresholds", [0] * icons(rule))), icons(rule))
                self.assertIn(len(rule.get("stops", [0, 0])), (2, 3))

    def test_validation_rules_are_in_range(self) -> None:
        rules = [(n, rid, r) for n, sheet in valid_sheets() for rid, r in sheet.get("validation", {}).items()]
        for name, rid, rule in rules:
            with self.subTest(case=name, rule=rid):
                self.assertTrue(SHORT_ID.fullmatch(rid))
                self.assertTrue(1 <= len(rule["ranges"]) <= 64)
                self.assertTrue(len(rule.get("items", [""])) <= 1000)

    def test_ids_are_ids(self) -> None:
        ids = [(n, key, k) for n, sheet in valid_sheets() for key in ("cols", "rows", "cells", "notes", "values")
               for k in sheet.get(key, {})]
        for name, key, eid in ids:
            with self.subTest(case=name, map=key):
                self.assertTrue(v2.ID.fullmatch(eid), eid)
        ids = [(n, mid) for n, sheet in valid_sheets() for mid in sheet.get("merges", {})]
        for name, mid in ids:
            with self.subTest(case=name):
                self.assertTrue(SHORT_ID.fullmatch(mid))

    def test_style_ids_are_the_ones_a_writer_derives(self) -> None:
        for name, sheet in valid_sheets():
            with self.subTest(case=name):
                taken: dict = {}
                for sid, style in sheet.get("styles", {}).items():
                    self.assertEqual(v2.style_id(style, taken), sid)
                    taken[sid] = style

    def test_every_style_that_a_cell_or_rule_names_is_in_the_sheet(self) -> None:
        for name, sheet in valid_sheets():
            named = {sid for by_col in sheet.get("cells", {}).values() for sid in by_col.values()}
            named |= {e["style"] for k in ("cols", "rows") for e in sheet.get(k, {}).values() if "style" in e}
            named |= {r["style"] for r in sheet.get("conditional", {}).values() if "style" in r}
            named |= {sid for path, sid in walk(sheet.get("table", {})) if path[-1:] == ("style",)}
            named |= set(sheet.get("table", {}).get("look", {}).values()) if isinstance(
                sheet.get("table", {}).get("look"), dict) else set()
            with self.subTest(case=name):
                self.assertEqual(sorted(named - set(sheet.get("styles", {}))), [])

    def test_the_keys_of_a_sheet_are_in_code_point_order(self) -> None:
        objects = [(n, p, v) for n, sheet in valid_sheets() for p, v in walk(sheet) if isinstance(v, dict)]
        for name, path, value in objects:
            with self.subTest(case=name, path=path):
                self.assertEqual(list(value), sorted(value), "R-JSON-1")

    def test_cached_values_come_with_the_version_of_the_data(self) -> None:
        for name, case in cases().items():
            with self.subTest(case=name):
                if sheet_of(case).get("values") and not case.get("problems"):
                    self.assertIn("v", sheet_of(case))
                    self.assertEqual(v2.stamp(case["page"])["formatVersion"], 2)

    def test_entries_for_missing_rows_are_not_a_problem(self) -> None:
        case = load(FOLDER / "beta8-after.json")  # R-SHT-2: they are ignored, never invalid
        self.assertTrue(v2.orphans(case["page"]["blocks"][0]["data"]))
        self.assertEqual(schema_v2.page_problems(case["page"]), [])


class Beta8Test(unittest.TestCase):
    """A page that Beta 8 wrote has `data.smart` and no `data.sheet`, and a reader of version 1 keeps all of it."""

    SMART = {"columns", "filters", "charts", "view", "sort", "saved", "savedActive"}
    COLUMN = {"type", "decimals", "currency", "total", "choices", "options", "multi", "unit", "notation"}
    CHART = {"id", "kind", "x", "series", "aggregate", "stacked", "patterns", "title", "summary", "rows"}

    def setUp(self) -> None:
        self.case = load(FOLDER / "beta8-smart.json")
        self.page = self.case["page"]
        self.data = self.page["blocks"][0]["data"]

    def test_it_stays_at_version_1(self) -> None:
        self.assertEqual(self.page["formatVersion"], 1)
        self.assertEqual(v2.stamp(self.page), {"formatVersion": 1, "minReaderVersion": 1, "minWriterVersion": 1})
        self.assertEqual(self.case["stamp"], v2.stamp(self.page))
        self.assertEqual(v2.read_permission(self.page, 1), "edit")
        self.assertNotIn("sheet", self.data)

    def test_it_holds_formulas_and_keeps_their_old_results(self) -> None:
        self.assertTrue(v2.formula_cells(self.data), "formulas are cell text in Beta 8")
        self.assertEqual(v2.stamp(self.page)["formatVersion"], 1, "no `v`, so no version 2 engine (R-SHT-4)")

    def test_every_key_of_smart_is_shown(self) -> None:
        smart = self.data["smart"]
        self.assertEqual(set(smart), self.SMART)
        self.assertEqual(self.case["expect"]["smartKeys"], sorted(smart))
        self.assertEqual(set().union(*(set(c) for c in smart["columns"].values())), self.COLUMN)
        self.assertEqual(set().union(*(set(c) for c in smart["charts"])), self.CHART)
        types = {c["type"] for c in smart["columns"].values()}
        self.assertEqual(types, {"choice", "currency", "checkbox", "date", "number", "percent"})
        self.assertTrue(set(smart["columns"]) <= {c["id"] for c in self.data["columns"]}, "smart names columns by ID")

    def test_a_reader_of_version_1_writes_it_back_unchanged(self) -> None:
        written = json.loads(canonical_json.write_page(self.page))
        self.assertEqual(written, self.page)
        self.assertEqual(written["blocks"][0]["data"]["smart"], self.data["smart"])
        self.assertTrue(self.case["expect"]["roundTrip"])

    def test_smart_and_sheet_sit_side_by_side(self) -> None:
        data = load(FOLDER / "smart-and-sheet.json")["page"]["blocks"][0]["data"]
        self.assertTrue("smart" in data and "sheet" in data and "smart" not in data["sheet"])
        self.assertEqual(v2.fingerprint(data), data["sheet"]["valuesOf"])
        stale = load(FOLDER / "smart-edited-stale.json")["page"]["blocks"][0]["data"]
        self.assertNotEqual(v2.fingerprint(stale), stale["sheet"]["valuesOf"])
        self.assertFalse(v2.values_fresh(stale))


if __name__ == "__main__":
    unittest.main()
