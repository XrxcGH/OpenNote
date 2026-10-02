# ADR 0008: Note file format

- Status: Proposed
- Date: 2026-09-30

## Context

The note file format is the hardest decision to reverse in OpenNote. Every later platform must read it, and every sync tool and backup will copy it. The [development plan](../../DEVELOPMENT.md#4-note-file-format) fixes its outline. A notebook is a folder, and `page.json` is the source of truth. Ink keeps raw points, `page.md` is a readable copy, every file has a version, and saves are atomic. Phase 3 must turn that outline into a specification and code before any user data exists. Numbers 0004 to 0007 are reserved for the Phase 1 spike records.

The format has to meet these forces at once:

- The [budgets in BRAND.md](../../BRAND.md#10-comfort-and-performance-budgets). A page with 500 blocks and 5,000 strokes opens in 150 ms. The app stays under 400 MB with a 1,000-page notebook, and a crash loses at most 1 second of work.
- Windows as it really behaves. Antivirus scanners, the search indexer, and sync clients hold files open. The Documents folder is often inside OneDrive, so folder sync exists from the first release.
- Longevity. Notes must stay readable without OpenNote, and a stranger must be able to write a reader from the specification alone.
- Portability to macOS, Linux, iOS, and Android, and readiness for sync and collaboration later.

Three competing designs were written and reviewed: one focused on data safety, one on performance, and one on longevity. The reviewers ranked the safety design first overall. This record adopts it as the base, with the strongest parts of the other two, and with every blocking finding of the reviews fixed. The result is specified in the [note format specification](../format/README.md).

## Decision

We will store notebooks in format version 1 as the [specification](../format/README.md) defines it:

- A notebook is a folder with a name the person chose. Section and page folders are named by permanent IDs, and section groups live in `notebook.json`. Every page folder has `page.md` and, when it has ink, `ink.svg`. The notebook has `README.md`, `index.md`, and a copy of the specification, so people can read it without OpenNote.
- `page.json` is canonical JSON and the page's single commit point. Writers skip a write that would not change a file's bytes, so Git, sync tools, and backups stay quiet. Blocks carry order keys. Text blocks are text boxes that hold OpenNote Markdown: CommonMark with a few extensions. Its escaping rules already reserve the syntax that later phases will add.
- Paragraphs, headings, and list items can have stable element IDs, kept beside the Markdown with their tags, to-do check marks, and named styles. Links, tags, and handwriting anchors can then point at one paragraph, while `page.md` stays clean. Pictures carry a description and a `decorative` flag, and a page can set a reading order in its view.
- Ink lives in immutable binary segment files. Points are quantized and stored as deltas in variable-length integers, at about 8 bytes per point. Every record has a checksum, and every stroke stores the palette slot of its pen. Saves add small segments, compaction runs in two tiers, and page history shares segments instead of copying them.
- Assets are immutable files named by ID with a readable stem.

### Safety and compatibility

The format also fixes how files change over time:

- Every save writes new immutable files first and replaces `page.json` last. On Windows, the replace renames the temporary file by handle with POSIX (Portable Operating System Interface) semantics and flushes the same handle. Each save reports whether its durability is confirmed.
- A write-ahead journal per page, in local app data, keeps every edit durable within about 0.6 seconds. Each journal generation holds a snapshot of its base page. Every operation carries its preconditions, so a replay onto the wrong base fails instead of damaging the page. Old generations are deleted only after a confirmed save on the notebook's own drive.
- Trash and page history live inside the notebook, so they travel with it. Conflicts are always kept and shown, never overwritten. A tree intent log, plus marks inside the notebook, lets any device finish a half-done move or deletion without trusting clocks.
- All JSON files share one format version number. Each file also states the oldest reader that can show it. Older apps open newer files read-only, and newer apps upgrade older files in memory, writing them back only when edited, after a backup.
- Encrypted sections are reserved. Version 1 already forbids plain-text copies of them in readable files, the search index, thumbnails, and the journal.

### Amendments before version 1 froze

The Phase 4 and Phase 5 designs asked for these changes while version 1 was still a draft. Items P3-1 to P3-12 come from Phase 4, and C1 to C11 come from Phase 5. The table records what became of each one.

| Item | Change | Status |
|---|---|---|
| P3-1 | Reading order in the view | Done: `view.readingOrder`, `setPage` merge patch, fixtures in `reading-order/` |
| P3-2 | Descriptions and the `decorative` flag | Done: already in the spec and model for images, drawings, and files; a round-trip test now covers them |
| P3-3 | Named styles in `notebook.json` | Done: `styles` in the spec, `NotebookFile`, `NotebookTree`, `NodeProps`, and `set_notebook_props`; copies merge by `changed` |
| P3-4 | Typing groups join `PatchBlock` and `SetPage` | Done: in `UndoStack`, with followers ignored |
| P3-5 | Full block JSON in undo, redo, and remote frames | Done: `FrameInfo` carries `blocks`, `title`, `tags`, `view`, and `assets` |
| P3-6 | Image size and type check on import | Done: `AssetSource` takes `image`, and imports check an image's first bytes |
| P3-7 | Restoring parts of a version, deleting history, and retention | Done in the core: `PageHandle::restore_blocks`, `NotebookHandle::delete_history`, and `Core::set_retention`. The Tauri commands are for the app bridge |
| P3-8 | Injected `invoke` and `Channel`, and `page_handle` | For the app bridge: needs TypeScript and `core_bridge.rs` |
| P3-9 | `asset_import_path` stays out of the WebView capability | For the app bridge: needs the Tauri capability file |
| P3-10 | `spliceText` edit | Done: `Edit::SpliceText` resolves to one `EditText` splice at a UTF-8 byte offset, with the same checks, and groups as typing |
| P3-11 | Width of a floating text block without `w` | Done: spec 6.2 says content width, from 120 to 600 units |
| P3-12 | No two adjacent lists of one kind | Done: spec 7.7 says writers join them; `alsoWrittenFrom` in the document fixtures covers it |
| C1 | `StrokeTxnMeta` with `ui` and `edits` | Done: `edits` resolve first, then the strokes are added, and a new stroke may reuse the ID of one an edit removed |
| C2 | Partial erase makes sliced strokes | Done: spec 8.2 describes the parts, their cut ends, and their start times |
| C3 | Stored pressure and positions | Done: spec 8.2 and 9.4 say what is stored |
| C4 | Anchored ink | Done: role `anchored` and the `anchor` object in spec 6.3 and 8.1, in the model, both codecs, and the fixtures. `alt` and `decorative` were already there (P3-2) |
| C5 | Exact geometry for shapes | Done: informative note in spec 9.3 |
| C6 | Typing rule joins anchored ink changes | Done: the page session records with `UndoStack::record_with`, which knows each ink block's anchor |
| C7 | Shared `newId()` and a header-only codec reader | For the app bridge: TypeScript exports |
| C8 | `ink.svg` width of transformed strokes | Done: spec 11.3, `Affine::width_scale`, the Rust writer, and the Python reader |
| C9 | Binary applied-changes frames on the page `Channel` | For the app bridge: needs the `Channel` frames |
| C10 | `page_read_strokes` | Done in the core as `PageHandle::read_strokes`; the Tauri command is for the app bridge |
| C11 | Pen corpus for M2 and the budget page | Done in the code: `tests/fixtures/pen/` has a README and format, and the generator and M2 use matching recordings. The recordings themselves are still to be made on a real pen |

### Conditions

This decision stands only after four measurements in the first week of Phase 3:

1. WebView2 must deliver a 4 MB binary page envelope at 150 MB/s or more. Otherwise the ink transfer moves to a custom URL scheme read with `fetch()`, before the envelope format freezes.
2. Pen recordings from the Phase 1 spike must confirm roughly 8 bytes per point. If they show more than 10, the segment encoding switches to second-order deltas before version 1 freezes.
3. Cold page opens with Microsoft Defender active must fit the page open budget with the planned number of files.
4. A test turns off a virtual machine at random moments during saves. It must confirm that a confirmed rename survives power loss on NTFS (New Technology File System), the usual Windows file system.

The first measurements run on a Surface Laptop Studio 2, which is much faster than the reference laptop in BRAND.md. Their numbers are recorded with that caveat. A pass on that machine is not a pass on the reference laptop, so the reference laptop repeats the timing measurements before version 1 freezes.

## Options considered

### Storage

| Option | For | Against |
|---|---|---|
| A folder per notebook, JSON pages, and binary ink segments (chosen) | Readable and diffable. One atomic commit per page. Sync tools handle small separate files well | More files than a single container. Two codecs, in Rust and TypeScript, must agree byte for byte |
| One SQLite database per notebook | Fast, with transactions built in | Unreadable without software. Sync tools damage live databases. One file is a single point of failure |
| One ZIP file per page | One file to copy | Every save rewrites the whole file, and people can't browse it |
| Markdown files as the source of truth | Plain and familiar, and works in Obsidian | Can't hold freeform layout, handwriting, or stable IDs without heavy sidecar files |

### Folder names

| Option | For | Against |
|---|---|---|
| ID names for sections and pages (chosen) | Renaming never touches the file system. No failures from files held open, illegal names, case clashes, or long paths. Safe with sync tools by construction | Explorer shows IDs. `page.md`, `index.md`, `README.md`, and readable asset stems soften this |
| Readable names, renamed lazily | Easy to browse in Explorer and Obsidian | A folder rename fails while any file inside is open. A rename on one device and an edit on another can split one page into two folders. Needs a long set of naming rules |
| Readable names with an ID suffix | Readable and unique | Still renames a folder on every title change |

### Ink encoding

| Option | For | Against |
|---|---|---|
| Quantized first-order deltas with varints (chosen) | About 3.4 to 4 MB for the budget page, fast to decode, and exact on round trips | Other tools need a decoder of about 150 lines. The specification, test vectors, and a Python reference reader cover it |
| Raw `f32` values | The simplest format, readable without decoding | About 3 times larger, about 10 MB for the budget page, which puts page open time and memory at risk |
| Second-order deltas with a stroke table | About a quarter smaller | A more complex decoder. Kept as the fallback if measurements demand it |
| Number arrays inside `page.json` | No binary files | About 20 MB and up to 200 ms of parsing for the budget page |

### Crash safety

| Option | For | Against |
|---|---|---|
| A journal per page in local app data, with base snapshots (chosen) | At most 1 second lost. Never synced. Recovery does not depend on the notebook folder's state | More code and a few more flushes per save |
| Save `page.json` every second | Simple | Rewrites large files constantly, keeps sync tools busy, and still loses the last second on power loss |
| A journal inside the notebook folder | Travels with the notebook | Sync tools copy half-written journals, and another device might replay edits that were never its own |
| SQLite in local app data as the journal | A proven engine | Ties storage safety to a cache, and is harder to fuzz and to specify |

### Text blocks

| Option | For | Against |
|---|---|---|
| Text boxes that hold many paragraphs, with element IDs beside the Markdown (chosen) | Few blocks, a simple mapping to editors, and a stable ID for every paragraph | The editor must keep the list of element IDs in step with the Markdown |
| One block per paragraph | A stable ID for every paragraph | About 500 blocks for a 20-page note, and a heavy mapping to the editor |
| IDs written inside the Markdown | One place for text and IDs | Clutters `page.md` and every diff, and other Markdown tools show the IDs as text |

## Consequences

- Other tools can read notebooks from the specification alone. A reference reader in Python, using only its standard library, proves it in continuous integration.
- Crash safety becomes testable. Two invariants, a fault-injecting file system, a kill harness, and power-cut tests check every save and recovery path.
- Renaming never fails because of open files, and sync tools see edits, not folder moves. People browsing in Explorer see IDs instead of titles, and rely on the readable copies.
- The Rust core and the TypeScript interface each carry an ink codec and must pass the same fixtures. The Markdown serializer must produce canonical output, which Phase 4 proves with property tests.
- The journal and the durability checks are platform-specific code behind one small file system interface. Android's shared storage and iCloud Drive will need their own adapters.
- History and Trash take space in synced folders. Thinning and a 50 MiB cap per page bound it.

Work that follows includes the implementation plan for `crates/core`, the fixtures and reference reader in `docs/format/`, and the TypeScript ink codec. Later architecture decision records (ADRs) will cover encrypted sections and sync. The sync ADR must design garbage collection that is safe across devices.

We should revisit this decision if any of these happens:

- A week-one measurement fails.
- The power-cut test ever loses a confirmed save.
- Pen recordings show far more than 8 bytes per point.
- Phase 4 cannot map text boxes onto the editor within its typing budget.

The owners of the Phase 3 exit gate check the measurements. The nightly crash and power-cut tests watch the rest.
