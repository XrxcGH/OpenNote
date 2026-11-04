# ADR 0078: Writers stamp the lowest format version a file needs

- Status: Proposed
- Date: 2026-11-02

## Context

[Format spec](../format/README.md) section 15.3 says a file is written in the new version whenever an edit saves it. Beta 9 adds two kinds of data, from the text and the tables programs:

- Inline tags, footnote references, notes, comments, suggestions, and breaks, which a version 1 reader would corrupt, so it must not edit them. For tables: merges, names, validation, conditional formats, cached values, and formulas whose meaning `data.sheet.v` changes, which a version 1 reader would misread or leave stale.
- Keys beside the Markdown: `paras`, `lists`, `layout`, a page's `styles`, `view.text`, `view.print`, new style keys, and cell styles in `data.sheet`. A version 1 reader already keeps these unchanged (spec section 2.9), and element, row, and column IDs keep them attached to what they format (spec sections 6.3 and 6.6).

People sync one notebook across devices that update at different times. If every save stamps version 2, a phone on Beta 8 can no longer edit any page that the laptop touched, even pages that only gained a centered paragraph or a colored cell. The owner decided on 2026-11-02 to have one format version 2 for text, tables, and code, with lowest-version stamping and `minWriterVersion` (decision N1).

## Decision

We will stamp each file with the lowest format version whose features it uses, computed at save time from its content, and change spec sections 15.3 and 15.5 to say so.

- Spec section 15.6 holds one stamping table for every program, with rules `R-STAMP-1` to `R-STAMP-13`. Version 2 is needed by inline tags beyond version 1 (including the weight mark), version 1 tags with version 2 values, foreign marks, `[^id]` references, entries in `data.notes`, `data.comments`, or `data.suggestions`, `break` blocks, and a `data.sheet` with entries in `merges`, `names`, `validation`, `conditional`, or `values`, or with `v` in a table that holds a formula cell.
- Everything else stays at version 1: paragraph formatting, lists, layout, styles, themes, text settings, headers and footers, and a `data.sheet` with only styles, table settings, rows, columns, cells, notes, and links. Code blocks never change a page's version; their own `data.v` and `data.minEditor` decide who may edit them.
- Every version 2 feature keeps `minReaderVersion` at 1, so Beta 8 still shows the page, read-only.
- A page can go back to version 1 when its last version 2 feature is removed.
- The backup before an upgrade (spec section 15.4) runs when a save first gives a file a higher version than it has on disk.
- The fixtures in `docs/format/fixtures/markdown/downlevel/`, `markdown/paras/`, and `table-sheet/` pin every row.

## Options considered

| Option | For | Against |
|---|---|---|
| Stamp the lowest version needed (chosen) | Older devices keep editing pages that use only additive keys; paragraph formatting, styles, and cell formats never lock anyone out | The writer must know which features need which version; a page can move up and down as features are added and removed |
| Always stamp the newest version (spec section 15.3 today) | Simple | Locks older devices out after any edit |
| Never raise the version for formatting | Old devices edit everything | Old devices would corrupt inline tags, leave cached results stale, and break merges |

## Consequences

- The core computes the stamp in one place (`core-format-v2`), with the same rules for text blocks and table cells.
- A version 1 reader that edits a page with paragraph formatting keeps the formatting but does not draw it, and a version 1 writer may move a space out of an underline when it rewrites that paragraph. Both are visible only, and nothing is lost.
- Later versions follow the same rule: each lists the features that need it in a stamping table (spec section 15.5).
