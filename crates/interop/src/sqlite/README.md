# sqlite

A read-only reader for SQLite database files, written because the Windows Sticky Notes app keeps its notes in one and the crate has no SQLite library. It reads tables only. It cannot run SQL, use an index, or write.

## Files

- `../sqlite.rs` opens a database as bytes, finds the tables in `sqlite_master`, and walks a table's b-tree. It joins overflow pages and decodes records into `Value`s.
- `wal.rs` reads the write-ahead log (`-wal`) that sits beside the file. An app that is still open keeps its newest rows there. Only frames that SQLite committed are used, and a frame counts only if its salt and checksum agree with the log's header.
- `tests.rs` holds the reader's unit tests, among them a looping overflow chain behind a log that claims a huge size.
- `schema.rs` reads the column names out of each `CREATE TABLE` statement, and finds the column that is the row ID itself.

## Public API

| Item | Use |
|---|---|
| `Database::open(path)` | Reads the file and its log. A file or a log over `MAX_DATABASE_BYTES` (1 GiB) is refused |
| `Database::from_bytes(main, wal)` | The same, from bytes |
| `Database::tables`, `Database::table(name)` | The tables, found without regard to case |
| `Database::for_each_row(table, visit)` | Calls `visit` for each row in row ID order. A callback that fails stops the walk |
| `Row::get(column)`, `Row::text(column)` | A column's `Value`, or its text. A missing column is `Null` |

Damaged files give an `InteropError::Format` and never a panic. Every read checks its bounds, and a page may be visited only once. A row may not claim more bytes than the file and the log hold. An overflow chain stops after the pages its length needs, and may not use a page twice. A log's commit counts only the pages that the file or the log really holds, whatever size it claims. The text encodings UTF-8, UTF-16LE, and UTF-16BE are read.

## What the UI wiring needs

Nothing. The Sticky Notes importer uses this module, and no other part of the app should need it.
