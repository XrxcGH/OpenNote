# ADR 0006: PDF export

- Status: Proposed
- Date: 2026-09-30

## Context

Phase 6 of the [development plan](../../DEVELOPMENT.md#phase-6-page-views-and-export) adds a paginated view and promises print and PDF export that match it exactly. Ink must stay vector graphics, and golden tests must compare exported PDFs with approved images. The [performance budgets](../../BRAND.md#10-comfort-and-performance-budgets) add a rule: export runs in the background and never blocks drawing or typing.

Tauri shows the interface in Microsoft Edge WebView2, which can print a page to PDF itself with `ICoreWebView2_7::PrintToPdf`. The [Phase 1](../../DEVELOPMENT.md#phase-1-spikes) spike asked whether that output matches the paginated page on screen. The spike code is in `spikes/`, and its results are in `spikes/results/pdf.json`.

## Decision

We will export and print PDFs with WebView2's `PrintToPdf`, called from a hidden second WebView that renders the paginated view. Print CSS maps each sheet to one page: an `@page` rule with the sheet size and no margins, and no desk, gaps, or shadows. Four rules come with it:

1. Nothing that affects layout may depend on the screen's pixel density. Table and block rules use inset shadows, backgrounds, or SVG, never borders.
2. An A4 sheet is 594.96 points wide, the width Chromium writes, so `PrintToPdf` never shrinks the page to fit.
3. The app ships static (not variable) font files, at least for export, so text is embedded as TrueType fonts.
4. Golden tests compare geometry after thresholding, with a 1-pixel tolerance, not exact pixels.

## Measurements

The spike ran on a Surface Laptop Studio 2 with Windows 11 Pro 25H2 (build 26200.9550), WebView2 154.0.4258.37, and a 2400 × 1600 screen at 150% and 120 Hz. The results file says Windows 10, because that is the product name Windows 11 still stores. Other spikes shared the machine, which adds noise to the timings.

### How it was measured

The page shows five sheets of lecture notes on Letter and A4 paper, with 1-inch margins. They hold headings, text in both bundled fonts, tables, a PNG image, 83 pen strokes as SVG paths, and ruled, Cornell, and dot paper. They also have two manual page breaks and a group that must stay together. `npm run spikes -- pdf --auto` then:

1. Captures each sheet with the DevTools Protocol at 144 DPI, the screen's own density at 150%, where 1 pixel is 0.18 mm.
2. Exports the page with `PrintToPdf` and with the DevTools Protocol's `Page.printToPDF`, then renders each PDF page at 144 DPI with Windows.Data.Pdf.
3. Finds how far each PDF page is shifted from its sheet, from row and column ink profiles and from 96-pixel tiles. It also counts ink (darkness 128 or more) with no ink within 1 pixel in the other image.
4. Reads each PDF with lopdf for page sizes, filled paths by pen color, images, and fonts.
5. Times exports of 1, 10, and 50 sheets, five runs each after a first run, while the visible page records its frame gaps.

The baseline style is plain CSS. The adjusted style applies rules 1 and 2 of the decision.

### Fidelity

| Style | Paper | Route | Page size (pt) | Largest offset (px) | Largest tile shift (px) | Tiles within 1 px | Worst page: ink more than 1 px off |
|---|---|---|---|---|---|---|---|
| Baseline | Letter | Both | 612 × 792 | 5.84 | 6 | 78.5% | 34.3% |
| Baseline | A4 | `PrintToPdf` | 594.96 × 841.92 | 5.21 | 6 | 77.2% | 31.5% |
| Baseline | A4 | `Page.printToPDF` | 594.96 × 841.92 | 5.87 | 6 | 76.6% | 34.3% |
| Adjusted | Letter | Both | 612 × 792 | 0.18 | 1 | 100% | 0.7% |
| Adjusted | A4 | Both | 594.96 × 841.92 | 0.79 | 2 | 99.1% | 2.6% |

- **Pages and breaks.** Every export had 5 pages for 5 sheets. Both manual breaks and the keep-together group landed on the same pages as on screen.
- **Borders cause the baseline shift.** At 150%, a 1-pixel border snaps to 0.67 CSS pixels on screen but stays 1 pixel in print. Each table row grows in the PDF, so text below the 11-row table moved 5.8 pixels.
- **A4 is 0.32 points narrow.** Both routes wrote A4 pages 594.96 points wide, not 595.28. `PrintToPdf` then shrank the page by 0.05%, moving its far edges by up to 0.7 pixels.
- **What remains is pixel snapping.** The screen snaps positions to device pixels, and print to CSS pixels. The worst adjusted page was off by 0.79 pixels.
- **Antialiasing always differs.** Adjusted pages differ by 0.35 to 2.4 levels (of 255) on average, and 3% to 26% of ink pixels differ in exact position. The two routes differ by at most 0.003 levels.
- **Ink stays vector, and backgrounds print.** All 83 strokes, including a 40% highlighter, are filled paths in their pen colors. The only image is the PNG. Paper color, table fills, and all three paper patterns appear.
- **Variable fonts become Type 3.** Chromium embeds both variable fonts as glyph outlines (Type 3 fonts) with ToUnicode maps, so text stays searchable. Only the static mono font is a real TrueType font (FontFile2).
- **Print events fire.** `beforeprint` and `afterprint` fired once per export on both routes.

### Speed and responsiveness

| Letter pages | Where | `PrintToPdf` median (s) | `Page.printToPDF` median (s) | Longest frame gap, median run (ms) | Longest task (ms) | File (MB) |
|---|---|---|---|---|---|---|
| 1 | Visible WebView | 0.49 | 0.48 | 9 | 0 | 0.1 |
| 10 | Visible WebView | 1.40 | 1.53 | 108 | 126 | 1.4 |
| 50 | Visible WebView | 4.68 | 5.82 | 475 | 537 | 8.8 |
| 50 | Hidden WebView | 6.25 | Not tried | 8.6 | 0 | 8.8 |

A4 times were within 8% of Letter. With nothing exporting, the visible page's longest gap was 8.7 ms, one frame at 120 Hz. Printing lays out every page on the page's main thread, so exporting in the visible WebView breaks the 50 ms feedback budget from 10 pages up. Exporting from the hidden WebView left the visible page as smooth as when idle.

### Limitations

- One fast machine, with other spikes running. Some development runs took only 0.15 and 0.4 seconds for 1 and 10 pages, while 50 pages stayed at 4.6 to 5.1 seconds. The reference laptop must repeat the timings.
- Windows.Data.Pdf enlarges requested images by 1.4 on this screen, so the harness measures the factor and corrects for it. After rendering, a process took 20 minutes to exit, so the harness now ends itself.
- The paginator never splits a block, and no static version of the note fonts was tested.
- The spike didn't check the hidden WebView's renderer process or memory, print on paper, or open the PDFs in other viewers.

## Options considered

| Option | For | Against |
|---|---|---|
| `PrintToPdf` in a hidden WebView (chosen) | The same layout as the screen, so pages match. The API Tauri apps use. The visible page keeps drawing. | A second WebView costs memory. Variable fonts become Type 3 fonts. |
| `PrintToPdf` in the visible WebView | Simplest; no second WebView | Freezes the page for half a second at 50 pages |
| DevTools Protocol `Page.printToPDF` | Same output; keeps A4 at scale 1 without rule 2 | A debugging interface, not a print API; up to 24% slower |
| Write PDFs from the document model in Rust | Full control over fonts and file size | A second layout engine that must copy Chromium's line breaks, so it drifts from the screen |
| Do nothing (browser print only) | No work | No control over pages or file names, and no golden tests |

## Consequences

- The paginated view and the PDF come from one layout, so page breaks, keep-together groups, and manual breaks land on the same pages.
- Rules 1 and 2 need a lint or test in Phase 6, because one table with borders shifts every line below it.
- Regression tests compare each exported page with its approved image from the same renderer. Screen tests fail when over 3% of ink is more than 1 pixel off, a tile moves over 2 pixels, or a page moves over 1 pixel. The adjusted pages pass; the border bug fails all three.
- CI needs a PDF renderer. Windows.Data.Pdf should run in a child process with a timeout, or PDFium should replace it.
- Phase 6 follows up in three ways. It switches to static fonts and checks their embedding and file size. It measures the hidden WebView's memory on the reference laptop. It adds line and row splitting to the paginator.
- A person should print a page at 100% and measure it with a ruler. They should also open the PDFs in Acrobat, Edge, and a phone viewer to check text search and copy.
