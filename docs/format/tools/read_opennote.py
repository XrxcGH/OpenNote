"""Reads an OpenNote notebook with only the Python standard library (spec Appendix B.6). Owned by WP1.

It turns a notebook into Markdown and SVG files. That shows the specification is enough to read a notebook
without OpenNote's code.
"""

import sys


def main(argv: list[str]) -> int:
    """Reads the notebook folder in argv[1] and writes readable files into the folder in argv[2]."""
    raise NotImplementedError(f"WP1: read_opennote ({len(argv)} arguments)")


if __name__ == "__main__":
    sys.exit(main(sys.argv))
