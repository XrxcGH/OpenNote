"""Runs the reference reader against the shared fixtures (spec Appendix B.6). Owned by WP1.

Run it with `python -m unittest discover -s docs/format/tools -p "test_*.py" -v` from the repository.
"""

import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import read_opennote  # noqa: E402
from ink_segments import SegmentError, decode_points, decode_segment  # noqa: E402
from markdown_text import escape_text  # noqa: E402
from readable_text import fixed  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
SPEC = Path(__file__).resolve().parents[1] / "README.md"


class ReferenceReaderTest(unittest.TestCase):
    """The reference reader's output matches the expected files of every fixture notebook."""

    def test_reads_the_version_1_fixture_notebook(self) -> None:
        """Reads docs/format/fixtures/nb/v1 and compares the Markdown and SVG files it writes."""
        notebook = FIXTURES / "nb" / "v1"
        with tempfile.TemporaryDirectory() as out:
            self.assertEqual(read_opennote.main(["read_opennote.py", str(notebook), out]), 0)
            written = sorted(p.relative_to(out).as_posix() for p in Path(out).rglob("*") if p.is_file())
            self.assertEqual(len(written), 9)
            for path in written:
                with self.subTest(path=path):
                    expected = (notebook / path).read_bytes().decode("utf-8")
                    self.assertEqual((Path(out) / path).read_bytes().decode("utf-8"), expected)

    def test_reads_the_example_of_the_spec(self) -> None:
        """Writes the page.md of spec 11.1, with the checksum of Appendix B.4, and the ink.svg of spec 11.3."""
        folder = FIXTURES / "readable" / "spec-example"
        page = read_opennote.read_json(folder / "page.json")
        strokes = read_opennote.load_strokes(folder, page)
        self.assertEqual(len(strokes), 1)
        page_md = read_opennote.render_page_md(page, strokes, lambda target: None)
        self.assertEqual(page_md, (folder / "page.md").read_text(encoding="utf-8"))
        self.assertIn('checksum: "crc32:d69a2039"', page_md)
        svg = read_opennote.render_ink_svg(page, strokes)
        self.assertEqual(svg, (folder / "ink.svg").read_text(encoding="utf-8"))

    def test_segments_decode_as_the_ink_fixtures_record(self) -> None:
        """Decodes every segment in docs/format/fixtures/ink and compares the result or the error."""
        cases = sorted((FIXTURES / "ink").glob("*.json"))
        self.assertGreaterEqual(len(cases), 10)
        for path in cases:
            with self.subTest(case=path.name):
                self.check_ink_case(json.loads(path.read_text(encoding="utf-8")))

    def check_ink_case(self, case: dict) -> None:
        """Decodes one ink fixture and compares the result, or the kind of error."""
        data = (FIXTURES / "ink" / case["file"]).read_bytes()
        if "error" not in case:
            self.assertEqual(decode_segment(data, case["expect"], case["page"]), case["result"])
            return
        with self.assertRaises(SegmentError) as raised:
            decode_segment(data, case["expect"], case["page"])
        self.assertEqual(raised.exception.kind, case["error"])

    def test_the_segment_fixture_is_the_vector_of_appendix_b2(self) -> None:
        """The hex dump of spec Appendix B.2 is the fixture segment, byte for byte."""
        spec = SPEC.read_text(encoding="utf-8")
        block = spec[spec.index("### B.2 A segment file") :]
        block = block[block.index("```text\n") + 8 :]
        block = block[: block.index("```")]
        data = bytearray()
        for line in block.splitlines():
            for token in line.split()[1:]:
                if not re.fullmatch(r"[0-9a-f]{2}", token):
                    break
                data.append(int(token, 16))
        self.assertEqual(bytes(data), (FIXTURES / "ink" / "appendix-b2.onk").read_bytes())

    def test_points_of_the_worked_example(self) -> None:
        """Decodes the 20 bytes of spec 9.7."""
        data = bytes.fromhex("800a8014808002004080 01bc142a60c001dc1e29".replace(" ", ""))
        points = decode_points(data, 3, 5)
        expected = [[640, 1280, 32768, 0], [672, 1344, 34078, 42], [720, 1440, 36044, 83]]
        self.assertEqual([p[:3] + p[5:] for p in points], expected)
        with self.assertRaises(ValueError):
            decode_points(data, 2, 5)

    def test_escaping_matches_the_fixtures(self) -> None:
        """Escapes every text of docs/format/fixtures/markdown/escape as the Rust escaper does."""
        cases = json.loads((FIXTURES / "markdown" / "escape" / "cases.json").read_text(encoding="utf-8"))["cases"]
        self.assertGreaterEqual(len(cases), 20)
        for case in cases:
            with self.subTest(text=case["text"], at_line_start=case["atLineStart"]):
                self.assertEqual(escape_text(case["text"], case["atLineStart"]), case["escaped"])

    def test_readable_copies_follow_the_rules_of_spec_11(self) -> None:
        """Decorative images, empty titles, and unknown blocks, which the fixture notebook doesn't show."""
        page = read_opennote.read_json(FIXTURES / "readable" / "spec-example" / "page.json")
        page["title"] = ""
        page["blocks"][1]["data"]["decorative"] = True
        page["blocks"][3].pop("fallback")
        page_md = read_opennote.render_page_md(page, {}, lambda target: None)
        self.assertIn("---\n\n![Handwriting on this page](ink.svg)", page_md)
        self.assertIn("\n![](assets/01m3sa43z1tp9rdr5e8df2jbxy-leaf-section.png)\n", page_md)
        self.assertTrue(page_md.endswith(f"\n{read_opennote.NEWER_VERSION_LINE}\n"))
        self.assertEqual(fixed(-0.004, 2), "0")
        self.assertEqual(fixed(17.25, 1), "17.3")
        self.assertEqual(fixed(1122.52, 2), "1122.52")


if __name__ == "__main__":
    unittest.main()
