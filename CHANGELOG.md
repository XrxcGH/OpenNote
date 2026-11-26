# Changelog

All notable changes to OpenNote are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Contents

- [Unreleased](#unreleased)
- [0.1.0-beta.12](#010-beta12---2026-11-26)
- [0.1.0-beta.4](#010-beta4---2026-10-03)
- [0.1.0-beta.3](#010-beta3---2026-10-03)
- [0.1.0-beta.2](#010-beta2---2026-10-03)
- [0.1.0-beta.1](#010-beta1---2026-10-03)

## [Unreleased]

Nothing yet.

## 0.1.0-beta.12 - 2026-11-26

This is the beta 12 build. The beta branch is promoted into `main` with it. The block below lists the work since beta 7, which is the last version the changelog had a number for. Betas 5 to 7 have no section of their own here; the wiki's development updates say what they added.

### Added

- Format version 2 for text, tables, and code. A file is stamped 2 only when it holds version 2 data, and an older OpenNote refuses a file it cannot keep intact.
- Text formatting at Word and Google Docs level, behind the `text.v2Controls` flag. It covers font, size, weight, paragraph and list formats, footnotes and endnotes, the Symbol dialog, Alt+X, and formatting marks. Commands for each format are in the command catalog. The format painter, change case, repeat, and select similar are in the catalog too, and keys and buttons for them wait for the controls lane.
- Footnotes and endnotes: insert a note at the caret, edit it at the page foot or document end, and keep numbering in order.
- Copy writes formatting that Word and Google Docs keep, and paste keeps the source formatting, with Paste Options.
- Word import reads styles, themes, lists, notes, comments, and tracked changes. Word export writes every version 2 format, can embed bundled fonts, and can remove personal information.
- Carlito and Caladea load on demand as stand-ins for Calibri and Cambria, and the app lists the device's fonts with their metrics.
- A shared color palette for text and tables.
- Tables at Excel and Google Sheets level, behind the `tables.sheetWrites` flag: cell styles in `data.sheet`, number format codes, Excel-style formulas, names, LET and LAMBDA, dynamic arrays, and references across tables. The drawing layer is not wired into the table editor yet.
- The code studio's contracts, settings, flags, and strings. The code studio is off until the `code.studio` flag is on.
- Tab indents in the code editor, and Ctrl+Page Down and Ctrl+Page Up change tabs. Ctrl+Tab will accept a suggestion when code lane L01 lands.
- Calmer shell polish: Phosphor icons in the command bar, pens back on the bar at 1,280 px, and calm pressed and selected states.
- Beta 10 text controls: a styles gallery with Ctrl+Shift+S, font pickers backed by the device's fonts, the Home tab controls, HTML and PDF export that keep formatting, and Word import and export at version 2 fidelity.
- Beta 10 table work: Excel-style text, date, math, lookup, logic, and information functions, a formula bar, a table toolbar, spreadsheet keys, structure commands, and Word, HTML, and Markdown exports that keep cell styles. [Table function reference](docs/help/table-functions.md) lists every function.
- Beta 11 text work: find and replace by format and by special characters, a language and text direction menu with Do not check spelling, and an end-to-end check of the Find bar and the language menu.
- Beta 11 table work: merged cells, Format Cells (Ctrl+1) with number format codes, conditional formats, data validation, and the fill handle. Copy and paste keep formats and formulas for Excel and Google Sheets. There are 55 financial functions, the statistical and compatibility functions, and array and LAMBDA helpers. Large tables load rows as they scroll into view. Excel (.xlsx) export keeps formats, names, validation, and conditional rules.
- Beta 11 code studio work: the code editor on CodeMirror 6, code projects as a page block with save, export, and import, the run core with lockdown and limits, and runtime packs for Python, C and C++, and Ruby that download only after the person agrees. The studio stays off until the `code.studio` flag is on.
- Help pages for text formatting, table formatting, and the code studio, and an accessibility and performance end-to-end check for the text editor.
- Beta 12 code studio work: the studio window with a console, a Problems panel, and a Tests panel. Runtimes cover Python (quick and full), JavaScript and TypeScript, SQL, Lua, and C and C++.
- Beta 12 code help: live error checks, completion without a model, quick fixes with Ctrl+., and plain error explanations. Code cells now use the studio editor and support more languages.
- Beta 12 text work: page layout with breaks, headers and footers, columns, and line numbers. Comments, suggesting mode, and accept and reject also arrive.
- Beta 12 Word work: import reads theme colors, outline levels, and numbering links. Export embeds bundled fonts.
- Block-level merge on sync, with a merger and a conflict view per block type.
- ADRs 0056 to 0089 record these designs. Records 0056 to 0058, 0060, 0063, 0064, 0067, 0068, 0070, 0074, 0075, and 0079 to 0089 are Accepted. Record 0069 is Accepted, pending a hand test.

### Fixed

- Eleven walks of the real app by agents found and fixed about 190 bugs. They covered saving and recovery, with a notice and Retry when a page can't save. They covered ink, narrow layouts and large text, Excel and Word export, the code studio, and the math checker.
- Flaky tests are fixed at their causes, and the layout audit checks every screen for overlap and clipping.

### Changed

- Text keys follow Word, and Settings, Shortcuts offers a Google Docs set (Beta 10, ADR 0085). Some keys moved. Inline code is Ctrl+` and Ctrl+E now centers. Strikethrough is Ctrl+Shift+X, or Alt+Shift+5 in the Docs set. Ctrl+Shift+S applies a style once the styles gallery lands. Ctrl+Enter breaks the page on a paginated page, or toggles a task's check. Subscript is Ctrl+= and superscript is Ctrl++. The old keys stay until the new text controls are on.
- The dark theme's neutral colors are a charcoal gray, not brown.
- The save status in the title bar says Saving until an edit is written, and Saved only once it is. A closed page stays Saving until its last edit is saved.
- The custom title bar is recomputed, so the Windows title bar no longer stays above OpenNote's own.
- The feature list ([docs/FEATURE-LIST.md](docs/FEATURE-LIST.md)) is made from the app's registries, so it lists every command, title bar item, tool window, and kit tab by category.

- OpenNote uses American English by default, even when Windows uses another language. One language setting (Settings, Language) now sets spell check, the dictionary, hyphenation, the read-aloud voice, handwriting and math recognition, and text in pictures, and first-run setup has a Language and spelling step with English (United States) chosen. The interface text stays in American English for now. The spelling check in CHECKS also reads the text in string literals, so a British spelling in the app's text is caught.
- Quick capture no longer takes Ctrl+Alt+Q, which AltGr+Q also presses and which types @ on many keyboards. It is off until it is turned on in Settings, where the shortcut can be chosen and a clash with OpenNote's own keys is shown. A beta 4 profile that kept Ctrl+Alt+Q gets no shortcut until new keys are chosen, and its switch can still be turned off.
- Search by meaning and text in images keep nothing of a page in a protected section, and drop what they kept of a page whose section becomes protected.

### Foundation

- Set up the project structure for Windows development with Tauri 2
- Integrated TypeScript and React for the user interface
- Configured continuous integration with automated checks and tests
- Established the release workflow for signed, stable builds

### On-device intelligence

- The 64-bit build reads speech with whisper.cpp, translates with ONNX Runtime, and writes Ask answers and writing suggestions with a language model that runs on the computer
- Language models, a meaning model, and translation packs download only after the person sees the size and agrees, from addresses pinned to one commit and checked against a published checksum
- Without a downloaded model, Ask quotes the pages and the writing tools use rules, and the screen says which wrote the answer
- Translate, dictation, live captions, and handwriting to math have browser tests

### Releases

- Each release ships three Windows files: one for 64-bit PCs, one for 32-bit PCs, and one for Arm PCs
- Each release lists what OpenNote is made of, and publishes a checksum for every file
- The update notice shows the release notes for the new version
- A release is checked the way the app checks an update before anyone can download it
- Windows package manager (winget) files are made for every stable release

### Changed (may break scripts)

- The `opennote` command reads `--file` and writes `export` and `render` files only inside the current folder. Scripts that use other folders now need `--read-root FOLDER` or `--write-root FOLDER`; network folders and Windows device names are always refused
- An agent's `--author` label in page history drops the word "via", quotes, and unpaired brackets, so it can't read as another app's change

### Experiments

- Evaluated ink drawing performance with Surface Pen and Wacom tablets
- Tested placing text editors on a zoomable canvas alongside handwriting
- Prototyped PDF export to verify page layout fidelity
- Built audio recording support for microphone and system audio capture

## 0.1.0-beta.4 - 2026-10-03

Unsigned, for Windows, with no installer and no self-update. Agents only started it and opened each main screen. The hand test is [the beta 4 checklist](docs/testing/beta-4-checklist.md).

### Added

- Smart tables, charts, math, and the grapher, with calculated columns, board, calendar, gallery, and timeline views, Mermaid diagrams, and mind maps
- Search and links: the search panel, the quick switcher, page and paragraph links, backlinks, tags, daily notes, the graph view, and replace across notebooks
- Recording with stamped notes, flags, trim, system audio, transcript blocks, speakers, and meeting recaps
- Import and export for Markdown, Obsidian, Word, HTML, Excel, PowerPoint, email, Kindle, and Readwise files, with a review and undo
- On-device intelligence, all off until turned on: text in pictures, read aloud, summaries, handwriting to text, search by meaning, Ask your notes, and writing tools
- Hardening and privacy: crash reports with consent, a self-check, a feedback file, safe start, and Work offline
- Study tools: flashcards, Anki and CSV, study tape, Upcoming, timers, a calculator, a unit converter, and citations
- Quality-of-life features in eleven areas, 142 in all, such as pen gestures, insert space, page templates, find and replace, layout presets, tabs, focus mode, quick capture, and scheduled backups
- Settings > Connectors, with sign-in for six services and tokens for three more, kept in Windows Credential Manager
- Real screenshots of every screen, 34 redrawn wireframes, and a help page for each area of the app

### Changed

- A new page has its title and a gray "Changed" line only, with no date text box
- On lined, grid, and dot paper, text rests on the rules like handwriting, and text boxes snap from rule to rule
- The page area shrinks with a narrower window or pane, with no empty strip to scroll into
- The start-up bundle limit rose from 250 KB to 300 KB gzipped to fit the new features

### Fixed

- A stray box beside each to-do checkbox
- A sideways scroll bar under the page at 150 percent display scale

### Not built yet

- 26 features, including the pen library, PDF import, the local API, the web clipper, and the speech engine for transcripts. [FEATURES.md](docs/FEATURES.md) marks each one.
- 15 features wait on the owner's accounts, app registrations, or a decision about the note format.

## 0.1.0-beta.3 - 2026-10-03

### Added

- The typed notes editor: headings, lists, checklists, quotes, code, tables, images, and the formatting bar
- The "desk by the window" look, with new setup screens
- Ink: the Draw tab with pens, a highlighter, two erasers, the lasso, and ink to shape, with palm rejection while a pen is near
- Page views: infinite canvas and pages with breaks, paper and backgrounds, a gallery, slides, and reading aids
- Export as PDF, picture, HTML, or Markdown, and Print

### Fixed

- A page with handwriting no longer scrolls sideways
- The lasso's bar stays inside the page view
- Lassoed text boxes move together with their ink

## 0.1.0-beta.2 - 2026-10-03

### Added

- Trash with Restore for deleted pages, sections, section groups, and notebooks
- Opening a notes folder on another computer shows its notebooks
- Beta 1 notes move over by themselves on the first start, and a copy of the old files is kept

### Changed

- The notes folder holds all of your notes in OpenNote's open note format. Each notebook is a folder with its sections, pages, history, images, and Trash.
- The big heading on a page and its name in the list are one title
- New notebook opens the new notebook

### Fixed

- A horizontal scroll bar showed under the page when nothing was off to the side

## 0.1.0-beta.1 - 2026-10-03

The first beta build, for Windows, unsigned.

### Added

- First-run setup with a look, a notes folder, and a first notebook, and an offer to add OpenNote to the Start menu
- Notebooks, sections, and pages, with headings, bulleted lists, bold text, the slash menu for code blocks and tables, and undo and redo
- Pages that save as you type and come back after a restart

[Unreleased]: https://github.com/XrxcGH/OpenNote/compare/main...main
