# disk

Writes imports to disk and reads exports from disk, through the core's own storage code. Nothing here needs a running core session.

## What it does

`DiskSink` lays an import out as a notebook folder (spec 3). It writes `notebook.json` and each `section.json` with the core's codec, and each page with the core's `write_page_dir`, so a page gets the same files and first revision as a page the person saves. Assets go to the page's `assets` folder under the name in the asset table.

The sink works in a hidden folder named `.importing-<notebook ID>`. `finish` renames it to the notebook's title (and adds ` (2)` and so on when the name is taken), and `abort` deletes it. A canceled or failed import therefore leaves no folder, and a crash leaves only a hidden folder that the next start can delete.

`DiskSource` reads a notebook folder for an export. It reads `notebook.json`, every `section.json`, and pages with the core's `read_page_dir`. A section that cannot be read is skipped and listed in `unreadable()`.

## Public API

| Item | Use |
|---|---|
| `DiskSink::standard(parent)` | An import sink on the real file system |
| `DiskSink::new(fs, codec, parent)` | The same with the core's file system and codec seams, for tests |
| `DiskSink::notebook_dir()` | The finished notebook folder, after the import returned |
| `DiskSource::open(dir)` | A `NoteSource` for any notebook folder |
| `DiskSource::unreadable()` | Sections that could not be read, with the reason |

## What the UI wiring needs

1. Build the `DiskSink` with the parent folder where the person keeps notebooks, run the import on a worker thread, then call `Core::open_notebook` on `notebook_dir()`. That adds the notebook to the library.
2. Remember the folder in the import log, so "Undo this import" can close the notebook and move its folder to the system trash.
3. Flush the open pages of a notebook (`Core::flush_all`) before building a `DiskSource` for it, because the source reads files, not the live session.
