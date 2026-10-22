"""Build OpenNote Sans: Atkinson Hyperlegible Next with an open (unslashed) zero.

Atkinson Hyperlegible Next draws a slash through 0 in its default glyph; it has no OpenType
feature that turns the slash off. This script keeps every other glyph, metric and feature, and
replaces only the zero's split inner counter with one clean counter. The counter is the outer
contour mapped by an affine fit to the zero's own unslashed counter arcs, fitted again at every
weight master so the stroke stays the designed thickness from 200 to 800.

The font is SIL OFL 1.1 (no Reserved Font Name). The modified font gets its own family name.
Run: py brand/fonts/open-zero.py   (needs fontTools and brotli; reads the npm package files)
"""
import os
import numpy as np
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import GlyphCoordinates
from fontTools.varLib.iup import iup_delta

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'node_modules', '@fontsource-variable', 'atkinson-hyperlegible-next', 'files')
OUT = os.path.join(ROOT, 'app', 'src', 'theme', 'fonts')

# Point indices in each source zero: outer contour range, and the clean inner arcs with the outer
# points they correspond to (bottom->left-middle arc, plus the top and right-middle on-curve points).
LAYOUT = {
    'normal': dict(outer=16, pairs=[(0, 16), (1, 26), (2, 25), (3, 24), (4, 23), (8, 36), (12, 31)]),
    'italic': dict(outer=20, pairs=[(0, 20), (1, 31), (2, 30), (3, 29), (4, 28), (10, 41), (14, 37)]),
}


def fit(points, outer_n, pairs):
    src = np.array([[*points[o], 1.0] for o, _ in pairs])
    dst = np.array([points[i] for _, i in pairs])
    a, *_ = np.linalg.lstsq(src, dst, rcond=None)
    outer = np.array([[*p, 1.0] for p in points[:outer_n]])
    inner = outer @ a
    return inner[::-1], float(np.abs(src @ a - dst).max())  # reversed: counters run the other way


def build(style):
    lay = LAYOUT[style]
    font = TTFont(os.path.join(SRC, f'atkinson-hyperlegible-next-latin-wght-{style}.woff2'))
    glyf, gvar = font['glyf'], font['gvar']
    zero = glyf['zero']
    coords, ends, flags = zero.getCoordinates(glyf)
    n = len(coords)
    base = np.array(list(coords), dtype=float)
    outer_n = lay['outer']
    inner0, err = fit(base, outer_n, lay['pairs'])
    print(style, 'default fit error', round(err, 2))
    new_flags = list(flags[:outer_n]) + list(flags[:outer_n])[::-1]
    new_default = np.vstack([base[:outer_n], inner0])
    for var in gvar.variations['zero']:
        full = iup_delta(var.coordinates[:n], list(coords), ends) if None in var.coordinates[:n] else var.coordinates[:n]
        at = base + np.array(full, dtype=float)
        inner, err = fit(at, outer_n, lay['pairs'])
        print(style, var.axes, 'fit error', round(err, 2))
        delta = np.vstack([at[:outer_n], inner]) - new_default
        var.coordinates = [tuple(int(round(v)) for v in d) for d in delta] + list(var.coordinates[n:])
    zero.coordinates = GlyphCoordinates([tuple(int(round(v)) for v in p) for p in new_default])
    zero.flags = bytearray(new_flags)
    zero.endPtsOfContours = [outer_n - 1, 2 * outer_n - 1]
    zero.numberOfContours = 2
    zero.program.fromBytecode(b'')
    zero.recalcBounds(glyf)
    for rec in font['name'].names:
        if rec.nameID in (0, 13, 14):
            continue
        text = rec.toUnicode()
        renamed = text.replace('Atkinson Hyperlegible Next', 'OpenNote Sans').replace('AtkinsonHyperlegibleNext', 'OpenNoteSans')
        if renamed != text:
            rec.string = renamed
    font['name'].setName('Modified from Atkinson Hyperlegible Next 2.001: open (unslashed) zero.', 10, 3, 1, 0x409)
    font.flavor = 'woff2'
    os.makedirs(OUT, exist_ok=True)
    font.save(os.path.join(OUT, f'opennote-sans-latin-wght-{style}.woff2'))


for s in LAYOUT:
    build(s)
