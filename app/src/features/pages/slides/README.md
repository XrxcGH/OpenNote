# Present as slides

"Present as slides" (FEATURES.md, Phase 6) splits a page at its headings or at its divider lines and shows each part as a full-screen slide. This folder finds the slides and renders one as HTML. It is pure TypeScript with no DOM and no React. The slides are derived from the page each time they are needed, so nothing on the page changes and nothing is stored.

## Public API

All of it is re-exported from `features/pages`.

| Name                             | Purpose                                                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slidesOf(page, options?)`       | The slides of an `ExportPage`. `split` is `headings`, `dividers`, or `both` (the default), and `headingLevel` is the deepest heading that starts a slide (default 2) |
| `slideOfBlock(slides, blockId)`  | The slide a block is on, to start a presentation at the cursor                                                                                                       |
| `moveSlide(index, delta, count)` | The slide an arrow key, Page Down, or a swipe goes to, kept within the deck                                                                                          |
| `slideTitles(slides, fallback)`  | Titles for a slide navigator, with the caller's own words for a slide that has no heading                                                                            |
| `slideHtml(slide, cx, label?)`   | One slide as a `<section class="slide">` with an `aria-label`, using the HTML export's renderers                                                                     |

## Rules

- A heading of level 1 to `headingLevel` starts a slide and is the first thing on it. Deeper headings stay inside the slide. Headings inside quotes, lists, and callouts never split.
- A divider line (`---`) ends a slide and is not shown. Dividers in a row make no empty slides.
- Text before the first heading is a slide with no title. An empty page has no slides.
- Slides follow the page's reading order (format spec 6.2), so a freeform page's text boxes present from top to bottom, then left to right, and the page's own `readingOrder` wins.
- A table, image, drawing, or file stays whole on the slide of the block before it. A text block that continues after a heading in an earlier block joins that slide.

## What the UI wiring needs

1. A "Present as slides" command that calls `slidesOf` with the choice from a small options menu, opens a full-screen surface, and starts at `slideOfBlock(slides, blockAtCursor)`.
2. A surface that renders `slideHtml` for the current slide, scales it to fit the screen, and moves with the arrow keys, Page Up and Page Down, Space, and a swipe through `moveSlide`. Escape leaves. The laser pointer and fading ink come from presentation mode, which draws over the surface.
3. A `BlockContext` for the page (`strokesByBlock(page.strokes)`, the asset URLs, and the English labels or the app's own strings), the same one the HTML export uses.
4. A slide counter and a navigator built with `slideTitles`. Strings for "Slide n" and the counter belong in `app/src/strings`.
5. Ink drawn on a slide during a presentation is presentation ink and is not saved to the page.
