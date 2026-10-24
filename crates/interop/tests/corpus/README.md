# Import corpus

This folder holds one small export from each app that OpenNote imports. `tests/corpus.rs` imports every case with no help, checks the page and section counts, and writes each result through the core's storage into a folder that a real core opens and verifies.

## Cases

| Folder | Source app | What it shows |
|---|---|---|
| `obsidian/Vault` | Obsidian | Front matter with dates, tags, and aliases, wiki links, embeds, callouts, highlights, tasks, a table, and a PDF attachment |
| `joplin/Export` | Joplin (Markdown export) | Front matter, `_resources` pictures linked as `:/id`, and links between notes |
| `logseq/graph` | Logseq | Page properties, outline bullets, `TODO` and `DONE`, long tags, block references, embeds, a logbook, and a journal page |
| `notion/Export` | Notion (Markdown and CSV) | Names with IDs, subpage folders, a callout, a database with row pages, and the `_all` copy of its CSV |
| `../data/sample.enex` | Evernote | Notes with tags, source addresses, attachments, to-dos, and tables |
| `word/onenote-section` | OneNote (Word export), unpacked | Two pages in one document, the date lines under the title, nested lists, a table with a merged cell, a picture, a text box, a footnote mark, and hidden text. The test packs the folder into a `.docx` |
| `onenote-mht/Lecture 3.mht` | OneNote (web page archive) | A MIME message with quoted-printable HTML, pictures found by path and by file name, and links to OneNote itself |
| `html/site` | Any website folder, or OpenNote's HTML export | Unclosed tags, links between pages, a local picture, a table, a code block, and a script |
| `text/notes` | Windows Notepad and similar | Lists, paragraphs, and a folder of text files |
| `keep/Takeout` | Google Keep (Takeout) | A checklist, labels, a picture, audio, a web link, an archived note, and a note in the Trash |
| `textbundle/Bear` | Bear (TextBundle) | A bundle with a heading and a picture, and a bundle named by its folder |
| `csv/data` | Spreadsheets | A comma separated file with quotes and line breaks, and a tab separated file |

The Notion case is also imported as a ZIP archive, which the test builds from the folder.

## Adding real exports

Real notebooks that testers donate, with their permission, do not go into this repository. To run the same checks on them, set `OPENNOTE_CORPUS` to a folder and run the ignored test:

```
OPENNOTE_CORPUS=D:\donated cargo test -p opennote-interop --test corpus -- --ignored
```

Each file or folder directly inside that folder is one case. The test detects its kind, imports it, and fails on any import that stops with an error. It prints a line for each case with its page count and the number of parts the report lists as lost.

## Making a new case

Keep a case small, because every case runs on each build. Make up the content, so no one's notes are in the repository. Put a picture or attachment in only if the case is about attachments. Then add a row to `CASES` in `tests/corpus.rs`, and a row to the table above.
