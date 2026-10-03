# ADR 0014: Notes service contract between the shell and storage

- Status: Proposed, to be accepted jointly by the Phase 2 and Phase 3 owners
- Date: 2026-09-30

## Context

Phase 2 builds the navigation tree while Phase 3 builds storage in `crates/core`, on separate branches at the same time. The tree needs notebooks, section groups, sections, and pages with order, colors, subpage levels, and Trash. Start-up must show the last page within 2 s, which rules out several round trips. The updater and the exit handshake must know when every change is on disk. Changes can come from outside the window: a file watcher, and later another window or sync.

Phase 3's first work package then compared the contract with its file format and listed where the two disagree. The format has no notebook list, because each notebook is its own folder. Each notebook keeps its own Trash, so a notebook can't go into its own Trash. The format allows hexadecimal colors, colors on pages, and page titles that are empty or up to 1,000 characters. Section groups nest at most 4 levels deep. The contract's restore fallback, a new notebook named after the old parent, has no place in the format.

## Decision

We will define a narrow `NotesService` TypeScript interface in `app/src/services/notes/types.ts`. It has `loadInitial(path)`, list and get methods, `create`, `rename`, `setColor`, `move` with `{ parentId, beforeId }` placement, `setPageLevel`, `trash` with receipts, `restore`, `listTrash`, `restoreFromTrash`, `saveStatus`, `hasUnsavedChanges`, `flush`, and `watch`. Errors are a `NotesError` with a code and, for invalid names, a reason. Events say what changed, may echo the caller's own changes, and must be applied idempotently. Page content is a separate interface in Phases 3 and 4.

The contract files are `types.ts`, `errors.ts`, `contract.ts` with its `contract/` folder, and `fixtures.ts`. Both `phase-2` and `phase-3` share them, and later changes need approval from both phase owners. `contract.ts` holds a shared suite of about 90 cases and a fast-check property test against a reference model. Phase 2 runs it against its in-memory service, and Phase 3 against its Tauri-backed service. Phase 3's command and event names (`notes_*` and `notes://event`) are reserved now.

To let Phase 3 serve the contract from its format, we made the small changes below. Each has its own contract cases, and the reference model and the in-memory service follow it.

| Mismatch | Decision |
|---|---|
| Section groups nest at most 4 levels in the format | A create or move that nests groups more than 4 deep rejects with `invalid-move` (`NOTES_LIMITS.groupDepth`). A top-level group is at depth 1 |
| A notebook can't go into its own Trash | Trashing a notebook takes it out of the device-local library and keeps its folder. `listTrash` lists it, and `restore` adds it back where it was. Purging later moves the folder to the recycle bin |
| Each notebook keeps its own Trash | While a notebook is in Trash, the items trashed from inside it stay with it: they aren't listed, and restoring them rejects with `not-found`. They come back when the notebook does |
| The restore fallback | When the parent is gone, a section or group goes to the end of its notebook, and a page goes into a new section at the end of its notebook, named after the old one. A group that would now nest too deep also goes to the end of its notebook |
| One receipt covers several Trash items | Each root is its own item, and items can sit in different notebooks, so storage may encode them all in the opaque receipt id. `restore(receipt)` restores what is left of the receipt, and rejects only when nothing is |
| Colors | Only the seven pen names. A stored color that isn't one reads as `null`, and `create` and `setColor` store any other value as `null`. Pages never have a color |
| Title limits | Titles set through the contract are trimmed and 1 to 200 characters, the shell's limit, which the format can hold. Storage may return a page title that is empty or longer, and the shell shows an empty one as "Untitled page". Phase 3 reports only the `empty` and `too-long` reasons |

The other mismatches need no contract change. Phase 3 keeps notebook order in a device-local library file. It diffs its coarse tree events into `upserted`, `removed`, and `childrenChanged` events, or sends `childrenChanged` or `reset`, which the tree already handles. It picks fallback dates when its cache has none, because `created` and `modified` stay ISO 8601 strings.

Until Phase 3 lands, Phase 2 test builds keep the in-memory tree, with its Trash, in a temporary snapshot in `%LOCALAPPDATA%\OpenNote\phase2-notes.json`, behind the `notes.memorySnapshot` flag and labeled in About. It uses the fixture shape, isn't a format, and has no migration.

## Options considered

| Option | For | Against |
|---|---|---|
| A narrow interface with a shared contract and suite (chosen) | Both phases work in parallel; one definition of correct behavior; Phase 3 plugs in with a one-line switch | Changes need two approvals |
| Phase 2 waits for Phase 3 | No contract to maintain | Serializes the two biggest phases |
| Each phase defines its own types and reconciles at merge | No coordination up front | Drift discovered late, when it costs the most |
| Index-based `move` | Simple | Wrong when events arrive between the decision and the call; `beforeId` stays correct |
| A coarse "reload everything" event only | Simplest for storage | Flicker and lost scroll positions in large notebooks |
| For the restore fallback, keep the new notebook named after the old parent | No change | The format keeps Trash inside each notebook, so storage can't create a notebook while restoring into one |
| For colors, reject anything but a pen name | Catches mistakes | Needs an error code the contract lacks, and colors read from other tools would still need mapping |
| For titles, allow 1,000 characters and empty page titles | Matches the format | Long titles break the tree and the title bar, and the shell never sets an empty title |

## Consequences

- Easier: the tree, palette, and setup are built and tested before storage exists. Storage has a precise target, and the suite now matches what the format can store.
- Harder: both owners must review contract changes. The in-memory service and the reference model must implement the full semantics, including the per-notebook Trash rules.
- Follow-up work: Phase 3 decides how ids, order, section groups, page levels, colors, and Trash are stored, and may generate these types from Rust with ts-rs, keeping the names. It adds the library list, moves of sections and groups between notebooks, and unsaved-change state to its core API.
- Revisit when multi-window or sync needs conflict reporting, which would likely add an event and a version to `NodeSummary`, or when a purge or "Empty Trash" call joins the contract.
