# Architecture decision records

An architecture decision record (ADR) is a short document about one important choice. It records the problem, the options, what was chosen, and what follows from it. ADRs let future contributors see why the code looks the way it does, without digging through old chats or pull requests.

## When to write one

Write an ADR for anything hard to reverse, before the code that depends on it. This is one of the [working agreements](../../DEVELOPMENT.md#12-working-agreements) in the development plan. Typical examples:

- Choosing a framework, language, or core library
- Changing the note file format, or where data is stored
- Choosing the license, or how releases are built, signed, and delivered
- The result of each Phase 1 spike, with its measurements

Choices that are easy to undo, such as a small helper library, don't need one. When in doubt, write a short one.

## How to add one

1. Copy [the template](0000-template.md) to a new file named with the next free number and a short title.
2. Fill in each section. One or two pages is enough.
3. Set the status to Proposed, and open a pull request. The discussion happens in the review.
4. Before merging, set the status to Accepted, and add the record to the [list of decisions](#decisions).

If a proposal is turned down, close the pull request with a comment that explains why.

## Numbering

Records are numbered in order with four digits, starting at 0001. Number 0000 is the template. A number is never reused, even if its record is later replaced. If two open pull requests pick the same number, the one that merges second takes the next free number.

File names join the number and a short lowercase title with hyphens, for example `0002-license.md`. The title at the top of the file repeats the number, for example "ADR 0002: License".

## Statuses

| Status | Meaning |
|---|---|
| Proposed | Written and open for discussion, but not yet binding |
| Accepted | Agreed, and the code should follow it |
| Superseded | Replaced by a later ADR, which the status line links to |

A status can carry a short condition, such as "Accepted, pending the Phase 1 ink latency spike".

Accepted records aren't rewritten when plans change. Instead, write a new ADR for the new decision, and change the old status to "Superseded by ADR NNNN" with a link. Fixing typos and broken links is fine.

## Decisions

| ADR | Decision | Status | Date |
|---|---|---|---|
| [0001](0001-app-stack.md) | Build the app with Tauri 2, a Rust core, and a TypeScript, React, and Vite interface | Accepted, pending the camera check in ADR 0004 | 2026-09-30 |
| [0002](0002-license.md) | License OpenNote under Apache 2.0 | Accepted | 2026-09-30 |
| [0003](0003-typescript-version.md) | Pin TypeScript to 6.0.x until typescript-eslint supports TypeScript 7 | Accepted | 2026-09-30 |
| [0004](0004-ink-latency.md) | Keep WebView2 for ink: draw live strokes on a desynchronized canvas in the pointer handler, and try delegated ink trails and a native ink layer in Phase 5 | Accepted, pending the owner's camera check and budget review | 2026-09-30 |
| [0005](0005-freeform-text.md) | Build each text container as its own Tiptap editor on one zoomable world, with contained blocks and ink in cached tiles | Accepted, pending the owner's review of the typing budget | 2026-09-30 |
| [0006](0006-pdf-export.md) | Export PDFs with WebView2 PrintToPdf from a hidden WebView, with print CSS and layout rules that keep the screen and paper in step | Accepted | 2026-09-30 |
| [0007](0007-audio-capture.md) | Record the microphone and system audio with cpal on WASAPI, align both to the performance counter, and store Opus in 1-second Ogg pages | Accepted | 2026-09-30 |
| [0010](0010-interface-components-and-state.md) | Build the interface from hand-written accessible components, a small external store, registries, and a platform seam | Proposed | 2026-09-30 |
| [0013](0013-settings-and-device-state.md) | Keep personal settings and device state in two Rust-owned files, changed by validated merge patches, with atomic writes and `minWriterSchema` for safe rollbacks | Proposed | 2026-09-30 |
| [0015](0015-app-lifecycle.md) | Hold one process per profile, start in a fixed order before Tauri, and send every close through one exit handshake | Proposed | 2026-09-30 |
| [0016](0016-phase-2-test-stack.md) | Test in layers: Vitest, Vitest browser mode, Playwright, and WebdriverIO with tauri-driver, on installed browsers | Proposed | 2026-09-30 |
