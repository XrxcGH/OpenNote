"""Make the TrueType copies of the bundled fonts that a Word file can embed.

The app bundles its fonts as WOFF2 (app/src/theme/fonts and the @fontsource npm packages). Word embeds only
TrueType or OpenType files (ECMA-376 Part 1, 17.8.3), so this script decompresses the Latin subset of each face
into this folder. The glyphs and tables stay as they are. One change: the npm static files of Atkinson
Hyperlegible Mono name the family "Atkinson Hyperlegible Mono ExtraLight" in every weight, so the copies get the
upstream family name back, which Word needs to match the embedded file to the document's font.

Run from the repository root after npm ci: py crates/interop/fonts/make_sfnt_copies.py
It needs fontTools and brotli (py -m pip install fonttools brotli).
"""

from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
THEME = ROOT / "app" / "src" / "theme" / "fonts"
NPM = ROOT / "node_modules"

STYLES = {
    ("400", "normal"): "regular",
    ("400", "italic"): "italic",
    ("700", "normal"): "bold",
    ("700", "italic"): "bold-italic",
}

# (output name, source file). Variable families have one file per slope; the wght axis stays in the file.
FACES = [
    ("opennote-sans-regular", THEME / "opennote-sans-latin-wght-normal.woff2"),
    ("opennote-sans-italic", THEME / "opennote-sans-latin-wght-italic.woff2"),
    ("literata-regular", NPM / "@fontsource-variable/literata/files/literata-latin-wght-normal.woff2"),
    ("literata-italic", NPM / "@fontsource-variable/literata/files/literata-latin-wght-italic.woff2"),
]
for (weight, slope), style in STYLES.items():
    mono = f"@fontsource/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-{weight}-{slope}.woff2"
    FACES.append((f"atkinson-hyperlegible-mono-{style}", NPM / mono))
    FACES.append((f"carlito-{style}", THEME / f"carlito-latin-{weight}-{slope}.woff2"))
    FACES.append((f"caladea-{style}", THEME / f"caladea-latin-{weight}-{slope}.woff2"))

RENAMES = [
    ("Atkinson Hyperlegible Mono ExtraLight", "Atkinson Hyperlegible Mono"),
    ("AtkinsonHyperlegibleMonoExtraLight", "AtkinsonHyperlegibleMono"),
]


def main() -> None:
    for name, source in FACES:
        font = TTFont(source)
        font.flavor = None
        for record in font["name"].names:
            text = record.toUnicode()
            for old, new in RENAMES:
                text = text.replace(old, new)
            record.string = text
        font.save(OUT / f"{name}.ttf", reorderTables=True)
        print(name)


if __name__ == "__main__":
    main()
