# ADR 0077: Pages carry minWriterVersion, the oldest version that may edit them

- Status: Proposed
- Date: 2026-11-01

## Context

Format spec 15.2 makes every file whose `formatVersion` is newer than the reader read-only. With ADR 0076, an app that knows version 2 can safely edit a page from version 3 whose only new features are inline tags in the reserved grammar, because it keeps them as foreign marks. The rule of 15.2 would still lock it out. Settings already solve the same problem with `minWriterSchema` (ADR 0013).

## Decision

We will add an optional key `minWriterVersion` to `page.json`, written right after `minReaderVersion`. When it is missing, it equals `formatVersion`.

- A reader with version V edits a file when V is at least `minWriterVersion`, even if V is less than `formatVersion`.
- It opens the file read-only when V is less than `minWriterVersion` and at least `minReaderVersion`.
- A writer sets `minWriterVersion` to the oldest version that preserves everything in the file.
- A writer that edits a newer file keeps its `formatVersion` and `minWriterVersion` as they were.

## Options considered

| Option | For | Against |
|---|---|---|
| `minWriterVersion` (chosen) | Editing survives future additive versions; matches ADR 0013 | One more key; the writer must compute it correctly, which needs fixture tests |
| Keep spec 15.2 as is | No change | Every version bump locks older devices out of editing |
| Treat every newer file as editable | Simple | Unsafe for changes that are not additive, such as encryption |

## Consequences

The core's page reader and writer (`crates/core/src/format/page_json/`), the reading rules in spec 15.2, and the shared notes contract tests change. Encrypted or otherwise non-additive features keep `minWriterVersion` equal to their version.
