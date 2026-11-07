# ADR 0060: An in-repository function library tested against reference values

- Status: Proposed
- Date: 2026-11-01

## Context

Tables implement 48 function names today (`engine/formula/functions.ts`, `textDate.ts`). Parity needs about 520: every current Excel function except network, cube, and real-time ones, Excel's compatibility names, and the Sheets functions people use most. The repository is Apache-2.0 (ADR 0002) and has strong known-answer test habits. Its numeric kits (`features/tools/kits/num/`) already hold tested special functions, complex numbers, matrix decompositions, and root finders.

## Decision

We will write the function library in the repository, one file per family under `engine/formula/fn/`, with no runtime formula dependency, and test every function against known values:

- Reuse the numeric kits, moved to `app/src/core/num/` with re-exports left in place.
- Each family has a fixture file of cases, and each case names its `source`. A source is one of these:
  - Excel's or Sheets' documented examples (numbers and results only; no copied text).
  - A LibreOffice Calc oracle, run headless by a development-only script.
  - NIST statistical reference datasets and the NIST Digital Library of Mathematical Functions.
  - Hand-worked values, or properties.
- Where Excel, Sheets, and Calc disagree, follow Excel and record the difference in `fixtures/fn/DIFFERENCES.md`.
- A nightly job reruns the oracle and fails when a value changes.
- Network functions (WEBSERVICE, STOCKHISTORY, IMPORT*, GOOGLEFINANCE, IMAGE with a URL), cube functions, and RTD are not implemented. They parse, keep their text, and show "Not available in OpenNote".
- Function descriptions are written fresh in American English.

## Options considered

| Option | For | Against |
|---|---|---|
| Own library with reference fixtures (chosen) | Apache-2.0 clean; errors-as-values and arrays built in; one engine for units and locales; tests define behavior | About 470 functions to write |
| HyperFormula | Most complete JavaScript engine | GPL-3.0 or a commercial license; a second engine beside ours |
| formula.js (MIT) | Broad coverage, permissive | Loose on Excel edge cases, no array, or reference values, brings `jstat` and `bessel`; we would rewrap every function anyway |
| Run LibreOffice or Excel at runtime | Exact for that app | Huge, not offline-embeddable, platform-specific |

## Consequences

- Family lanes can work in parallel with disjoint files.
- formula.js may serve as a development-only cross-check if the owner agrees (PLAN.md decision 8); it never ships.
- LibreOffice is a development and nightly CI tool only; it is never bundled.

## Implementation notes

- `engine/formula/fn/types.ts` defines `FnSpec2`; `fn/index.ts` builds the registry from one file per family and refuses two functions with one name. `functions.ts` adapts `FnSpec2` to the current compiler until arrays land: a first parameter of kind `range` makes an aggregate, and a `lazy` parameter makes a special form.
- The numeric kits live in `app/src/core/num/`; `features/tools/kits/num/` re-exports them.
- `tools/sheet-oracle/oracle.ts` writes cases into a `.fods` file with one sheet per case and the formulas in Excel's syntax (the `msoxl:` formula namespace), converts it to CSV with LibreOffice, and reads the raw values. `--write` fills the `calc-oracle` cases and records the LibreOffice version; `--check` fails on a changed value. The `nightly-sheet-oracle` workflow runs both.
