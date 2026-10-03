# Pens

This folder holds what a pen is made of: its brand colors, its tools, and how pressure and tilt turn into line width. It has no React, no browser calls, and no platform code, so a worker or a Node test can load it.

## What it does

- `palette.ts` reads the seven pen colors and five highlighter colors from `brand/tokens.json` through the generated tokens module. Each color has a slot number that a stroke stores (1 to 7 for the pens, 32 to 36 for the highlighters, 0 for a custom color). The slot lets the dark theme draw a pen with its dark value.
- `tools.ts` numbers the tools as a stroke record does, lists the width presets of the Draw tab in millimeters, and converts millimeters to page units.
- `width.ts` gives the drawn width at a point from its pressure and tilt, the same width the outline draws. It also sizes the hover circle that shows where ink will land.

## Public API

Import from the feature's `index.ts`.

| Name                                                                      | Use                                                         |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `PENS`, `HIGHLIGHTERS`, `PALETTE`, `paletteEntry(slot)`                   | The color pickers and the recolor menu                      |
| `resolveColor(style, scheme)`                                             | The color to draw for a theme. Use it for every stroke fill |
| `toCss(rgba)`, `parseHex(hex)`, `alphaOf(rgba)`                           | Canvas fills, SVG paths, and the highlighter mask           |
| `TOOL_CODES`, `toolFromCode(byte)`, `isKnownToolCode(byte)`               | Reading and writing the tool byte                           |
| `WIDTH_PRESETS_MM`, `DEFAULT_WIDTH_MM`, `mmToPage(mm)`, `pageToMm(units)` | The width picker                                            |
| `widthAt(tool, nominal, point, options)`                                  | The pressure meter and the preview pad                      |
| `minWidthFactor(tool)`, `maxWidthFactor(tool)`                            | Boxes that must hold the widest part of a stroke            |
| `penHoverPreview(nominal, zoom)`, `eraserHoverPreview(radius, zoom)`      | The pen hover cursor (design 5.7)                           |

## What the interface needs

- Pass the page's color scheme to `resolveColor` whenever it draws or exports a stroke. A custom color has slot 0 and draws as stored in both themes.
- Show names from `PALETTE` through the interface strings, because a screen reader announces each pen by name. The names in the tokens are brand names, not translated text.
- Highlighter colors carry their alpha (40 percent). The live canvas applies that alpha once for the whole stroke, so overlaps do not darken (design 6.4).
- The hover circle is a CSS cursor up to 32 pixels for pens and 128 pixels for the eraser. Larger sizes come back with `ring` set, and the live canvas draws them.
