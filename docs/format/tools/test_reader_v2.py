"""Runs the reference reader on version 2 text (spec 7.13 and 11.1). Kept apart from `test_read_opennote`, so the
version 1 reader tests run even when a version 2 module is broken.

Run it with `python -m unittest discover -s docs/format/tools -p "test_*.py" -v` from the repository.
"""

import json
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import read_opennote  # noqa: E402
from format_v2 import read_inline, readable_text  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
V2_TAGS = FIXTURES / "readable" / "v2-tags"


class ReadableTextTest(unittest.TestCase):
    def test_inline_v2_reads_to_its_readable_text(self) -> None:
        """Every case of docs/format/fixtures/markdown/inline-v2 reads to its text: tags drop and keep their content,
        and hostile tags stay literal (spec 7.9 and 7.13)."""
        cases = json.loads((FIXTURES / "markdown" / "inline-v2" / "cases.json").read_text(encoding="utf-8"))["cases"]
        self.assertGreaterEqual(len(cases), 120)
        for case in cases:
            with self.subTest(case=case["name"]):
                self.assertEqual(readable_text(case["markdown"]), case["text"])
                self.assertEqual(readable_text(case.get("canonical", case["markdown"])), case["text"])
                if case.get("hostile"):
                    self.assertEqual(case["text"].count("<"), case["markdown"].count("<"), "every tag stays literal")


class PageMdTest(unittest.TestCase):
    def test_a_version_2_page_drops_its_tags_and_keeps_their_content(self) -> None:
        """page.md of docs/format/fixtures/readable/v2-tags, worked by hand from spec 11.1: the tags of 7.9, foreign
        tags, and footnote references drop; the tags of 7.4, code, fences, and literal tags stay."""
        page = read_opennote.read_json(V2_TAGS / "page.json")
        page_md = read_opennote.render_page_md(page, {}, lambda target: None)
        self.assertEqual(page_md, (V2_TAGS / "page.md").read_text(encoding="utf-8"))

    def test_a_version_1_page_keeps_its_markdown_as_it_is(self) -> None:
        """A version 1 reader sees every tag of version 2 as text (section 7.9), so a version 1 page copies it."""
        page = read_opennote.read_json(V2_TAGS / "page.json")
        page["formatVersion"] = 1
        page_md = read_opennote.render_page_md(page, {}, lambda target: None)
        self.assertIn(page["blocks"][0]["data"]["markdown"], page_md)
        self.assertIn('| a\\|b | <del data-by="x">old</del> new |', page_md)


class HostileTest(unittest.TestCase):
    def test_many_tags_read_in_linear_time(self) -> None:
        """10,000 pairs, flat and nested, under the 4 MiB block limit (section 16), read in a few seconds at most.
        Finding the depth of each pair by scanning every other pair took minutes here (R-INL-12)."""
        flat = '<span data-zz="1">x</span>' * 10_000
        nested = '<span data-zz="1">' * 10_000 + "x" + "</span>" * 10_000
        for name, text in (("flat", flat), ("nested", nested)):
            with self.subTest(case=name):
                start = time.perf_counter()
                content = read_inline(text)
                self.assertLess(time.perf_counter() - start, 10.0)
                self.assertEqual(readable_text(text).count("x"), 10_000 if name == "flat" else 1)
                self.assertTrue(content)
        self.assertEqual(readable_text(nested).count("<span"), 10_000 - 32, "pairs deeper than 32 stay literal")


if __name__ == "__main__":
    unittest.main()
