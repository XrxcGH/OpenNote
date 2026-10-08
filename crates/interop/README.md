# opennote-interop

This crate moves notes in and out of OpenNote. It imports notes from other apps, exports pages, sections, and notebooks to files, and reports what came over and what did not. It is the core of Phase 11 in [DEVELOPMENT.md](../../docs/DEVELOPMENT.md). The app wires it in through [the Tauri commands](../../app/src-tauri/src/interop) and [the import and export dialogs](../../app/src/features/interop).

The crate has no storage of its own. Imports write pages to an `ImportSink`, and exports read them from a `NoteSource`. `DiskSink` and `DiskSource` do this on a notebook folder through the core's own storage code. `MemorySink` and `MemorySource` keep small notebooks in memory for tests.

## What it reads and writes

| Source | Reads | Notes |
|---|---|---|
| Markdown folder or file | Obsidian vaults, Joplin exports, Logseq graphs, and plain Markdown | Front matter, wiki links, aliases, callouts, highlights, tables, tags, pictures, and attachments |
| Notion export | A folder or ZIP archive of Markdown and CSV | Names lose their IDs, subpage folders nest, row properties give dates and tags, and databases become tables |
| Evernote | One `.enex` file, or a folder of them | A section for each file |
| Word | `.docx` files, including OneNote's exports | Headings, lists, tables, links, pictures, and text boxes. Several Title paragraphs or page breaks cut a section into pages |
| Web page archive | `.mht` and `.mhtml` files, including OneNote's exports | Pictures found by path or file name |
| HTML | A folder of pages, or OpenNote's own HTML export | A tolerant reader for pages from any tool |
| Plain text | `.txt` files and folders | UTF-8, UTF-16, and Windows-1252, with lists found |
| Google Keep | A Takeout folder or ZIP archive | Labels, checklists, pictures, audio, and the Archive and Trash |
| Bear | TextBundle folders | Pages titled by heading or bundle name |
| CSV | `.csv` and `.tsv` files | Each file becomes a table page |
| Windows Sticky Notes | `plum.sqlite`, or the folder that holds it | One section. Each note becomes a page titled by its first line, with its dates, and its color as the page's color chip. Notes in the app's trash are reported. Pictures are not read yet |

| Export | Writes |
|---|---|
| `export_files` with `Format::Markdown` | Pages as `.md` files with front matter, and assets and handwriting pictures in `assets/` |
| `export_files` with `Format::Html` | The HTML bundle: pages, assets, and an `index.html` |
| `export_html_single` | One self-contained `.html` file with the pictures inside |
| `export_docx` | One `.docx` file with styles, lists, tables, links between pages, and pictures |
| `export_pdf_bundle` | A folder of PDF files, one for each page. A `PdfRenderer` draws them |

## Public API

| Item | Use |
|---|---|
| `detect(path)` | Says what a file, folder, or ZIP archive is, and whether it can be imported |
| `import(path, options, env, sink)` | Detects, unpacks, imports, and reports in one call, with events |
| `preview(path, options, env)` | A dry run: the sections, the totals, and the losses, grouped by reason |
| `import_*` functions | One importer each, for callers that already know the kind |
| `sticky_notes_database()` | Where this PC keeps the Sticky Notes database, if it exists, for an "Import from this PC" button |
| `export_*` and `export_*_with` | The exports. The `_with` forms take a `Control` |
| `Control`, `CancelToken`, `ProgressSink` | Progress events and Cancel for every long job |
| `Report` | What came over, what was simplified, and what was skipped, page by page |
| `DiskSink`, `DiskSource` | The core's storage as an import sink and an export source |
| `PdfRenderer` | The seam for Phase 6's PDF writer |

Every module has its own README that lists its API: [import](src/import/README.md), [word](src/import/word/README.md), [export](src/export/README.md), [disk](src/disk/README.md), [doc](src/doc/README.md), [docx](src/docx/README.md), and [the modules at the top of `src`](src/README.md).

## What the interface and the app wiring need

The app does all of this except "Save report", the PDF choice, and the Microsoft Graph import. Its import writes into `phase4/Imported` under the local app data folder, and the interface builds the tree nodes for the new notebook.

1. **Choosing a source.** Call `detect` on the path the person picks. It returns a `Detected` with a label for the dialog, and `advice` for sources that cannot be imported yet.
2. **The dry run.** Call `preview` on a worker thread and show `Preview`: the notebook name, the sections with their page counts, the picture and file totals, and `losses` as a list of reasons with examples and page counts. Offer "Import" or "Cancel".
3. **The import.** Make a `DiskSink::standard(parent)` for the folder that holds notebooks, and a `Control` with a `CancelToken` and a `ProgressSink` that forwards `Event` values to the window. Call `import` on a worker thread. On success, call `Core::open_notebook` on `sink.notebook_dir()`. Remember that folder, so "Undo this import" can close the notebook and move its folder to the system trash.
4. **The report.** `ImportOptions::report_page` adds an "Import report" page to the notebook. `Report::to_markdown` is the full copy for "Save report".
5. **Exports.** Flush the open pages with `Core::flush_all`, open a `DiskSource` on the notebook folder, and call an `export_*_with` function with a `Control`. A canceled export deletes the folder it made. Until Phase 6 lands, pass `NoPdfRenderer` and the PDF choice says it is not available.
6. **Events.** `Event` serializes as JSON with an `event` tag: `started`, `progress`, `finished`, `canceled`, or `failed`.

## Tests

- `tests/corpus.rs` imports one small export from each app, previews it, and writes it through the core into a folder that a real core opens and verifies. See `tests/corpus/README.md`.
- `tests/round_trip*.rs` export a generated notebook as Markdown, HTML, and Word and import the result. `tests/disk.rs` also sends it through the core on disk and back out.
- `tests/import_*.rs` check each importer against its fixtures, and `tests/export*.rs` check the exports and their cancel behavior.
- `examples/bench_import.rs` times a 1,000-page import and export. The numbers are in [docs/perf/phase-11-core.md](../../docs/perf/phase-11-core.md).

## What is not done

- **OneNote `.one` and `.onepkg` files.** These hold OneNote's own binary format, which Microsoft documents as MS-ONESTORE. Reading it needs a reader of several thousand lines. `detect` recognizes the files, and the import says to export Word or web page files from OneNote instead. Phase 11 also plans the Microsoft Graph import, which needs an app registration.
- **Old Sticky Notes files (`.snt`).** The app moves them into its new database the first time it runs, so the advice is to open the app once and import `plum.sqlite`.
- **Calendar, citation, and deck files.** These are iCalendar, BibTeX, Research Information Systems (RIS), and Anki files. They fill the timetable, citation, and deck features of other phases, which have no place to keep them yet.
- **"Share as a file."** It needs the notebook folder layout in a single archive with optional encryption, and it is better built once the app owns the folder.
- **Google and OneDrive uploads, and linked accounts.** These need the app's sign-in and network layers.
- **PDF export itself.** Phase 6 supplies the `PdfRenderer`.
- **Ink.** Markdown and HTML exports show a page's handwriting as one SVG picture, which cannot be edited. Word exports and every import leave ink out, and the reports say so. PDF export keeps it.

## Known limits

- Freely placed blocks follow the page's reading order in every export.
- Section order is not kept by a Markdown export, because folders have no order.
- Math stays plain text, because OpenNote reads math only from Phase 10 on.
- Word files keep attachment names, not the files. A Word export cannot name a callout's type when the callout has a title.
- A TextBundle in a `.textpack` ZIP file must be unpacked first.
- Logseq links by namespace (`[[a/b]]`) are not resolved.
