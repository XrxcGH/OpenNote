"""Runs the reference reader against the shared fixtures (spec Appendix B.6). Owned by WP1."""

import unittest


class ReferenceReaderTest(unittest.TestCase):
    """The reference reader's output matches the expected files of every fixture notebook."""

    @unittest.skip("WP1 writes the reference reader and its fixtures")
    def test_reads_the_version_1_fixture_notebook(self) -> None:
        """Reads docs/format/fixtures/notebooks/v1 and compares the Markdown and SVG files it writes."""


if __name__ == "__main__":
    unittest.main()
