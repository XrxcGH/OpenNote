# import/word

Reads Word files (`.docx`), including the section exports that OneNote writes. A `.docx` file is a ZIP archive of XML parts.

## What it does

- `package.rs` opens the archive and reads the document part, its relationships, the styles, the list definitions, the theme, the footnotes, endnotes, and comments, the settings, and the properties (title, dates, and keywords). It caps what one file may unpack: 64 MiB for each part or picture, a million elements for each XML part, and 512 MiB for the whole file. Pictures past that total are left out and reported.
- `props.rs` reads `w:rPr` and `w:pPr` into layers, and lays them in ECMA-376 Part 1, 17.7.2 order: document defaults, table style, paragraph style, character style, then direct formatting. Toggle properties (bold, italics, caps, strikethrough, and the others of 17.7.3) flip in styles and set in direct formatting, so bold in the paragraph style plus bold in the character style is not bold.
- `styles.rs` follows `basedOn` chains (at most 16 steps, no loops), knows what a paragraph style means (a title, a heading level, a quote, or code), and names each style for OpenNote: `normal`, `title`, `h1` to `h9`, `quote2`, or a user style `u-` plus its ID.
- `theme.rs` reads `theme1.xml`: theme fonts such as `minorHAnsi`, and theme colors with `w:themeTint` and `w:themeShade` applied in HSL.
- `marks.rs` turns resolved run properties into marks: fonts, sizes in points, underline styles and colors, single and double strikethrough, caps, letter spacing, scale, raised and lowered text, kerning, OpenType features, effects, boxes, the 16 exact highlight colors, shading, language, and direction. A run gets only the marks its paragraph's style does not already give. Where a run turns off a style's bold, italics, underline, strikethrough, or caps, it gets a plain character style such as `u-plain-b`.
- `paras.rs` turns paragraph properties into `data.paras`: alignment, indents, spacing, line spacing, keep and break flags, tab stops, borders, shading, direction, language, outline level, drop caps, and hyphenation.
- `numbering.rs` reads list definitions into `data.lists`. Lists that share a definition count on as one list. A restart is a definition of its own, and its first item restarts.
- `notes.rs` reads the text of footnotes, endnotes, and comments, with the replies and resolved state of `commentsExtended.xml`.
- `body.rs` reads paragraphs, runs, hyperlinks, tables, pictures, and text boxes. Footnote and endnote references become `[^id]` with their text in `data.notes`. Comment ranges become comment marks with their records in `data.comments`. Tracked insertions, deletions, and format changes become suggestions with their authors and times, or the import accepts or rejects them all. A link drops Word's blue underline.
- `sheet.rs` builds the page style sheet: the document defaults and Normal as `normal`, and every paragraph style the document uses, each with the values Word resolves for it. It also writes the page theme.
- `section.rs` reads the first section's paper and margins, its header and footer as print bands with `{page}`, `{pages}`, `{date}`, and `{title}` fields, and the default tab stop and hyphenation of `settings.xml`.
- `assemble.rs` turns the paragraphs of one page into blocks, each with the formatting of its elements in document order. List paragraphs become nested lists, checkbox glyphs become task lists, runs of code and quote paragraphs join, and a shaded group with a bold first line becomes a callout.
- `pages.rs` decides how a document becomes pages, and reads the date and time lines that OneNote writes under a title.
- `mod.rs` builds the pages: text blocks with their element IDs, styles, `paras`, and the lists, notes, comments, and suggestions they name, tables and pictures as their own blocks, and the style sheet, theme, paper, and bands on every page. It points links at bookmarks on page titles, and writes the report, which counts each kind of thing that was dropped or simplified.

## Cutting a document into pages

`WordPages::Auto` cuts at Title paragraphs when there are two or more. Otherwise it cuts at hard page breaks if each part starts with a short line, and else it keeps one page. `Single`, `ByTitle`, and `ByPageBreak` force one rule. A Subtitle right above a Title names the section, which is how OpenNote's own Word export writes sections.

## Public API

`import_docx(path, env, sink)`, `import_docx_with(path, pages, env, sink)`, and `import_docx_options(path, &WordImport, env, sink)`. `WordImport` holds the `WordPages` rule and `TrackedChanges`: `Suggest` (the default), `Accept`, or `Reject`. The path can be a file or a folder. Each file becomes a section, or several sections when it names them.

## What it leaves out

Hidden text stays out and is counted. Glow, reflection, 3-D, and gradient text are dropped and counted. Sections after the first, pictures and tables in headers, notes, comments, and suggestions inside table cells, and changes to paragraph marks are reported. A run keeps one font: the font of its script.

## What the UI wiring needs

An "Import from Word" choice, a choice among the `WordPages` rules for documents that hold many pages, and Keep as suggestions, Accept all, or Reject all for tracked changes. The default is right for OneNote's exports. The report names everything that did not come over, and the dry run shows it first.

## Tests

`tests.rs` and `tests_more.rs` import whole files: hand-written parts, and the fixtures in `crates/interop/tests/fixtures/word-v2/import/`, which are laid out as Word and Google Docs save documents. Each fixture's expected values are converted from its XML by hand, from ECMA-376 units.
