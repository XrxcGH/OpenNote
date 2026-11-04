"""Checks the limits of spec section 16 for `data.sheet`: a case at its boundary passes, and one past it does not.

The cases are in `fixtures/table-sheet/limits/cases.json`, and `sheet_limits.py` builds their pages. Run it with
`python -m unittest discover -s docs/format/tools -p "test_*.py" -v` from the repository.
"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import format_v2 as v2  # noqa: E402
import schema_v2  # noqa: E402
import sheet_limits  # noqa: E402

FORMAT = Path(__file__).resolve().parents[1]
FILE = json.loads((FORMAT / "fixtures" / "table-sheet" / "limits" / "cases.json").read_text(encoding="utf-8"))
SPEC = (FORMAT / "README.md").read_text(encoding="utf-8")
# What the spec writes for each boundary: the number, or 64 KiB for a note.
WRITTEN = {
    4096: "4,096", 10000: "10,000", 1024: "1,024", 256: "256", 1000000: "1,000,000", 255: "255", 8192: "8,192",
    32767: "32,767", 64: "64", 1000: "1,000", 32: "32", 65536: "64 KiB", 32768: "64 KiB",
}  # fmt: skip
WANTED = {
    "4,096 styles", "10,000 merges", "1,024 names", "256 validation rules", "256 conditional formats",
    "10,000 cell notes", "1,024 links", "1,000,000 cells", "a name of 255 characters",
    "a name's formula of 8,192 characters", "a cached string of 32,767 characters",
    "a validation formula of 8,192 characters", "64 ranges in a rule", "1,000 items in a list",
    "a note of 65,536 bytes", "a number format of 255 characters",
}  # fmt: skip


class LimitsTest(unittest.TestCase):
    def test_every_limit_of_the_spec_has_a_case(self) -> None:
        names = [case["name"] for case in FILE["cases"]]
        self.assertEqual(sorted(WANTED - set(names)), [])
        self.assertEqual(len(names), len(set(names)), "names are unique")

    def test_the_boundaries_are_the_numbers_of_the_spec(self) -> None:
        row = next(line for line in SPEC.splitlines() if line.startswith("| Spreadsheet data (version 2)"))
        for number in ("4,096 styles", "10,000 merges", "256 validation rules", "256 conditional formats"):
            self.assertIn(number, row)
        for number in ("1,024 names", "10,000 cell notes", "1,024 links", "1,000,000 cells"):
            self.assertIn(number, row)
        for case in FILE["cases"]:
            with self.subTest(case=case["name"]):
                self.assertEqual(case["past"], case["at"] + 1)
                self.assertIn(case["at"], WRITTEN, "a limit that the spec does not state")
                self.assertIn(WRITTEN[case["at"]], SPEC)

    def test_a_page_at_the_limit_passes_and_one_past_it_does_not(self) -> None:
        for case in FILE["cases"]:
            with self.subTest(case=case["name"]):
                at = sheet_limits.build(case, FILE["page"], case["at"])
                self.assertEqual(schema_v2.page_problems(at), [])
                self.assertEqual(v2.stamp(at), case["stamp"])
                over = sheet_limits.build(case, FILE["page"], case["past"])
                self.assertTrue(case["problems"])
                self.assertEqual(schema_v2.page_problems(over), case["problems"])
                self.assertEqual(v2.stamp(over), case["stamp"])

    def test_the_directives_build_what_they_say(self) -> None:
        expand = sheet_limits.expand
        self.assertEqual(expand({"$chars": "ab", "count": 3}, 0), "ababab")
        self.assertEqual(expand({"$limit": 1}, 5), 6)
        self.assertEqual(expand({"$list": {"count": "limit", "value": 7}}, 3), [7, 7, 7])
        made = expand({"$map": {"count": 2, "key": "k%02d", "value": {"$limit": 0}}}, 9)
        self.assertEqual(made, {"k01": 9, "k02": 9})
        cells = expand({"$cells": {"count": 5, "perRow": 2, "value": "a"}}, 0)
        self.assertEqual([len(by_col) for by_col in cells.values()], [2, 2, 1])
        self.assertEqual(list(cells), sorted(cells))

    def test_a_note_is_counted_in_bytes(self) -> None:
        case = next(c for c in FILE["cases"] if "two-byte" in c["name"])
        for limit, fits in ((case["at"], True), (case["past"], False)):
            page = sheet_limits.build(case, FILE["page"], limit)
            note = next(iter(next(iter(page["blocks"][0]["data"]["sheet"]["notes"].values())).values()))
            self.assertEqual(len(note["markdown"].encode("utf-8")) <= 65536, fits)


if __name__ == "__main__":
    unittest.main()
