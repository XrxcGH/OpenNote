# import

Reads notes from other apps and writes them to an `ImportSink` as pages in a new notebook. Every importer returns a `Report`, takes an `ImportEnv`, checks for Cancel between pages, and calls the sink's `finish` on success or `abort` on any error.

## How it fits together

Most importers read a folder of note files through one driver, `folder.rs`. The driver walks the folder, plans the sections, resolves links and attachments, and writes pages. A `NoteReader` supplies the parts that depend on the format.

| Reader | File | Reads |
|---|---|---|
| `MarkdownReader` | `markdown.rs` | Obsidian, Joplin, and plain Markdown, with front matter |
| `LogseqReader` | `logseq.rs` | Outline pages, properties, tasks, and journals |
| `NotionReader` | `notion.rs` | Pages with IDs in their names, row properties, and CSV databases |
| `HtmlReader` | `html.rs` | HTML pages, using `html_note.rs` and the tolerant parser in `htmltree.rs` |
| `TextReader` | `plain.rs` | Text files |
| `KeepReader` | `keep.rs` | Google Keep JSON notes |
| `TextBundleReader` | `textbundle.rs` | Bear's TextBundle folders |
| `CsvReader` | `sheet.rs` | CSV and TSV files as tables |

Three other drivers cover sources that are not folders of notes. `files.rs` imports each Word or web page archive file as a section: see [word](word/README.md) and `mht.rs`. `enex.rs` streams Evernote export files note by note. `sticky.rs` reads the Windows Sticky Notes database through the `sqlite` module.

## Public API

| Function | Reads |
|---|---|
| `import_markdown_folder` | A folder or file of Markdown. It picks the Notion or Logseq reader when the folder looks like one |
| `import_notion_folder`, `import_logseq_folder` | The same, when the caller knows the kind |
| `import_html_folder`, `import_text_folder`, `import_csv` | HTML pages, text files, and CSV files |
| `import_keep_folder`, `import_textbundle_folder` | Takeout and Bear exports |
| `import_enex`, `import_enex_reader` | An Evernote file, a folder of them, or ENEX text from any reader |
| `import_docx`, `import_docx_with` | Word files |
| `import_mht` | Web page archives |
| `import_sticky_notes`, `sticky_notes_database` | The Windows Sticky Notes database, and where this PC keeps it |
| `Flavor` | Which app made a Markdown folder |

## Links, pictures, and attachments

`scan.rs` lists the notes and other files of a folder, and finds the file or note that a link names: by relative path, by bare name, by alias, or by Joplin's `:/id`. `links.rs` rewrites each link and picture of a note. A link to a note becomes `opennote:page/<ID>`. A picture or file becomes an asset of the page. A picture embedded as a `data:` address becomes an asset too. Links that cannot work, such as a link to a heading, keep only their text, and the report counts them.

## Reports

A report entry says what came over, what was simplified, and what was skipped, with a reason. Each reader adds the entries that only it knows, such as Logseq's block references. The driver adds the dates, the tags, the tables, the links, and the text encoding.

## What the UI wiring needs

Nothing in this folder talks to the interface. The wiring calls `import` from `job.rs`, which picks the importer from `detect`.
