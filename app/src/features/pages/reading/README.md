# Reading aids

The pure parts of the reading view (FEATURES.md, Phase 6, "Reading aids"): a line focus band of 1, 3, or 5 lines, soft page tints, extra word and paragraph spacing, a maximum line width, and syllable breaks. They change only how a page is shown and never the note, so they are a device setting and never reach `page.json`. The code is pure TypeScript with no DOM and no React.

## Public API

All of it is re-exported from `features/pages`.

| Name                                                                   | Purpose                                                                                                                                                        |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readReading(raw)`, `writeReading(aids)`                               | Reads the stored setting (bad values fall back to the default and are reported) and writes only what differs from the default                                  |
| `DEFAULT_READING`, `isActive(aids)`                                    | All aids off, and whether any is on                                                                                                                            |
| `readingStyle(aids)`                                                   | CSS custom properties and a stylesheet for the reading view's root: `--reading-page`, `--reading-word-space`, `--reading-paragraph-space`, `--reading-measure` |
| `tintColor(tint)`, `TINT_MIX`                                          | A tint as a `color-mix` of the page color and a theme color                                                                                                    |
| `focusBand(lines, active, size)`                                       | The band around the active line: first and last line, top and bottom                                                                                           |
| `lineAtY(lines, y)`, `moveFocus(count, active, delta, size?, byBand?)` | Follow the pointer or pen, and step with the keyboard by a line or a whole band                                                                                |
| `dimmedAreas(band, area)`                                              | The two rectangles above and below the band, to dim                                                                                                            |
| `syllables(word, language?)`                                           | The syllables of an English word                                                                                                                               |
| `breakText(text, options?)`, `withoutBreaks(text)`                     | Soft hyphens (or another separator) between the syllables of the words in plain text, and the way back for copying                                             |

## Rules

- **Tints add no colors.** A tint mixes the page color with `accent.clay` (cream 5%, sepia 12%) or `border.control` (gray 10%), so it follows the Evening theme and the brand tokens. The tests check that primary text keeps 7:1 contrast and secondary and muted text 4.5:1 on every tint in both themes. A forced-colors mode ignores the tint.
- **The band keeps its size.** At the first and last line it slides over them, so 5 lines stay 5 lines. A page with fewer lines than the band lights them all.
- **Syllable breaks are a heuristic for English.** They use vowel groups, silent endings, digraphs, and common suffixes, and are right for most common words (`reading.test.ts` lists the ones checked). Other languages are left whole. The soft hyphen lets the browser wrap at a break, and a middle dot shows the break. A breaking dictionary can replace `syllables` without changing the callers.
- **Never break code, links, or addresses.** `breakText` leaves any word with a digit, `@`, `/`, `\`, `_`, or `#` alone, but the view must also skip code blocks and inline code, since this function sees only text.

## What the UI wiring needs

1. A setting in device state (ADR 0013) holding `writeReading(aids)`, and a "Reading view" panel that edits it. Strings for the labels belong in `app/src/strings`.
2. Apply `readingStyle(aids).vars` on the page's root element, add the classes `reading-page` and `reading-text` to the page and its text column, and include `css` once.
3. The focus band needs every text line's top and height in page units, which the page view already measures for pagination (`FlowMeasurer` in `print/dom.ts` is the model). Call `lineAtY` on pointer or pen move, or `moveFocus` on arrow keys, draw the `dimmedAreas` as a translucent overlay with pointer events off, and scroll the active line into view.
4. For syllable breaks, run `breakText` on the text nodes of rendered paragraphs (not on the stored Markdown), and use `withoutBreaks` when copying.
5. The band and tint are display only. They must not appear in print or export.
