# ADR 0077: Files carry minWriterVersion, the oldest version that may edit them

- Status: Proposed
- Date: 2026-11-02

## Context

[Format spec](../format/README.md) section 15.2 makes every file whose `formatVersion` is newer than the reader read-only. With ADR 0076, an app that knows version 2 can safely edit a page from version 3 whose only new features are inline tags in the reserved grammar, or keys it keeps unchanged, because it keeps them as foreign marks and unknown data. The rule of section 15.2 would still lock it out. Settings already solve the same problem with `minWriterSchema` ([ADR 0013](0013-settings-and-device-state.md)).

## Decision

We will add an optional key `minWriterVersion` to the versioned JSON files of spec section 15.1, written right after `minReaderVersion`. When it is missing, it equals `formatVersion`, and writers leave it out when it does (spec section 2.2).

- A reader of version V, where V is 2 or later, edits a file when V is at least `minWriterVersion`, even if V is less than `formatVersion`. It keeps everything it does not know.
- It opens the file read-only when V is less than `minWriterVersion` and at least `minReaderVersion`.
- A valid value lies between `minReaderVersion` and `formatVersion`. A reader treats any other value as `formatVersion`.
- A writer sets `minWriterVersion` to the oldest version that preserves everything in the file. A writer that edits a newer file writes its three version keys back as they were.
- In version 2 itself, `minWriterVersion` always equals `formatVersion`, so writers of version 2 never write it. The first version that can use it is version 3. Readers of version 1 do not know it, and open every newer file read-only, as today.

Spec rules `R-VER-2` to `R-VER-5` state this, and the fixtures in `docs/format/fixtures/markdown/downlevel/` pin each case.

## Options considered

| Option | For | Against |
|---|---|---|
| `minWriterVersion` (chosen) | Editing survives future additive versions; matches ADR 0013 | One more key; the writer must compute it correctly, which needs fixture tests |
| Keep spec section 15.2 as it is | No change | Every version bump locks older devices out of editing |
| Treat every newer file as editable | Simple | Unsafe for changes that are not additive, such as encryption |

## Consequences

The core's page reader and writer (`crates/core/src/format/page_json/`), the reading rules of spec section 15.2, and the shared notes contract tests change. Encrypted or otherwise non-additive features keep `minWriterVersion` equal to their version.
