# Paper backgrounds

This folder draws the paper under a page: plain, ruled, grid, dot grid, isometric, Cornell, music staff, and templates (lab notebook, planner, storyboard, and custom ones). Each generator turns a `PageBackground` into vector paths in page units (1/96 inch), and `paperSvg` turns the paths into SVG. The screen and the PDF export use the same code, so printed paper is the paper on screen. There is no DOM and no React here.

## Public API

All of it is re-exported from `features/pages`.

| Name                                                                           | Purpose                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paperPaths(bg, geometry)`                                                     | The paths of one sheet of paper: hairlines, dividers, dots, the margin line, tinted areas, and labels                                                                                 |
| `infinitePaths(bg, tile, geometry)`                                            | The same for a tile of an infinite canvas. Lines continue past the edge of any tile, so tiles join without a seam                                                                     |
| `paperSvg(paths, view, bg, style)`                                             | SVG for the paths, colored by token names (`PaperStyle`) so the theme decides the colors. Pen colors on a page map to the palette                                                     |
| `tokenVar(name)`                                                               | A token name as a CSS variable reference                                                                                                                                              |
| `PRESETS`, `SPACINGS`, `withSpacing(bg, spacing)`                              | The presets people choose from (ruled narrow, college, wide; grids at 5 mm, 1/4 in, and 1 cm; dots; isometric; Cornell; staff) and a custom spacing within the range a pattern allows |
| `spacingOf(bg)`, `DEFAULT_SPACING`                                             | The spacing a background uses, with the 7 mm default                                                                                                                                  |
| `flowGeometry(geometry, bg)`                                                   | The geometry the flow of text uses. Only Cornell paper changes it: text fills the notes area                                                                                          |
| `CORNELL`, `cornellAreas(geometry)`                                            | The cue column, notes area, and summary area of Cornell paper                                                                                                                         |
| `labNotebook(text)`, `planner(text)`, `storyboard(name, area)`, `TEMPLATE_IDS` | Built-in templates. The caller passes the labels, so the strings stay in `app/src/strings`                                                                                            |
| `MAX_ELEMENTS`, `MAX_LABEL`                                                    | The limits a template reader enforces (format spec 4.5)                                                                                                                               |

## Rules worth knowing

- **A template is stored in the page** (`background.template`), so the page is complete without the app that made it. A reader keeps at most 200 elements, skips kinds it does not know, and clamps positions to the area. Template positions are fractions of an area, so one template fits any paper.
- **Unknown patterns draw as plain.** A page from a newer writer keeps its value.
- **Lines never get denser than 6 pixels apart on screen.** The zoom module's `lineEvery` decides which lines to skip at a zoom (see [zoom](../zoom/README.md)).
- **Colors are tokens.** `paperSvg` writes CSS variable references, not colors, so the dark theme needs no new paper. Print uses the light theme's values and no page color.
- **No borders.** Paper is vector paths, so layout never depends on the screen's pixel density (ADR 0006, rule 1).

## Tests

`patterns.test.ts` checks line counts and positions for each pattern, and that tiles join. `cornell.test.ts`, `templates.test.ts`, and `svg.test.ts` check the Cornell areas, the built-in templates and reader limits, and the SVG output.

## What the UI wiring needs

1. The page view draws `paperSvg(paperPaths(...))` once for each visible sheet, or tiles of `infinitePaths` on a canvas, behind the content. Cache the SVG for each background and geometry.
2. The page setup dialog lists `PRESETS` and templates, shows a spacing field for the ones that take it, and writes the choice with `setBackground` from the layout module.
3. Strings for the preset names and for the template labels belong in `app/src/strings`.
