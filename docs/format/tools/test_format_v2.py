"""Runs the reference tools against the fixtures of format version 2 (spec Appendix B.6).

Run it with `python -m unittest discover -s docs/format/tools -p "test_*.py" -v` from the repository.
"""

import hashlib
import json
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import canonical_json  # noqa: E402
import format_v2 as v2  # noqa: E402
import schema_v2  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
SPEC = Path(__file__).resolve().parents[1] / "README.md"
TOOLS = Path(__file__).resolve().parent
INLINE = FIXTURES / "markdown" / "inline-v2" / "cases.json"
PARAS = FIXTURES / "markdown" / "paras"
DOWN = FIXTURES / "markdown" / "downlevel" / "cases.json"
SHEET = FIXTURES / "table-sheet"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def inline_cases() -> list[dict]:
    return load(INLINE)["cases"]


def page_cases() -> list[dict]:
    """Every case of the version 2 folders that holds a page, with the page loaded."""
    cases = []
    for case in load(PARAS / "cases.json")["cases"]:
        cases.append({**case, "page": load(PARAS / case["file"])})
    cases += load(DOWN)["cases"]
    cases += [load(path) for path in sorted(SHEET.glob("*.json"))]
    return cases


def every_case() -> list[dict]:
    cases = inline_cases() + page_cases()
    return cases + [load(PARAS / "styles.json"), load(PARAS / "layers.json")]


def tree(content: list[dict]) -> list[dict]:
    return v2.normalize(content)


class InlineTest(unittest.TestCase):
    """Markdown 2 reads as its tree, and the tree writes back as canonical Markdown (spec 7.9 to 7.13)."""

    def test_there_are_enough_cases(self) -> None:
        cases = inline_cases()
        self.assertGreaterEqual(len(cases), 120)
        self.assertGreaterEqual(sum(1 for c in cases if c.get("hostile")), 20)
        foreign = [c for c in cases if "foreign" in json.dumps(c["tree"])]
        self.assertGreaterEqual(len(foreign), 40)

    def test_markdown_reads_as_its_tree(self) -> None:
        for case in inline_cases():
            with self.subTest(case=case["name"]):
                self.assertEqual(tree(v2.read_inline(case["markdown"])), tree(case["tree"][0]["content"]))

    def test_the_tree_writes_canonical_markdown(self) -> None:
        for case in inline_cases():
            with self.subTest(case=case["name"]):
                written = v2.write_inline(case["tree"][0]["content"])
                self.assertEqual(written, case.get("canonical", case["markdown"]))
                self.assertEqual(tree(v2.read_inline(written)), tree(case["tree"][0]["content"]))
                for other in case.get("alsoWrittenFrom", []):
                    self.assertEqual(v2.write_paragraphs(other), case["markdown"])

    def test_stamps(self) -> None:
        for case in inline_cases():
            with self.subTest(case=case["name"]):
                page = {"blocks": [{"type": "text", "data": {"markdown": case["markdown"]}}]}
                self.assertEqual(v2.stamp(page), case["stamp"])

    def test_hostile_tags_are_literal_in_the_tree(self) -> None:
        for case in inline_cases():
            if case.get("hostile"):
                with self.subTest(case=case["name"]):
                    content = case["tree"][0]["content"]
                    self.assertTrue(all(not node.get("marks") for node in content if "text" in node))
                    self.assertIn("<", case["text"])


class SchemaTest(unittest.TestCase):
    """Every fixture case has the fields its folder needs, and its values respect the ranges of the spec."""

    def test_every_case_has_its_fields(self) -> None:
        names = set()
        for case in every_case():
            with self.subTest(case=case.get("name")):
                self.assertIsInstance(case.get("name"), str)
                self.assertTrue(case.get("rules"), "a case names the rules it tests")
                stamp = case.get("stamp")
                self.assertEqual(sorted(stamp), ["formatVersion", "minReaderVersion", "minWriterVersion"])
                self.assertTrue(all(isinstance(x, int) and x >= 1 for x in stamp.values()))
                names.add(case["name"])
        for case in inline_cases():
            with self.subTest(case=case["name"]):
                self.assertIsInstance(case["markdown"], str)
                self.assertIsInstance(case["text"], str)
                self.assertEqual([block["type"] for block in case["tree"]], ["paragraph"])

    def test_tree_marks_respect_their_grammars(self) -> None:
        for case in inline_cases():
            for node in case["tree"][0]["content"]:
                for mark in node.get("marks", []):
                    with self.subTest(case=case["name"], mark=mark):
                        self.assertTrue(schema_v2.tree_mark_ok(mark))

    def test_pages_have_only_the_problems_they_name(self) -> None:
        for case in page_cases():
            with self.subTest(case=case["name"]):
                found = schema_v2.page_problems(case["page"])
                self.assertEqual(sorted(found), sorted(case.get("problems", [])))

    def test_notebook_styles_are_valid(self) -> None:
        for copy in load(PARAS / "styles.json")["copies"]:
            self.assertEqual(schema_v2.notebook_problems(copy), [])

    def test_every_rule_is_named_by_a_fixture(self) -> None:
        spec = set(re.findall(r"`(R-[A-Z]+-[0-9]+)`", SPEC.read_text(encoding="utf-8")))
        named = {rule for case in every_case() for rule in case["rules"]}
        self.assertEqual(sorted(named - spec), [], "fixtures name rules that the spec does not have")
        self.assertEqual(sorted(spec - named), [], "rules of the spec that no fixture names")


class VersionOneTest(unittest.TestCase):
    """The version 1 fixtures never change, and version 1 data of version 2 stays version 1."""

    def test_version_1_markdown_fixtures_are_unchanged(self) -> None:
        manifest = load(TOOLS / "v1_fixtures.json")
        escape = (FIXTURES / "markdown" / "escape" / "cases.json").read_bytes()
        self.assertEqual(hashlib.sha256(escape).hexdigest(), manifest["escape/cases.json"])
        cases = load(FIXTURES / "markdown" / "documents" / "cases.json")["cases"]
        expected = manifest["documents/cases.json"]
        self.assertGreaterEqual(len(cases), len(expected))
        for case, digest in zip(cases, expected):
            with self.subTest(case=digest["name"]):
                self.assertEqual(case["name"], digest["name"])
                self.assertEqual(hashlib.sha256(v2.compact_json(case).encode()).hexdigest(), digest["sha256"])

    def test_a_version_1_writer_keeps_the_pages_byte_for_byte(self) -> None:
        for case in load(PARAS / "cases.json")["cases"]:
            with self.subTest(case=case["name"]):
                raw = (PARAS / case["file"]).read_text(encoding="utf-8")
                self.assertEqual(canonical_json.write_page(json.loads(raw)), raw)
                self.assertEqual(v2.stamp(json.loads(raw)), case["stamp"])

    def test_ignored_keys(self) -> None:
        for case in load(PARAS / "cases.json")["cases"]:
            page = load(PARAS / case["file"])
            ignored = []
            for block in page["blocks"]:
                data = block["data"]
                ids = set(data.get("ids", []))
                if block["type"] == "text":
                    ignored += [f"paras.{key}" for key in data.get("paras", {}) if key not in ids]
            with self.subTest(case=case["name"]):
                self.assertEqual(ignored, case.get("ignored", []))

    def test_the_canonical_writer_matches_the_version_1_notebook(self) -> None:
        """canonical_json knows text and table blocks: pages with only those are written as the Rust core wrote them."""
        checked = 0
        for path in sorted((FIXTURES / "nb" / "v1").rglob("page.json")):
            page = load(path)
            simple = all(block["type"] in ("text", "table") for block in page.get("blocks", []))
            if page.get("kind") == "opennote.page" and simple and not page.get("assets"):
                self.assertEqual(canonical_json.write_page(page), path.read_text(encoding="utf-8"), path)
                checked += 1
        self.assertGreaterEqual(checked, 3)


class StylesTest(unittest.TestCase):
    def test_style_chains_and_merges(self) -> None:
        case = load(PARAS / "styles.json")
        a, b = case["copies"]
        self.assertEqual(v2.merge_styles(a, b), case["merged"])
        for name, chain in case["chains"].items():
            with self.subTest(chain=name):
                self.assertEqual(v2.style_chain(chain["styles"], chain["name"]), chain["chain"])


class StampTest(unittest.TestCase):
    """Spec 15.2 and 15.6: the stamp a writer gives a page, and what each reader does with it."""

    def test_stamps_and_readers(self) -> None:
        for case in load(DOWN)["cases"]:
            with self.subTest(case=case["name"]):
                self.assertEqual(v2.stamp(case["page"]), case["stamp"])
                for reader, does in case["readers"].items():
                    self.assertEqual(v2.read_permission(case["page"], int(reader)), does)
                if "upgrades" in case:
                    self.assertEqual(case["stamp"]["formatVersion"] > case["page"]["formatVersion"], case["upgrades"])

    def test_the_rows_the_lane_pins(self) -> None:
        cases = {case["name"]: case["stamp"] for case in load(DOWN)["cases"]}
        one = {"formatVersion": 1, "minReaderVersion": 1, "minWriterVersion": 1}
        two = {"formatVersion": 2, "minReaderVersion": 1, "minWriterVersion": 2}
        self.assertEqual(cases["paras only"], one)
        self.assertEqual(cases["a font span"], two)
        self.assertEqual(cases["sheet styles only"], one)
        self.assertEqual(cases["sheet merges"], two)
        self.assertEqual(cases["sheet v and one formula"], two)
        self.assertEqual(cases["a code project block"], one)


class SheetTest(unittest.TestCase):
    """Spec 6.3: what a reader computes from `data.sheet`."""

    def test_there_is_a_case_for_every_key(self) -> None:
        keys = set()
        for path in SHEET.glob("*.json"):
            keys |= set(load(path)["page"]["blocks"][0]["data"].get("sheet", {}))
        self.assertEqual(sorted(keys), sorted(schema_v2.SHEET_KEYS))
        self.assertTrue((SHEET / "beta8-after.json").exists())

    def test_what_a_reader_computes(self) -> None:
        for path in sorted(SHEET.glob("*.json")):
            case = load(path)
            data = case["page"]["blocks"][0]["data"]
            with self.subTest(case=case["name"]):
                self.assertEqual(v2.stamp(case["page"]), case["stamp"])
                expect = case.get("expect", {})
                if "formulaCells" in expect:
                    self.assertEqual(v2.formula_cells(data), expect["formulaCells"])
                if "activeMerges" in expect:
                    self.assertEqual(v2.active_merges(data), expect["activeMerges"])
                if "fresh" in expect:
                    self.assertEqual(v2.values_fresh(data), expect["fresh"])
                if "fingerprint" in expect:
                    self.assertEqual(v2.fingerprint(data), expect["fingerprint"])
                if "orphans" in expect:
                    self.assertEqual(v2.orphans(data), expect["orphans"])
                for item in expect.get("styleIds", []):
                    self.assertEqual(v2.style_id(item["style"], item["taken"]), item["id"])
                if "applyOrder" in expect:
                    rules = data["sheet"]["conditional"]
                    order = sorted(rules, key=lambda rule_id: (rules[rule_id]["order"], rule_id))
                    self.assertEqual(order, expect["applyOrder"])

    def test_fnv1a_64(self) -> None:
        self.assertEqual(v2.fnv1a64(b""), 0xCBF29CE484222325)
        self.assertEqual(v2.fnv1a64(b"a"), 0xAF63DC4C8601EC8C)


if __name__ == "__main__":
    unittest.main()
