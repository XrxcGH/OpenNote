# ADR 0081: Bundle Carlito and Caladea as metric stand-ins, loaded on demand

- Status: Proposed
- Date: 2026-11-01

## Context

A DOCX from Word 2007 to 2021 is set in Calibri and Cambria. Those fonts are not on macOS or Linux unless Office is installed, so line breaks and page counts change there. OpenNote already bundles three OFL families (OpenNote Sans, Literata, Atkinson Hyperlegible Mono), about 236 KB of Latin `woff2`. The start-up budget is 520 KB of JavaScript and 27 KB of CSS (`app/bundle-budget.json`).

## Decision

We will bundle Carlito (OFL 1.1, metric-compatible with Calibri) and Caladea (Apache 2.0, metric-compatible with Cambria), as Latin and Latin Extended `woff2` subsets in four faces each. The estimate is 340 KB together, and the lane measures the real size.

- They load only when a run or style resolves to them. `@font-face` rules list `local()` first, so an installed original or clone wins.
- The Linux packages declare a dependency on the Liberation fonts (clones of Arial, Times New Roman, and Courier New) instead of bundling them.
- No CJK font is bundled.
- The font resolver maps Calibri to Carlito and Cambria to Caladea. It maps Arial, Times New Roman, Courier New, and Helvetica to Liberation. Each stand-in comes right after the named font.

## Options considered

| Option | For | Against |
|---|---|---|
| Carlito and Caladea bundled, Liberation through Linux packages (chosen) | Word documents keep their line breaks everywhere; no start-up cost | About 340 KB more in the installer |
| Bundle nothing | Smallest app | Word documents reflow on macOS and Linux |
| Bundle Liberation too | Same result on Linux without a package dependency | About 500 KB more, for a gain only on Linux |
| Bundle Noto CJK | Full coverage | 5 MB or more per weight; every target OS ships CJK fonts |

## Consequences

`THIRD_PARTY_NOTICES.md` and the About notices gain the two fonts and the Apache 2.0 text. A test fails when a bundled font lacks its license text, when the total grows past the stated budget, or when a font loads at start-up.
