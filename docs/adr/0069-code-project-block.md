# ADR 0069: Code projects as a page block, and code cell data version 2

- Status: Proposed
- Date: 2026-11-01

## Context

The Code studio needs projects of several files, tests and settings that sync with the notebook, keep history, export, and show in search. The format (`docs/format/README.md`) stores a page as `page.json`. Extension blocks are `ext:org.opennote/<name>` with a required Markdown fallback (spec 6.5). The core accepts every `ext:org.opennote/` type without a change (`crates/core/src/ops/merge_patch/view.rs` line 33). Block edits are JSON merge patches (RFC 7396), which replace arrays wholesale. Assets are immutable (spec 10.3), and a page that changes on two devices goes to `.conflicts/` (spec 14.1). Today's code cell mounts any unknown `language` as Python and writes `python` back on the next edit (`app/src/features/codecells/mount.tsx` line 25), which would corrupt cells written by a newer version.

## Decision

We will store a project as a block of type `ext:org.opennote/codeproject` whose `data` has `v`, `minEditor`, `name`, `language`, `runtime`, `main`, `files` and `tests` as objects keyed by ID (never arrays), `stdin`, `args` and `settings`, with limits of 200 files, 1 MiB per file, 4 MiB per project and 500 tests, and the path rules of DESIGN.md section 3.2. The fallback lists every file as a heading and a fenced block (truncated at 256 KiB). Breakpoints, watches, open tabs, and console history are device state keyed by block ID, never page data. Code cells keep their type and gain optional `v: 2`, `runtime`, `stdin`, `tests` and `minEditor`, and new languages. Before any new language ships, code cells treat an unknown language or a higher `minEditor` as read-only and never patch it (lane L00b, in Beta 8 if it can still land).

## Options considered

| Option | For | Against |
|---|---|---|
| A page block with files in `data` (chosen) | No core or sync change; history, search, export, and conflict review work at once; per-file merge patches | A project is bounded by `page.json` (64 MiB) and the 4 MiB cap we set; conflicts are page-level until the code-aware conflict view (R2) |
| A `code/` folder of real files in the notebook | Familiar to IDE users; other editors can open it | A format change in every reader and in sync; files outside `page.json` have no history or fallback; path and encoding problems on every sync tool |
| Files as page assets | Binary-friendly | Assets are immutable, so each save would add an asset and grow history |
| One big text with file markers | Simple | Every edit rewrites everything; no per-file merge |

## Consequences

- Easier: projects travel with the notebook, sync, restore from history, export as `.zip`, Markdown and PDF, and are found by search through the fallback.
- Harder: large data sets do not belong in projects; binary files wait for asset references (R2). Older versions see projects read-only. An app older than Beta 8 that edits a code cell with a new language relabels it as Python (the text survives); the flag is beta only, so the exposure is limited to beta users who skip updates.
- Follow-up: the path validator in TypeScript and Rust with shared cases; the code-aware conflict view (diff3 per file, R2); the `.ipynb` import and export (R2); the guard in `mount.tsx` with a test that an unknown language never patches.
- Revisit if people regularly hit the 4 MiB cap, then consider a folder format with its own ADR.
