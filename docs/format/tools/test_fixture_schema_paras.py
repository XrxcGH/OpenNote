"""Fixture schema and stamping checks for the paras, downlevel, and table-sheet folders (spec 15.6, Appendix B.6).

The inline fixtures have their own schema test. This one checks that every page fixture has the fields its folder
needs, that each case cites rule IDs the spec defines, that the stamping rows the lane pins hold, and that every
version 1 fixture is byte for byte what origin/beta has (spec 7.8).

Run it with `python -m unittest discover -s docs/format/tools -p "test_*.py" -v` from the repository.
"""

import hashlib
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import format_v2 as v2  # noqa: E402
import schema_v2  # noqa: E402

DOCS = Path(__file__).resolve().parents[1]
FIXTURES = DOCS / "fixtures"
REPO = DOCS.parents[1]
PARAS = FIXTURES / "markdown" / "paras"
DOWN = FIXTURES / "markdown" / "downlevel" / "cases.json"
SHEET = FIXTURES / "table-sheet"
STAMP_KEYS = ["formatVersion", "minReaderVersion", "minWriterVersion"]
RULE = re.compile(r"^R-[A-Z]+-[0-9]+$")


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def spec_rules() -> set[str]:
    return set(re.findall(r"`(R-[A-Z]+-[0-9]+)`", (DOCS / "README.md").read_text(encoding="utf-8")))


def git(*args: str) -> bytes | None:
    try:
        done = subprocess.run(["git", *args], cwd=REPO, capture_output=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return None
    return done.stdout


def base_ref() -> str | None:
    for ref in ("origin/beta", "beta"):
        if git("rev-parse", "--verify", "--quiet", ref) is not None:
            return ref
    return None


def paras_cases() -> list[dict]:
    return [{**case, "page": load(PARAS / case["file"])} for case in load(PARAS / "cases.json")["cases"]]


def page_fixtures() -> list[dict]:
    return paras_cases() + load(DOWN)["cases"] + [load(path) for path in sorted(SHEET.glob("*.json"))]


def keys_of(node, seen: set[str]) -> set[str]:
    if isinstance(node, dict):
        for key, value in node.items():
            seen.add(key)
            keys_of(value, seen)
    elif isinstance(node, list):
        for value in node:
            keys_of(value, seen)
    return seen


class FieldsTest(unittest.TestCase):
    def test_every_case_has_its_fields_and_cites_rules(self) -> None:
        rules = spec_rules()
        names = set()
        for case in page_fixtures():
            name = case.get("name")
            with self.subTest(case=name):
                self.assertIsInstance(name, str)
                self.assertNotIn(name, names, "case names are unique")
                names.add(name)
                self.assertTrue(case.get("rules"), "a case cites its rule IDs")
                for rule in case["rules"]:
                    self.assertRegex(rule, RULE)
                    self.assertIn(rule, rules)
                self.assertEqual(sorted(case["stamp"]), STAMP_KEYS)
                self.assertTrue(all(isinstance(n, int) and n >= 1 for n in case["stamp"].values()))
                page = case["page"]
                self.assertEqual(page["kind"], "opennote.page")
                self.assertIsInstance(page["blocks"], list)

    def test_stamp_ranges(self) -> None:
        broken = []
        for case in page_fixtures():
            stamp = case["stamp"]
            if not stamp["minReaderVersion"] <= stamp["minWriterVersion"] <= stamp["formatVersion"]:
                broken.append(case["name"])
        # Only the two cases that show a file with inconsistent keys (spec 15.2, R-VER-3) keep them as they are.
        self.assertEqual(broken, ["minWriterVersion above formatVersion", "minWriterVersion below minReaderVersion"])

    def test_there_is_a_case_for_each_data_the_lane_names(self) -> None:
        seen: set[str] = set()
        for case in paras_cases():
            keys_of(case["page"], seen)
        wanted = {"paras", "lists", "layout", "styles", "theme", "text", "print", "header", "footer"}
        self.assertEqual(sorted(wanted - seen), [])
        down: set[str] = set()
        for case in load(DOWN)["cases"]:
            keys_of(case["page"], down)
        keys_of(load(PARAS / "styles.json"), down)
        text = json.dumps(load(DOWN)) + json.dumps(load(PARAS / "styles.json"))
        for key in ("notes", "comments", "suggestions", "stylesChanged"):
            self.assertIn(key, down | seen, key)
        self.assertIn('"break"', text)

    def test_values_respect_the_ranges(self) -> None:
        for case in page_fixtures():
            with self.subTest(case=case["name"]):
                found = schema_v2.page_problems(case["page"])
                self.assertEqual(sorted(found), sorted(case.get("problems", [])))


class NotebookColorTest(unittest.TestCase):
    """R-COL-1 and R-STY-2: a theme color sits only in textColor, so a version 1 reader still opens the notebook."""

    # What the Beta 8 core accepts in a color field (crates/core Color::parse): a lowercase name or a hex color.
    V1_PARSE = re.compile(r"[a-z][a-z0-9-]*|#(?:[0-9a-fA-F]{2}){3,4}")

    def test_theme_colors_stay_out_of_version_1_keys(self) -> None:
        notebook = load(PARAS / "notebook-theme-color.json")
        self.assertEqual(schema_v2.notebook_problems(notebook), [])
        self.assertEqual(notebook["formatVersion"], 1)
        themed = 0
        for name, style in notebook["styles"].items():
            with self.subTest(style=name):
                if "color" in style:
                    self.assertRegex(style["color"], self.V1_PARSE)
                    self.assertEqual(style["color"], style["textColor"])
                else:
                    themed += 1
                    self.assertTrue(style["textColor"].startswith("theme:"))
        self.assertGreater(themed, 0)

    def test_a_theme_color_in_the_version_1_key_is_a_problem(self) -> None:
        notebook = {"styles": {"h1": {"color": "theme:accent1"}}}
        self.assertEqual(len(schema_v2.notebook_problems(notebook)), 1)


class StampingTest(unittest.TestCase):
    ONE = {"formatVersion": 1, "minReaderVersion": 1, "minWriterVersion": 1}
    TWO = {"formatVersion": 2, "minReaderVersion": 1, "minWriterVersion": 2}

    def test_the_rows_the_lane_pins(self) -> None:
        down = {case["name"]: case for case in load(DOWN)["cases"]}
        sheet = {case["name"]: case for case in map(load, SHEET.glob("*.json"))}
        rows = [
            (down["paras only"], self.ONE, "R-STAMP-2"),
            (down["a font span"], self.TWO, "R-STAMP-8"),
            (down["sheet styles only"], self.ONE, "R-STAMP-6"),
            (down["sheet merges"], self.TWO, "R-STAMP-12"),
            (down["sheet v and one formula"], self.TWO, "R-STAMP-13"),
            (down["a code project block"], self.ONE, "R-STAMP-7"),
            (sheet["cached values"], self.TWO, "R-STAMP-12"),
        ]
        for case, stamp, rule in rows:
            with self.subTest(case=case["name"]):
                self.assertEqual(case["stamp"], stamp)
                self.assertIn(rule, case["rules"])
                self.assertEqual(v2.stamp(case["page"]), stamp)

    def test_every_stamp_matches_the_reference_stamper(self) -> None:
        for case in page_fixtures():
            with self.subTest(case=case["name"]):
                self.assertEqual(v2.stamp(case["page"]), case["stamp"])

    def test_pages_of_version_1_stay_version_1(self) -> None:
        for case in paras_cases():
            with self.subTest(case=case["name"]):
                self.assertEqual(case["page"]["formatVersion"], 1)
                self.assertEqual(case["stamp"], self.ONE)


class VersionOneBytesTest(unittest.TestCase):
    """Every version 1 fixture is byte for byte what origin/beta has. documents/cases.json may only gain cases."""

    def test_version_1_files_are_byte_identical_to_the_base_branch(self) -> None:
        ref = base_ref()
        if ref is None:
            self.skipTest("no origin/beta ref to compare with")
        listing = git("ls-tree", "-r", "--name-only", ref, "docs/format/fixtures")
        self.assertIsNotNone(listing)
        files = [line for line in listing.decode().splitlines() if line]
        self.assertGreater(len(files), 20)
        for name in files:
            old = git("show", f"{ref}:{name}")
            new_path = REPO / name
            with self.subTest(file=name):
                self.assertTrue(new_path.exists(), "a version 1 fixture was removed")
                new = new_path.read_bytes()
                if name.endswith("markdown/documents/cases.json"):
                    old_cases = json.loads(old)["cases"]
                    new_cases = json.loads(new)["cases"]
                    self.assertEqual(new_cases[: len(old_cases)], old_cases, "documents/cases.json may only gain cases")
                elif name.endswith(("fixtures/README.md", "markdown/documents/README.md")):
                    continue  # the prose indexes of the folders may grow
                else:
                    self.assertEqual(hashlib.sha256(new).hexdigest(), hashlib.sha256(old).hexdigest())


if __name__ == "__main__":
    unittest.main()
