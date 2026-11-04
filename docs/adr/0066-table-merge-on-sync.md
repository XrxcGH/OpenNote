# ADR 0066: Three-way merge of table blocks when two devices edit one page

- Status: Proposed
- Date: 2026-11-01

## Context

When two devices change the same page concurrently, one copy stays, and the other goes to `.conflicts/` for the person to compare (format spec 14.1, ADR 0049). ADR 0049 lists block-level merge of `page.json` as a follow-up. Tables are where concurrent edits to different parts of one block are most common (two people filling in different rows). Spreadsheets in the cloud merge per cell.

## Decision

When block-level merge lands, table blocks merge three-way against their common ancestor with a pure function in `crates/core` (and a TypeScript twin for the compare view):

- Rows and columns match by ID. Rows or columns added on either side are kept, in ancestor order and then by ID. A row deleted on one side and edited on the other is kept (an edit beats a delete, as ADR 0049 rules for files).
- A cell changed on one side takes that side. A cell changed on both sides to different text is a conflict: the page keeps the side with the later `saved_at`, and the other value is kept in the conflict copy and shown in the compare view.
- `data.sheet` maps merge per key with the same rule. Style IDs are content hashes, so equal styles from two devices are one entry. Overlapping merges keep the lower ID.
- `data.smart` merges per column ID for column settings; lists (filters, charts, saved views) take the later side.
- Formulas are not rewritten by the merge. When one side inserted rows and the other wrote formulas with A1 references, the compare view highlights those formulas.

## Options considered

| Option | For | Against |
|---|---|---|
| Three-way merge by IDs with the later side winning true conflicts (chosen) | Most concurrent table work merges silently; deterministic on every device | A true conflict still needs the compare view |
| Keep page-level conflicts only | No new code | Two people filling different rows always conflict |
| A CRDT per table | Merges everything | A large change to the core and every writer (rejected in ADR 0049) |

## Consequences

- Needs ADR 0049's block-level merge plumbing; this ADR fixes only the rule for table blocks.
- Fixture tests cover each rule with ancestor, left, right, and expected JSON.
