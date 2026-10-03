# Modules at the top of src

Each of these is one file. Folders have their own README: [import](import/README.md), [export](export/README.md), [disk](disk/README.md), [doc](doc/README.md), [docx](docx/README.md), and [sqlite](sqlite/README.md).

## run

Progress and cancel for every long job. A `Control` holds a `CancelToken` and a `ProgressSink`. Jobs call `checkpoint` between pages and stop with `InteropError::Canceled`, and call `step` after each page.

- **API:** `Control::none`, `Control::new`, `Control::with_cancel`, `checkpoint`, `begin`, `step`, `set_done`, `run`. `CancelToken::cancel` works from any thread. `Event` is `Started`, `Progress`, `Finished`, `Canceled`, or `Failed`, and serializes with an `event` tag. `EventLog` keeps events for tests.
- **Wiring:** implement `ProgressSink` to forward events to the window, keep a clone of the `CancelToken` for the Cancel button, and run the job on a worker thread. Progress counts pages, or bytes for an Evernote file.

## detect

Says what a path is. `detect` reads names, the first bytes of a JSON file, and the entry names of a ZIP archive. It opens a whole file only when the name says SQLite, to check that the file is the Sticky Notes database. `prepare` unpacks a ZIP archive into a temporary folder that is deleted when the result is dropped. It first deletes folders that killed imports left behind more than 12 hours ago.

- **API:** `detect`, `Detected`, `SourceKind`, `prepare`, `Prepared`.
- **Wiring:** show `Detected::label` in the import dialog. When `supported` is false, show `advice`.

## job

The single entry point for imports. `import` detects, unpacks, runs the importer inside `Control::run`, and can add an Import report page. `preview` does the same work into a sink that only counts.

- **API:** `import`, `preview`, `ImportOptions`, `Preview`, `PreviewSection`.
- **Wiring:** see the crate README. Both functions block, so call them from a worker thread.

## sink and source

`ImportSink` is where an import writes: `notebook`, then `page` for each page, then `section` for each section, then `finish` or `abort`. `with_sink` makes sure one of the last two always runs. `NoteSource` is what an export reads: the notebook, the sections, pages, and asset bytes.

- **API:** `ImportEnv` (clock, device, control), `ImportSink`, `ImportedPage`, `MemorySink`, `NoteSource`, `MemorySource`, `MemorySource::write_to`.
- **Wiring:** the app normally uses `DiskSink` and `DiskSource`. Implement the traits again only to write somewhere else, such as a cloud folder.

## report

A `Report` for each import or export. It has one `PageReport` for each page and one for the source as a whole. Each entry says a part came over, was simplified, or was skipped, and why.

- **API:** `Report`, `PageReport`, `Entry`, `Outcome`, `LossGroup`, `Report::loss_groups`, `summary_markdown`, `to_markdown`.
- **Wiring:** show `loss_groups` in the dry run and after the import. `to_markdown` is the file copy.

## archive

A safe ZIP reader for Word files, Notion exports, TextBundles, and Takeout. It reads ZIP64, checks every checksum, caps how far an entry may expand, and unpacks without leaving the target folder. It cleans names that Windows cannot create, such as `What is a cell?.md` or `CON.md`, and skips an entry it still cannot create. Unpacking reports bytes and stops on Cancel, and a whole archive may unpack to at most 4 GiB.

- **API:** `ZipArchive::open`, `new`, `entries`, `find`, `read`, `read_named`, `common_root`, `extract`, `ArchiveLimits`.
- **Wiring:** none. The importers use it.

## sqlite

A small read-only reader for SQLite files, written because the Windows Sticky Notes app keeps its notes in one and the crate has no SQLite library. It finds the tables, walks a table's b-tree, follows overflow pages, and applies the write-ahead log (`-wal`) beside the file, so notes from an app that is still open are not missing. Damaged files give an error and never a panic.

- **API:** `Database::open`, `from_bytes`, `tables`, `table`, `for_each_row`, `TableInfo`, `Row`, `Value`, `MAX_DATABASE_BYTES`. See the [sqlite](sqlite/README.md) folder.
- **Wiring:** none. The Sticky Notes importer uses it.

## text, csv, and dates

`text::decode` reads UTF-8, UTF-16, and Windows-1252 and says when it guessed. `csv::parse` reads comma, semicolon, and tab separated text with quotes. `dates::parse_date` and `parse_long_date` read the date forms other apps write.

## page_builder, tree, and assets

`PageBuilder` builds a core page from document blocks and files, with the dates of the source. It cuts a block whose Markdown is over 1 MiB into blocks of the same kind. Its `finish` refuses a page that the core would open as damaged. It also refuses one whose `page.json` would be over 64 MiB. The importer then leaves the page out and reports it. `SectionBuilder` builds the section file. `assets` makes asset table entries with spec 10.1 names, media types, sizes, and hashes.

## frontmatter, palette, and html

`frontmatter` reads and writes the flat YAML at the top of a Markdown note. `palette` maps the brand pens and highlighters to colors and back. `html` writes the document tree as HTML for the exports.

## testing

Generated notebooks and helpers for tests, behind the `testing` feature: `TestEnv`, `sample_notebook`, `describe_pages`, `zip_bytes`, and `zip_dir`.

## dest

Reads link and image destinations the way a browser does, so a tab hidden inside `javascript:` cannot pass a check.

- `clean` removes tabs and line breaks anywhere, and the control characters and spaces at the ends.
- `scheme` treats anything before a `:` that comes before the first `/`, `?`, or `#` as a scheme.
- `for_export` keeps web and email addresses and paths for the HTML export.
- `for_import` is the one allowlist of every importer. Web, email, and phone addresses stay, and so do OpenNote's own `wiki:`, `asset:`, and `opennote:` forms. A path is resolved against the files of the import. Everything else keeps only its text and counts as a link that cannot be followed.
- **API:** `clean`, `scheme`, `has_scheme`, `has_control`, `for_export`, `for_import`, `ImportLink`.
- **Wiring:** none. The HTML export and the importers use it.
