# ADR 0006: PDF export

- Status: Accepted
- Date: 2026-09-30

## Context

Phase 6 of the [development plan](../../DEVELOPMENT.md#phase-6-page-views-and-export) adds a paginated view and promises print and PDF export that match it exactly. Ink must stay vector graphics, and golden tests must compare exported PDFs with approved images. The [performance budgets](../../BRAND.md#10-comfort-and-performance-budgets) add a rule: export runs in the background and never blocks drawing or typing.

Tauri shows the interface in Microsoft Edge WebView2, which can print a page to PDF itself with `ICoreWebView2_7::PrintToPdf`. The [Phase 1](../../DEVELOPMENT.md#phase-1-spikes) spike asked whether that output matches the paginated page on screen. The spike code is in `spikes/`, and its results are in `spikes/results/pdf.json`.

## Decision

We will export and print PDFs with WebView2's `PrintToPdf`, called from a hidden second WebView that renders the paginated view. Print CSS maps each sheet to one page: an `@page` rule with the sheet size and no margins, and no desk, gaps, or shadows. Four rules come with it:

1. Nothing that affects layout may depend on the screen's pixel density. Table and block rules use inset shadows, backgrounds, or SVG, never borders.
2. Each paper size uses the width Chromium writes for it, so `PrintToPdf` never shrinks the page to fit. For A4 in WebView2 154, that is 594.96 points. Phase 6 checks it for each paper size and WebView2 update.
3. The screen and export use the same font files. Variable fonts embed as Type 3 fonts, so Phase 6 tests static builds of the note fonts. The app ships them if they embed as TrueType and keep the same line breaks.
4. Golden tests compare geometry after thresholding, not exact pixels. They allow 1 pixel for ink and page offsets and 2 pixels for 96-pixel tiles. Light content, such as paper rules and table fills, needs its own lower threshold or color masks.

## Measurements

The spike ran on a Surface Laptop Studio 2 with Windows 11 Pro 25H2 (build 26200.9550), WebView2 154.0.4258.37, and a 2400 × 1600 screen at 150% and 120 Hz. The results file says Windows 10, because that is the product name Windows 11 still stores. Other spikes shared the machine, which adds noise to the timings.

### How it was measured

The page shows five sheets of lecture notes on Letter and A4 paper, with 1-inch margins. They hold headings, text in all three bundled fonts (two variable, one static), tables, a PNG image, 83 pen strokes as SVG paths, and ruled, Cornell, and dot paper. They also have two manual page breaks and a group that must stay together. `npm run spikes -- pdf --auto` then:

1. Captures each sheet with the DevTools Protocol at 144 DPI, the screen's own density at 150%, where 1 pixel is 0.18 mm.
2. Exports the page from the visible WebView with `PrintToPdf` and with the DevTools Protocol's `Page.printToPDF`. It renders each PDF page at 144 DPI with Windows.Data.Pdf.
3. Finds how far each PDF page is shifted from its sheet, from row and column ink profiles and from 96-pixel tiles. It also counts ink (darkness 128 or more) with no ink within 1 pixel in the other image.
4. Reads each PDF with lopdf for page sizes, filled paths by pen color, images, and fonts.
5. Times exports of 1, 10, and 50 sheets, five runs each after a first run, while the visible page records its frame gaps. The time for `PrintToPdf` ends when its completion handler runs, after the file is written. The time for `Page.printToPDF` ends when its base64 reply is decoded, before the file is written.

The baseline style is plain CSS. The adjusted style applies rules 1 and 2 of the decision.

### Fidelity

| Style | Paper | Route | Page size (pt) | Largest offset (px) | Largest tile shift (px) | Tiles within 1 px | Worst page: ink more than 1 px off |
|---|---|---|---|---|---|---|---|
| Baseline | Letter | Both | 612 × 792 | 5.84 | 6 | 78.5% | 34.3% |
| Baseline | A4 | `PrintToPdf` | 594.96 × 841.92 | 5.21 | 6 | 77.2% | 31.5% |
| Baseline | A4 | `Page.printToPDF` | 594.96 × 841.92 | 5.87 | 6 | 76.6% | 34.3% |
| Adjusted | Letter | Both | 612 × 792 | 0.18 | 1 | 100% | 0.7% |
| Adjusted | A4 | Both | 594.96 × 841.92 | 0.79 | 2 | 99.1% | 2.6% |

Tiles are searched only up to 6 pixels, so the baseline's tile shift of 6 may be larger.

- **Pages and breaks.** Every export had 5 pages for 5 sheets. Both manual breaks and the keep-together group landed on the same pages as on screen.
- **Borders cause the baseline shift.** At 150%, a 1-pixel border snaps to 0.67 CSS pixels on screen but stays 1 pixel in print. Each table row grows in the PDF, so text below the 11-row table moved 5.8 pixels.
- **A4 is 0.32 points narrow.** Both routes wrote A4 pages 594.96 points wide, not 595.28. `PrintToPdf` then shrank the page by 0.05%, moving its far edges by up to 0.7 pixels.
- **Small offsets remain.** Adjusted Letter pages are off by at most 0.18 pixels, likely from pixel snapping: the screen snaps to device pixels, and print to CSS pixels. Adjusted A4 page 3 drifts from 0.28 pixels at the top to 0.79 at the bottom. Of its 64 inked tiles, 55 are shifted. The cause wasn't isolated; A4's fractional sheet height (1122.52 CSS pixels) is one suspect.
- **Antialiasing always differs.** Adjusted pages differ by 0.35 to 2.4 levels (of 255) on average. On most, 3% to 16% of ink pixels differ in exact position, but 26% do on A4 page 3. On adjusted pages, the two routes differ by at most 0.003 levels. Without rule 2, A4 routes differ by up to 2.2 levels, because `PrintToPdf` shrinks the page.
- **Ink stays vector.** All 83 strokes, including a 40% highlighter, are filled paths in their pen colors. The only image is the PNG. A page corner shows the paper color, so backgrounds print. No metric checks table fills, table rules, or the paper patterns, which are lighter than the ink threshold.
- **Variable fonts become Type 3.** Chromium embeds both variable fonts as glyph outlines (Type 3 fonts) with ToUnicode maps, so text stays searchable. Only the static mono font is a real TrueType font (FontFile2). Whether Type 3 fonts hurt file size or rendering in other viewers wasn't tested.
- **Print events fire.** `beforeprint` and `afterprint` fired once per export on both routes.

### Speed and responsiveness

| Letter pages | Where | `PrintToPdf` median (s) | `Page.printToPDF` median (s) | Longest frame gap, median run (ms) | Longest task, median run (ms) | File (MB) |
|---|---|---|---|---|---|---|
| 1 | Visible WebView | 0.49 | 0.48 | 9 | 0 | 0.1 |
| 10 | Visible WebView | 1.40 | 1.53 | 108 | 114 | 1.4 |
| 50 | Visible WebView | 4.68 | 5.82 | 475 | 471 | 8.8 |
| 50 | Hidden WebView | 6.25 | Not tried | 8.6 | 0 | Not recorded |

The last three columns are for `PrintToPdf`. A4 `PrintToPdf` times were within about 8% of Letter, and `Page.printToPDF` times within 11%. With nothing exporting, the visible page's longest gap was 8.7 ms, one frame at 120 Hz.

Printing lays out every page on the page's main thread. In the visible WebView, 1-page exports stalled the page for up to 25 ms, and 5-page exports for up to 50 ms, with one 52 ms task. That can break the 16 ms typing budget at any length, and it reaches the 50 ms feedback budget at about 5 pages.

Exporting from the hidden WebView kept the visible page's frame gaps at the idle level. But those exports took 34% longer, and the hidden page's layout took three times as long (1.33 s against 0.45 s). The cause wasn't isolated.

### Limitations

- One fast machine, with other spikes running. Export times varied more than length explains. The same five sheets took 321 to 356 ms with the baseline style but 831 to 918 ms with the adjusted one. One adjusted sheet took 486 ms (median). The reference laptop must repeat the timings.
- Only 150% scaling was tested. The reference laptop runs at 125%, so the residual offsets and test thresholds must be measured again at 100%, 125%, and 200% before Phase 6 adopts them.
- Fidelity was measured only for exports from the visible WebView. Exports from the hidden WebView were timed and page-counted but not compared with the screen.
- The visible page was idle during the hidden export. Ink and typing latency under export load weren't measured.
- Windows.Data.Pdf enlarges requested images by 1.4 on this screen, so the harness measures the factor and corrects for it. After rendering, a process took 20 minutes to exit, so the harness now ends itself.
- The paginator never splits a block, and no static version of the note fonts was tested.
- The spike didn't check the hidden WebView's renderer process or memory, print on paper, or open the PDFs in other viewers.

## Options considered

| Option | For | Against |
|---|---|---|
| `PrintToPdf` in a hidden WebView (chosen) | The same layout as the screen, so pages match. The API Tauri apps use. The visible page keeps drawing. | A second WebView costs memory. Exports take about a third longer (6.25 s against 4.68 s for 50 pages). Variable fonts become Type 3 fonts. |
| `PrintToPdf` in the visible WebView | Simplest; no second WebView | Stalls the page for up to 50 ms at 5 pages and half a second at 50 |
| DevTools Protocol `Page.printToPDF` | Same output; keeps A4 at scale 1 without rule 2 | A debugging interface, not a print API; up to 24% slower |
| Write PDFs from the document model in Rust | Full control over fonts and file size | A second layout engine that must copy Chromium's line breaks, so it drifts from the screen |
| Do nothing (browser print only) | No work | No control over pages or file names, and no golden tests |

## Consequences

- The paginated view and the PDF come from one layout, so page breaks, keep-together groups, and manual breaks land on the same pages.
- Rules 1 and 2 need a lint or test in Phase 6, because one table with borders shifts every line below it.
- Regression tests compare each exported page with its approved image from the same renderer. Screen tests fail when over 3% of ink is more than 1 pixel off, a tile moves over 2 pixels, or a page moves over 1 pixel. The adjusted pages pass, and the border bug fails all three. The thresholds sit just above A4 page 3 (2.6% of ink and a 2-pixel tile), so they leave little margin.
- The Phase 6 test line in DEVELOPMENT.md, which says "pixel by pixel," needs the same change as rule 4.
- CI needs a PDF renderer. Windows.Data.Pdf should run in a child process with a timeout, or PDFium should replace it.
- Phase 6 follows up on the spike. It tests static fonts and checks their embedding and file size. It compares hidden-WebView PDFs with the visible sheets, and measures that WebView's memory and export time on the reference laptop. It adds line and row splitting to the paginator.
- A person should print a page at 100% and measure it with a ruler. They should also open the PDFs in Acrobat, Edge, and a phone viewer to check text search and copy.
