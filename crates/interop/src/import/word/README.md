# import/word

Reads Word files (`.docx`), including the section exports that OneNote writes. A `.docx` file is a ZIP archive of XML parts.

## What it does

- `package.rs` opens the archive and reads the document part, its relationships, the styles, the list definitions, and the properties (title, dates, and keywords). It notes which parts hold content that this import skips, such as footnotes and headers. It caps what one file may unpack: 64 MiB for each part or picture, a million elements for each XML part, and 512 MiB for the whole file. Pictures past that total are left out and reported.
- `styles.rs` tells what a paragraph style means: a title, a heading level, a quote, or code. It follows `basedOn` chains. It also reads list definitions to tell bullets from numbers.
- `body.rs` reads paragraphs, runs, hyperlinks, tables, pictures, and text boxes. A run keeps bold, italic, underline, strikethrough, script, color, highlight, and a code font. A link drops Word's blue underline.
- `assemble.rs` turns the paragraphs of one page into blocks. List paragraphs become nested lists, checkbox glyphs become task lists, runs of code and quote paragraphs join, and a shaded group with a bold first line becomes a callout.
- `pages.rs` decides how a document becomes pages, and reads the date and time lines that OneNote writes under a title.
- `mod.rs` builds the pages, places the pictures, points links at bookmarks on page titles, and writes the report.

## Cutting a document into pages

`WordPages::Auto` cuts at Title paragraphs when there are two or more. Otherwise it cuts at hard page breaks if each part starts with a short line, and else it keeps one page. `Single`, `ByTitle`, and `ByPageBreak` force one rule. A Subtitle right above a Title names the section, which is how OpenNote's own Word export writes sections.

## Public API

`import_docx(path, env, sink)` and `import_docx_with(path, pages, env, sink)`. The path can be a file or a folder. Each file becomes a section, or several sections when it names them.

## What the UI wiring needs

An "Import from Word" choice, and for documents that hold many pages, a choice among the `WordPages` rules. The default is right for OneNote's exports. The report names everything that did not come over, and the dry run shows it first.
