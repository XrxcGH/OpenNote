# ADR 0081: Bundle Carlito and Caladea as metric stand-ins, loaded on demand

- Status: Accepted
- Date: 2026-11-01

## Context

A DOCX from Word 2007 to 2021 is set in Calibri and Cambria. Those fonts are not on macOS or Linux unless Office is installed, so line breaks and page counts change there. OpenNote already bundles three SIL Open Font License (OFL) families (OpenNote Sans, Literata, Atkinson Hyperlegible Mono), about 236 KB of Latin `woff2`. The start-up budget is 520 KB of JavaScript and 27 KB of CSS (`app/bundle-budget.json`).

## Decision

We will bundle Carlito (OFL 1.1, metric-compatible with Calibri) and Caladea (OFL 1.1, metric-compatible with Cambria), as Latin and Latin Extended `woff2` subsets in four faces each. The first estimate was 340 KB. The measured size is 593 KB together (Carlito 449 KB, Caladea 145 KB), because Carlito's Latin Extended file is large. `app/bundle-budget.json` records the limits (`bundledFontsKb`), and a test fails above them.

- They load only when a run or style resolves to them. `@font-face` rules list `local()` first, one name per face,, so an installed original or clone wins.
- The Linux packages declare a dependency on the Liberation fonts (clones of Arial, Times New Roman, and Courier New) instead of bundling them.
- No Chinese, Japanese, or Korean font is bundled.
- The font resolver maps Calibri to Carlito and Cambria to Caladea. It maps Arial, Times New Roman, Courier New, and Helvetica to Liberation. Each stand-in comes right after the named font.

## Options considered

| Option | For | Against |
|---|---|---|
| Carlito and Caladea bundled, Liberation through Linux packages (chosen) | Word documents keep their line breaks everywhere; no start-up cost | About 340 KB more in the installer |
| Bundle nothing | Smallest app | Word documents reflow on macOS and Linux |
| Bundle Liberation too | Same result on Linux without a package dependency | About 500 KB more, for a gain only on Linux |
| Bundle Noto CJK (Chinese, Japanese, Korean) | Full coverage | 5 MB or more per weight; every target OS ships CJK fonts |

## Consequences

`THIRD_PARTY_NOTICES.md` and the About notices gain the two fonts. Both ship under the SIL OFL 1.1 as the `@fontsource` packages repackage them. Some distributions publish Caladea under Apache 2.0, and the notice follows the files that ship. A test fails when a bundled font lacks its license text, when the total grows past the stated budget, or when a font loads at start-up.
