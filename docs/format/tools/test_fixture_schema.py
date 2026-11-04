"""Checks the shape of every fixture case of format version 2, and that its values respect the ranges of the spec.

The range checks restate the grammars of spec 7.10 and Appendix D here, apart from the reader's code, so a reader
bug can't make a wrong fixture pass. Run it with
`python -m unittest discover -s docs/format/tools -p "test_*.py" -v` from the repository.
"""

import re
import sys
import unittest
from decimal import Decimal, InvalidOperation
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import schema_v2  # noqa: E402
import test_format_v2 as fixtures  # noqa: E402

STAMP_KEYS = ["formatVersion", "minReaderVersion", "minWriterVersion"]

# Number text of R-VAL-1: no sign other than a minus, no leading zeros, no trailing zeros, no exponent.
NUMBER = re.compile(r"-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?")
FONT = re.compile(r"[^\W_][\w .+-]{0,61}[\w.+-]|[^\W_]")  # R-VAL-2, checked further below
ID = re.compile(r"[0-7][0-9a-hjkmnp-tv-z]{25}")
HEX = re.compile(r"#[0-9a-f]{6}")
LANG = re.compile(r"[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?")
PENS = {"ink", "indigo", "brick", "fern", "plum", "amber", "walnut"}
HIGHLIGHTERS = {"honey", "mint", "rose", "apricot", "lilac"}
THEME = {"accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "text", "background"}
UNDERLINES = {
    "double", "words", "thick", "dotted", "dottedHeavy", "dash", "dashedHeavy", "dashLong", "dashLongHeavy",
    "dotDash", "dashDotHeavy", "dotDotDash", "dashDotDotHeavy", "wave", "wavyHeavy", "wavyDouble",
}
OTF = {"clig-none", "dlig", "hlig", "liga-none", "lnum", "onum", "pnum", "tnum", "zero"} | {
    f"ss{n:02d}" for n in range(1, 21)
}
EFFECTS = {"emboss", "engrave", "outline", "shadow"}
BOXES = {"single", "double", "dotted", "dashed", "thick"}
FLAGS = {"strong", "emphasis", "strike", "underline", "highlight", "sub", "sup", "code"}
FOREIGN_ATTR = r" (lang|dir|data-[a-z0-9-]{1,16})=\"[^\"<>&\x00-\x1f\x7f-\x9f]{0,200}\""
FOREIGN = re.compile(r"<(span|u|del|mark|ins|s)(" + FOREIGN_ATTR + r"){1,8}>")


def number(text: str, low: str, high: str, step: str, skip: tuple = ()) -> bool:
    """Whether `text` is a number of R-VAL-1 from `low` to `high` on the grid of `step`, other than `skip`."""
    if not isinstance(text, str) or not NUMBER.fullmatch(text):
        return False
    try:
        value = Decimal(text)
    except InvalidOperation:
        return False
    return Decimal(low) <= value <= Decimal(high) and value % Decimal(step) == 0 and text not in skip


def color(text) -> bool:
    """A color of R-VAL-7: a pen or highlighter name, `#rrggbb` in lowercase, or a theme color."""
    if not isinstance(text, str):
        return False
    if text.startswith("theme:"):
        return text[6:] in THEME
    return text in PENS or text in HIGHLIGHTERS or bool(HEX.fullmatch(text))


def font(text) -> bool:
    if text in ("+body", "+heading", "+mono"):
        return True
    return isinstance(text, str) and 1 <= len(text) <= 63 and bool(FONT.fullmatch(text))


def tokens(text, allowed: set) -> bool:
    if not isinstance(text, str) or not text:
        return False
    parts = text.split(" ")
    return all(parts) and set(parts) <= allowed and parts == sorted(set(parts))


def mark_ok(mark) -> bool:
    """A mark of the neutral tree of inline-v2/README.md, with its value in range."""
    if isinstance(mark, str):
        return mark in FLAGS
    if not isinstance(mark, dict) or len(mark) != 1:
        return False
    key, value = next(iter(mark.items()))
    checks = {
        "link": lambda v: isinstance(v, str),
        "font": font,
        "size": lambda v: v in ("small", "large", "xlarge") or number(v, "1", "1638", "0.5"),
        "weight": lambda v: number(v, "100", "900", "100", ("400", "700")),
        "tracking": lambda v: number(v, "-1584", "1584", "0.05", ("0",)),
        "scale": lambda v: number(v, "1", "600", "1", ("100",)),
        "shift": lambda v: number(v, "-1584", "1584", "0.5", ("0",)),
        "kern": lambda v: v == "0" or number(v, "1", "1638", "0.5"),
        "caps": lambda v: v in ("small", "all"),
        "otf": lambda v: tokens(v, OTF),
        "effect": lambda v: tokens(v, EFFECTS) and not {"emboss", "engrave"} <= set(v.split(" ")),
        "box": lambda v: isinstance(v, dict) and v.get("style") in BOXES and set(v) <= {"style", "color"}
        and ("color" not in v or color(v["color"])),
        "underline": lambda v: isinstance(v, dict) and bool(v) and set(v) <= {"line", "color"}
        and ("line" not in v or v["line"] in UNDERLINES) and ("color" not in v or color(v["color"])),
        "strike": lambda v: v == "double",
        "highlight": lambda v: color(v) and v != "honey",
        "shade": color,
        "color": color,
        "lang": lambda v: isinstance(v, str) and bool(LANG.fullmatch(v)),
        "dir": lambda v: v in ("rtl", "ltr"),
        "comment": lambda v: isinstance(v, str) and bool(ID.fullmatch(v)),
        "ins": lambda v: isinstance(v, str) and bool(ID.fullmatch(v)),
        "del": lambda v: isinstance(v, str) and bool(ID.fullmatch(v)),
        "fmt": lambda v: isinstance(v, str) and bool(ID.fullmatch(v)),
        "style": lambda v: isinstance(v, str) and bool(re.fullmatch(r"u-[a-z0-9-]{1,32}|[a-z][a-zA-Z0-9]{0,31}", v)),
        "foreign": lambda v: isinstance(v, str) and bool(FOREIGN.fullmatch(v)),
        "float": lambda v: v in ("start", "end"),
    }
    return key in checks and checks[key](value)


class FieldsTest(unittest.TestCase):
    """Every case has the fields its folder needs (spec Appendix B.6)."""

    def test_every_case_has_a_name_rules_and_a_stamp(self) -> None:
        names = set()
        for case in fixtures.every_case():
            with self.subTest(case=case.get("name")):
                self.assertIsInstance(case.get("name"), str)
                self.assertTrue(case.get("rules"), "a case names the rules it tests")
                self.assertTrue(all(re.fullmatch(r"R-[A-Z]+-[0-9]+", rule) for rule in case["rules"]))
                stamp = case.get("stamp")
                self.assertEqual(sorted(stamp), STAMP_KEYS)
                self.assertTrue(all(isinstance(x, int) and not isinstance(x, bool) and x >= 1 for x in stamp.values()))
                names.add(case["name"])

    def test_inline_cases_have_markdown_tree_text_and_stamp(self) -> None:
        names = [case["name"] for case in fixtures.inline_cases()]
        self.assertEqual(len(names), len(set(names)), "case names are unique")
        allowed = {"name", "rules", "markdown", "tree", "canonical", "alsoWrittenFrom", "text", "stamp", "hostile"}
        for case in fixtures.inline_cases():
            with self.subTest(case=case["name"]):
                self.assertLessEqual(set(case), allowed)
                self.assertIsInstance(case["markdown"], str)
                self.assertIsInstance(case["text"], str)
                self.assertIsInstance(case.get("canonical", ""), str)
                self.assertIn(case.get("hostile", True), (True,), "hostile is true or absent")
                self.assertEqual([block["type"] for block in case["tree"]], ["paragraph"])
                for node in case["tree"][0]["content"]:
                    self.assertIn(sorted(node), [["marks", "text"], ["footnote", "marks"], ["hardBreak"]])

    def test_inline_stamps_are_in_range(self) -> None:
        """A writer stamps inline Markdown 1 or 2, and minReaderVersion <= minWriterVersion <= formatVersion (15.6)."""
        for case in fixtures.inline_cases():
            with self.subTest(case=case["name"]):
                stamp = case["stamp"]
                self.assertIn(stamp["formatVersion"], (1, 2))
                self.assertLessEqual(stamp["minReaderVersion"], stamp["minWriterVersion"])
                self.assertLessEqual(stamp["minWriterVersion"], stamp["formatVersion"])

    def test_hostile_cases_stamp_version_1(self) -> None:
        """Literal tags are version 1 text: a page that holds only them stays version 1 (R-STAMP-5)."""
        for case in fixtures.inline_cases():
            if case.get("hostile") and not any(n.get("marks") for n in case["tree"][0]["content"]):
                with self.subTest(case=case["name"]):
                    self.assertEqual(case["stamp"]["formatVersion"], 1)


class RangesTest(unittest.TestCase):
    """Every mark of an inline tree respects its range, checked here and by the reader's own grammar."""

    def test_tree_marks_respect_the_stated_ranges(self) -> None:
        nodes = [(case["name"], node) for case in fixtures.inline_cases() for node in case["tree"][0]["content"]]
        for name, mark in [(name, mark) for name, node in nodes for mark in node.get("marks", [])]:
            with self.subTest(case=name, mark=mark):
                self.assertTrue(mark_ok(mark))
                self.assertTrue(schema_v2.tree_mark_ok(mark))
        for name, node in [(name, node) for name, node in nodes if "footnote" in node]:
            with self.subTest(case=name, footnote=node["footnote"]):
                self.assertRegex(node["footnote"], ID)

    def test_the_range_checks_reject_the_boundaries(self) -> None:
        """The checks of this file accept the edges and reject one step past them."""
        good = [{"size": "1"}, {"size": "1.5"}, {"size": "1638"}, {"weight": "100"},
                {"weight": "900"}, {"kern": "0"}, {"tracking": "-1584"}, {"font": "Noto Sans JP 2"}, {"font": "+mono"},
                {"color": "theme:accent6"}, {"strike": "double"}, {"underline": {"line": "wavyDouble"}}]
        bad = [{"size": "1638.5"}, {"size": "0.5"}, {"size": "10.50"}, {"size": "010"}, {"size": "+10.5"},
               {"size": "1e3"}, {"weight": "400"}, {"weight": "700"}, {"weight": "1000"}, {"weight": "150"},
               {"tracking": "0"}, {"scale": "100"}, {"scale": "601"}, {"font": "Georgia "}, {"font": ".Hidden"},
               {"font": "O'Hare Sans"}, {"font": "F" * 64}, {"color": "theme:accent7"}, {"color": "#FFEE00"},
               {"highlight": "honey"}, {"strike": "triple"}, {"underline": {"line": "single"}},
               {"effect": "emboss engrave"}, {"otf": "tnum lnum"}, {"foreign": "<span data-X=\"1\">"}]
        for mark in good:
            with self.subTest(good=mark):
                self.assertTrue(mark_ok(mark))
        for mark in bad:
            with self.subTest(bad=mark):
                self.assertFalse(mark_ok(mark))


class PagesTest(unittest.TestCase):
    """Pages hold only the problems they name, and every rule of the spec has a fixture."""

    def test_pages_have_only_the_problems_they_name(self) -> None:
        for case in fixtures.page_cases():
            with self.subTest(case=case["name"]):
                found = schema_v2.page_problems(case["page"])
                self.assertEqual(sorted(found), sorted(case.get("problems", [])))

    def test_malformed_shapes_are_problems_and_stamp_version_1(self) -> None:
        """Hostile pages of the wrong shape get a problem with a path, and stamping them raises nothing."""
        table = lambda rows: {"blocks": [{"type": "table", "data": {"rows": rows}}]}  # noqa: E731
        cases = {
            "blocks: a list": {"blocks": "x"},
            "blocks[0]: an object": {"blocks": ["x"]},
            "blocks[0].data: an object": {"blocks": [{"type": "table", "data": None}]},
            "blocks[0].data.markdown: a string": {"blocks": [{"type": "text", "data": {"markdown": None}}]},
            "blocks[0].data.rows: a list": table("x"),
            "blocks[0].data.rows[0]: an object": table(["x"]),
            "blocks[0].data.rows[0].cells: an object": table([{"cells": [1]}]),
            "blocks[0].data.rows[0].cells.a: an object with a string markdown": table([{"cells": {"a": "x"}}]),
        }
        for problem, page in cases.items():
            with self.subTest(problem=problem):
                self.assertEqual(schema_v2.page_problems(page), [problem])
                self.assertEqual(schema_v2.v2.stamp(page)["formatVersion"], 1)

    def test_version_keys_of_the_wrong_shape_are_problems(self) -> None:
        """R-VER-2 and R-VER-3: the version keys are integers with 1 ≤ R ≤ W ≤ F."""
        cases = {
            "formatVersion: an integer of at least 1": [{"formatVersion": "2"}, {"formatVersion": 0}],
            "minReaderVersion: an integer from 1 to formatVersion": [
                {"formatVersion": 2, "minReaderVersion": 200},
                {"formatVersion": 2, "minReaderVersion": "1"},
            ],
            "minWriterVersion: an integer from minReaderVersion to formatVersion": [
                {"formatVersion": 2, "minWriterVersion": "x"},
                {"formatVersion": 3, "minReaderVersion": 2, "minWriterVersion": 1},
                {"formatVersion": 3, "minWriterVersion": True},
            ],
        }
        for problem, pages in cases.items():
            for page in pages:
                with self.subTest(page=page):
                    self.assertEqual(schema_v2.page_problems({**page, "blocks": []}), [problem])
        self.assertEqual(schema_v2.page_problems({"formatVersion": 3, "minWriterVersion": 2, "blocks": []}), [])

    def test_reader_computations_skip_wrong_shapes(self) -> None:
        """The computations of spec 6.3 skip what shape_problems reports, so none raises on a hostile table."""
        for rows in ([None, {"cells": None}], "x", [{"id": "r", "cells": {"c": None}}], [{"cells": {"c": "x"}}]):
            data = {"columns": [None, {"id": "c"}], "rows": rows, "sheet": {"cells": {"r": None}, "merges": "x"}}
            with self.subTest(rows=rows):
                self.assertTrue(schema_v2.shape_problems({"blocks": [{"type": "table", "data": data}]}))
                self.assertEqual(schema_v2.v2.formula_cells(data), [])
                self.assertEqual(schema_v2.v2.active_merges(data), [])
                self.assertIsInstance(schema_v2.v2.orphans(data), list)
                self.assertFalse(schema_v2.v2.values_fresh(data))
                self.assertTrue(schema_v2.v2.fingerprint(data).startswith("fnv1a:"))
        for sheet in (None, "x", {"cols": "x", "rows": [1], "notes": {"r": "x"}}):
            self.assertIsInstance(schema_v2.v2.orphans({"rows": [], "sheet": sheet}), list)

    def test_notebook_styles_are_valid(self) -> None:
        for copy in fixtures.load(fixtures.PARAS / "styles.json")["copies"]:
            self.assertEqual(schema_v2.notebook_problems(copy), [])

    def test_every_rule_is_named_by_a_fixture(self) -> None:
        spec = set(re.findall(r"`(R-[A-Z]+-[0-9]+)`", fixtures.SPEC.read_text(encoding="utf-8")))
        named = {rule for case in fixtures.every_case() for rule in case["rules"]}
        self.assertEqual(sorted(named - spec), [], "fixtures name rules that the spec does not have")
        self.assertEqual(sorted(spec - named), [], "rules of the spec that no fixture names")


if __name__ == "__main__":
    unittest.main()
