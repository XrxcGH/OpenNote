# Writes the pinned name list from the Unicode Character Database that ships with Python (one "HEX;NAME" line per
# assigned code point in the ranges below). Run it only to move the pin to a new Unicode release:
#   py scripts/unicode/extract-names.py > scripts/unicode/ucd-subset.txt
# The ranges must stay in step with BLOCKS in generate.ts.
import sys
import unicodedata

sys.stdout.reconfigure(newline=chr(10))

RANGES = [
    (0x0020, 0x00FF), (0x0100, 0x024F), (0x0370, 0x03FF), (0x0400, 0x04FF), (0x2000, 0x218F),
    (0x2190, 0x23FF), (0x2500, 0x27FF), (0x2900, 0x297F), (0x2B00, 0x2BFF), (0x1F300, 0x1F64F),
    (0x1F680, 0x1F6FF), (0x1F900, 0x1F9FF),
]
header = "# Unicode Character Database " + unicodedata.unidata_version
header += ", names of the symbol subset. See LICENSE-UNICODE.txt."
sys.stdout.write(header + chr(10))
for lo, hi in RANGES:
    for cp in range(lo, hi + 1):
        try:
            name = unicodedata.name(chr(cp))
        except ValueError:
            continue
        sys.stdout.write("%04X;%s\n" % (cp, name))
