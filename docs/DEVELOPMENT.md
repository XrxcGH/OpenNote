# OpenNote development plan

This plan takes OpenNote from an empty repository to a stable Windows release, one tested feature at a time. Windows comes first. Every choice keeps the door open for macOS, Linux, iOS and Android later, and for screens from phones to wide monitors. The plan builds on [RESEARCH.md](RESEARCH.md) for what to build, [BRAND.md](BRAND.md) for how it looks and feels, and [CHECKS.md](CHECKS.md) for the quality gate.

## Contents

1. [How this plan works](#1-how-this-plan-works)
2. [Technology choices](#2-technology-choices)
3. [Repository layout](#3-repository-layout)
4. [Note file format](#4-note-file-format)
5. [Phases](#5-phases)
6. [Testing strategy](#6-testing-strategy)
7. [Device test matrix](#7-device-test-matrix)
8. [Continuous integration and releases](#8-continuous-integration-and-releases)
9. [Distribution and updates](#9-distribution-and-updates)
10. [Release checklist](#10-release-checklist)
11. [Definition of done](#11-definition-of-done)
12. [Working agreements](#12-working-agreements)
13. [Risks](#13-risks)

## 1. How this plan works

The work is split into phases. Each phase adds a small set of features and ends with an exit gate: a list of tests and measurements that must pass before the next phase starts. Short experiments (spikes) come first, so risky choices are proven before much code depends on them.

Unfinished features stay behind feature flags. The main branch must always build, pass every test, and run without crashing, even when a feature is half done. A feature leaves its flag only after it meets the [definition of done](#11-definition-of-done).

Every change, from a typo fix to a new feature, goes through the same path: branch, pull request, automated checks, review, merge. Nothing reaches users without passing the [release checklist](#10-release-checklist).

## 2. Technology choices

| Layer | Choice | Why |
|---|---|---|
| App shell | Tauri 2 (Rust, with WebView2 on Windows) | Small installs and low memory. One codebase for Windows, macOS, Linux, iOS, and Android. |
| Core logic | Rust library crates | Fast, memory-safe code for storage, search, audio, and import that runs on every platform |
| Interface | TypeScript, React, and Vite | The largest pool of contributors and components. Drawing bypasses React to stay fast. |
| Rich text | ProseMirror through Tiptap | Proven editor with tables, Markdown shortcuts, and collaboration support for later |
| Ink | Custom canvas renderer | Pointer Events with pressure and tilt, coalesced and predicted points, a low-latency canvas, and perfect-freehand for stroke shapes |
| Charts | Observable Plot | Clear defaults, and vector (SVG) output stays sharp in PDFs |
| Math | KaTeX to display, MathLive to edit | Fast rendering, and equation input that works with a pen or keyboard |
| Code and diagrams | CodeMirror 6 and Mermaid | Loaded only when a page uses them, so start-up stays fast |
| Search | SQLite full-text search (FTS5) through rusqlite | Instant local search that can be rebuilt from the note files at any time |
| Audio | cpal for capture, Opus for storage | Microphone and Windows system audio (WASAPI loopback) with small files |
| On-device intelligence | whisper.cpp for speech, Windows.Media.Ocr for images | Private, offline, and free. Other platforms swap in their own engines behind the same interface. |

The rule of thumb is that anything platform-specific sits behind a small Rust or TypeScript interface. Pen input, audio capture, optical character recognition (OCR) and neural processing unit (NPU) acceleration each get one. Porting to a new platform means writing new adapters, not rewriting features.

Large decisions are written down as architecture decision records (ADRs) in `docs/adr/`. Each one records the choice, the options considered, and why.

## 3. Repository layout

```text
app/
  src/            TypeScript interface: shell, editor, ink, views
  src/theme/      Theme code; tokens.css and tokens.ts, built from brand/tokens.json, are the only files with raw design values
  src-tauri/      Rust shell: windows, menus, commands the interface calls
crates/
  core/           Document model, file format, storage, undo history
  search/         Full-text index, saved searches, and the link graph between pages
  media/          Audio capture and encoding, transcription, OCR adapters
  intel/          On-device OCR, handwriting, read aloud, summaries, and transcription, with no network access (see docs/intel.md)
  interop/        Import and export: Markdown, HTML, DOCX, PDF, OneNote, Evernote
brand/            Design tokens, logo and icon
checks/           The CHECKS quality gate
docs/             The plan, feature spec, research, brand guide, and CHECKS guide
docs/adr/         Architecture decision records
docs/design/      Screen wireframes, generated from the design tokens
docs/format/      The note file format specification
spikes/           Throwaway Phase 1 experiments and their results
tests/e2e/        End-to-end tests that drive the real app
tests/perf/       Performance benchmarks and large sample notebooks
```

## 4. Note file format

The file format is the most important long-term decision, because every future platform must read it. It is designed in Phase 3 and published in `docs/format/` before any user data exists.

- A notebook is a folder. Sections are subfolders. Each page is a folder holding `page.json`, an `assets/` folder for images, PDFs and audio, and `page.md`.
- `page.json` is the source of truth. It stores blocks (text, ink, tables, charts, math, images) with their positions and timestamps. Text inside blocks is stored as Markdown.
- Ink strokes store raw points: position, pressure, tilt, and time. Rendering can improve later without changing the data.
- `page.md` is a readable copy written on every save, so notes stay useful even without OpenNote.
- Every file carries a `formatVersion`. Older versions are upgraded by tested migrations, never by hand.
- Saves are atomic: write to a temporary file, flush it to disk, then rename. A crash can't leave half a page.
- The search index lives in the local app data folder. It is a cache and can be deleted and rebuilt at any time.

## 5. Phases

Each phase lists what to build, how to test it, and when it is done. Time estimates are left out on purpose; the exit gates decide when to move on.

Each phase below opens with a status note for beta 4 (0.1.0-beta.4). A note says what is built, what is not, and how it was checked. The plan's own wording is unchanged.

How the beta branch was checked:

- Agents ran the type check, lint, Clippy, and the unit tests. The JavaScript suites had 4,247 passes. Three failures were fixed, and four timing tests, which ran while Rust was building, were not rerun.
- The Rust tests passed (2,577), and agents started the real exe and opened each main screen once.
- Agents did not run the browser UI tests, the component tests, or the real-device tests.
- Nobody has checked beta 4 by hand yet. The hand test is [the beta 4 checklist](testing/beta-4-checklist.md).

### Phase 0: Foundation

Status: done and merged.

- Built: The toolchains, CI, the release workflow, and the templates.
- Needs the owner: The update signing key belongs to the owner, and the release pipeline has not run yet.

Build:

- Install the toolchains: Node.js 22 LTS, Rust stable, and the Tauri prerequisites for Windows.
- Scaffold the Tauri app with an empty window that uses the brand tokens.
- Add linting and formatting: ESLint and Prettier for TypeScript, Clippy, and rustfmt for Rust.
- Set up continuous integration (CI) on `windows-latest`: CHECKS, lint, type-check, tests, and a debug build.
- Add the release workflow from [section 9](#9-distribution-and-updates): pushing a version tag builds the Windows exes and publishes a GitHub Release. Create the update signing key and store it as a GitHub secret.
- Add issue and pull request templates, the ADR template, and a code of conduct. Choose the license (see [Risks](#13-risks)).

Done when: a fresh clone builds and opens a window with one command on Windows, and CI passes.

### Phase 1: Spikes

Status: done and merged.

- Built: Each spike has a record (ADRs 0004 to 0007), and its code is in `spikes/`.
- Needs the owner: ADR 0004 still waits for the owner’s camera check of ink latency.

Four throwaway experiments answer the riskiest questions before real code depends on them.

1. **Ink latency.** Draw with a Surface Pen and a Wacom tablet in WebView2. Measure pen-to-screen time with a high-speed phone camera (240 frames per second).
2. **Text on a freeform page.** Place several Tiptap editors on a zoomable canvas, mixed with ink, and check typing latency.
3. **PDF export.** Print a paginated page through WebView2's print-to-PDF and compare it with the screen.
4. **Audio capture.** Record the microphone and system audio at the same time with cpal.

Done when: each spike has an ADR with measurements. If ink latency misses the 25 ms budget in BRAND.md and can't be fixed, the ADR switches the interface to Flutter before Phase 2.

### Phase 2: App shell and navigation

Status: done and merged on 2026-10-02 ([pull request #8](https://github.com/XrxcGH/OpenNote/pull/8)).

- Built: The shell, and all 21 shell extras of beta 4: multi-select, pins, tabs, dock, portable mode, scheduled backups, focus mode, quick capture, the OneNote shortcut set, and more.
- Not built: The self-updater is built but not used. The beta exe is unsigned and has no updater.
- Checked by agents: It passed its component, keyboard, and screen tests when it merged. On beta 4, only the unit tests and a start-up run.
- Checked by hand: Not yet. See section 2 of [the beta 4 checklist](testing/beta-4-checklist.md).

Build:

- Generate CSS custom properties and a typed module from `brand/tokens.json`.
- Add light and dark themes with the dark mode setting from BRAND.md: Light, Dark, or Match Windows. Include the title bar toggle, Ctrl+Shift+D, and the "Choose your look" onboarding step, plus support for Windows contrast themes.
- Build the responsive layout from BRAND.md section 6: three panes on wide windows, down to one pane on narrow ones.
- Add the notebook, section, and page tree with create, rename, reorder, color, and delete (to Trash).
- Add the command bar, a command palette (Ctrl+K), keyboard navigation and a shortcut list (Ctrl+/).
- Add a settings page and first-run onboarding, including where to keep the app.
- Add the self-updater from [section 9](#9-distribution-and-updates), so every test build after this one updates itself.

Test: component tests for every control, keyboard-only end-to-end (E2E) tests of navigation, automated accessibility checks, and screenshot tests at each size class in both themes. Theme tests confirm that first-run setup preselects the Windows setting, that switching keeps scroll position and selection, and that start-up never shows the wrong theme.

Done when: the shell meets the start-up and feedback budgets, and passes the keyboard and screen reader checklist in [section 6](#6-testing-strategy).

### Phase 3: Document model and storage

Status: done and merged on 2026-10-03 ([pull request #9](https://github.com/XrxcGH/OpenNote/pull/9)).

- Built: Notebook folders, the journal, page history, and Trash.
- Checked by agents: Crash tests that kill the app during saves run in CI (`tests/crash`).
- Checked by hand: Not yet. See section 1a and 3 of [the beta 4 checklist](testing/beta-4-checklist.md).

Build:

- Write the file format specification and implement it in `crates/core`.
- Add reading, writing, and atomic saves, with autosave one second after the last change.
- Add crash recovery from a small write-ahead journal.
- Add undo and redo as commands on the document model, shared by text, ink, and every later block type.
- Add Trash with restore, and a page history of saved versions.

Test:

- Property-based tests that generate random pages, save and reload them, and require identical results.
- Fuzz tests that feed corrupted files to the reader: it must report an error, never crash.
- A crash-safety test that kills the app during saves 1,000 times and checks that no page is ever damaged.

Done when: all three test types pass, and a 1,000-page sample notebook opens within budget.

### Phase 4: Typed notes

Status: done and merged on 2026-10-03 ([pull request #15](https://github.com/XrxcGH/OpenNote/pull/15)).

- Built: The typed notes editor, and all 18 extras of beta 4, such as wrapping text around pictures, templates, find and replace, and page embeds.
- Checked by agents: Typing speed is measured in [docs/perf/phase-4.md](perf/phase-4.md), which also lists what is still over budget.
- Checked by hand: Not yet. See section 4 of [the beta 4 checklist](testing/beta-4-checklist.md).

Build:

- Add text containers that can be placed anywhere on a page (the OneNote model), or stacked in a simple document flow.
- Add headings, lists, checkboxes, bold, and italic, links, quotes, and callouts.
- Add Markdown shortcuts as you type (for example `# ` for a heading), and Markdown paste.
- Add images by paste, drag, or file picker, with resize and crop.
- Add basic tables and code blocks with syntax highlighting.
- Add spell check using the Windows spelling service.

Test: editor unit tests for every command, E2E tests for writing and formatting a page, a typing-latency benchmark, and paste tests from Word, OneNote, web pages, and plain text.

Done when: typing stays within 16 ms on the reference laptop with a 20-page-long note.

### Phase 5: Ink

Status: built, and in beta testing on branch `beta`.

- Built: Pens, the highlighter, erasers, the lasso, shapes, and palm rejection, with 21 of the 24 extras. They include gestures, insert space, replay, and handwriting to text.
- Not built: The pen library (fountain, brush, calligraphy, dashed, dotted), strokes in the audio stamp index, and links on handwriting.
- Needs the owner: Layers (a format decision), pen settings sync, and pen writing in text fields.
- Checked by agents: Unit tests, the 10,000-stroke benchmark ([docs/perf/phase-5-core.md](perf/phase-5-core.md)), and the palm replays ([docs/perf/palm-accuracy.md](perf/palm-accuracy.md)). Two palm timing tests and two highlight idle-time tests failed under load and were not rerun.
- Checked by hand: Not yet. That includes the real-pen test in [docs/testing/palm-rejection.md](testing/palm-rejection.md).

Build:

- Add pens, pencil, and highlighter with pressure and tilt, using the pen colors from `brand/tokens.json`.
- Add a stroke eraser and a partial eraser, and the pen's own eraser button.
- Add palm rejection: while a pen is near the screen, touch never draws.
- Add a lasso that selects ink and text together, to move, resize, recolor, or delete them.
- Add shape recognition for lines, rectangles, circles, and arrows.
- Render finished strokes into cached tiles so large pages stay smooth.

Test: geometry unit tests, recorded pen sessions replayed in E2E tests, a latency benchmark, a 10,000-stroke page benchmark, and manual testing on every pen device in the [matrix](#7-device-test-matrix).

Done when: the pen-to-screen and frame-rate budgets pass on the reference laptop and a Surface Pro.

### Phase 6: Page views and export

Status: built, and in beta testing.

- Built: Flow, paginated, and canvas views, lined, grid, and dot paper with text on the rules, PDF, image, and Word export, print, slides, the gallery, and reading aids. All 11 extras are built.
- Not built: The PDF choice in the Import and export dialog is not connected (the `interop.exportPdf` flag is off). A page’s Export and Print still make PDFs.
- Checked by agents: Unit tests. The ruled-paper browser test passes 10 of 12 cases. Print and PDF on ruled paper were checked by tests and by reading the code, not by printing.
- Checked by hand: Not yet. See section 6 of [the beta 4 checklist](testing/beta-4-checklist.md).

This phase delivers the owner's top request: seeing page breaks.

Build:

- Add a per-page switch between infinite canvas and paginated view (Letter, A4, or custom), with visible margins and page breaks.
- Add manual page breaks, "keep together" for images and tables, and a default paper size per notebook.
- Add paper backgrounds: plain, lined, dot grid, graph, and Cornell.
- Add print and PDF export that match the paginated view exactly, with ink kept as vector graphics.

Test: golden-image tests that render sample pages to PDF and compare them with approved images, within the tolerances in [ADR 0006](adr/0006-pdf-export.md). Also test page-break placement for text, tables, and images at each paper size.

Done when: exported PDFs match the screen for every sample page, and switching views keeps the content under the pointer still.

### Phase 7: Smart tables and charts

Status: built, and in beta testing.

- Built: Smart tables, calculated columns, board, calendar, gallery, and timeline views, charts, accessible charts, and drawing a grid to make a table. Nothing is left out.
- Checked by agents: Unit tests only.
- Checked by hand: Not yet. See section 7 of [the beta 4 checklist](testing/beta-4-checklist.md).

This phase delivers the owner's second request: easy charts.

Build:

- Upgrade tables with column types, sorting on several columns, filters, formulas, and a totals row.
- Add pasting from Excel or CSV into a smart table.
- Add chart blocks (bar, line, area, pie, and scatter) created from a table in two clicks, updating live when the table changes.
- Add chart styling from the brand palette, with patterns for color-blind readers.

Test: formula engine unit tests, E2E tests for "paste data, make chart, edit data, chart updates", and chart images in the golden PDF tests.

Done when: a 1,000-row table sorts and redraws its chart within 100 ms.

### Phase 8: Search and linking

Status: built, and in beta testing.

- Built: The search panel, the quick switcher, page and paragraph links, backlinks, tags, and daily notes. Also properties, collections, the graph view, the canvas of cards, replace across notebooks, and text in pictures in search.
- Not built: Links on handwriting. Handwriting is not fed to search yet.
- Checked by agents: Unit tests and the benchmark in [docs/perf/phase-8-core.md](perf/phase-8-core.md).
- Checked by hand: Not yet. See section 8 of [the beta 4 checklist](testing/beta-4-checklist.md).

Build:

- Add the full-text search (FTS) index, updated in the background after each save.
- Add instant search with filters (notebook, tag, date, type), and saved searches.
- Add `[[page links]]` with autocomplete, backlinks on every page, and nested tags.
- Add a complete command palette with every action.

Test: index consistency tests after random edits, the 10,000-page search benchmark, and E2E tests for linking and renaming a linked page.

Done when: search meets its 100 ms budget, and renaming a page updates every link to it.

### Phase 9: Audio recording

Status: built, and in beta testing.

- Built: Recording with stamps, flags, trim, split, and system audio. Also transcript blocks, speakers, and recaps. 14 of the 16 extras are built.
- Not built: Time-stamped notes on embedded video and podcast players, and a narrated video export. A recording’s `.timeline` file is not a core asset, so duplicating a page copies the audio but not the timeline.
- Checked by agents: The `crates/media` tests and [docs/perf/phase-9-core.md](perf/phase-9-core.md). An agent started a recording once, and it worked.
- Checked by hand: Not yet. Recording is one of the riskiest parts. See sections 1d and 9 of [the beta 4 checklist](testing/beta-4-checklist.md).

Build:

- Add recording from the microphone, and optionally system audio for meetings, with a clear on-screen recording indicator.
- Add a timestamp on every stroke and text change made while recording.
- Add playback: tap any word or stroke to hear that moment, with a moving highlight during playback.
- Add pause, resume, and several recordings per page.

Test: synchronization tests with recorded pen and typing sessions, a 3-hour recording soak test, and checks for recovery if recording stops unexpectedly.

Done when: timestamps stay within 100 ms of the audio after a 3-hour recording, and a crash never loses more than 1 second of audio.

### Phase 10: Math

Status: built, and in beta testing.

- Built: LaTeX math, the grapher, math actions, quick math, diagrams, and mind maps. Also flashcards, Anki and CSV, study tape, citations, and the tool windows (timers, calculator, unit converter, reference tables, Upcoming).
- Not built: Making cards from a page, section, or transcript, and a dictionary and thesaurus tool.
- Checked by agents: Unit tests and [docs/perf/expr-engine.md](perf/expr-engine.md). Tool windows open a second webview, which is the likeliest place for the real exe to differ.
- Checked by hand: Not yet. See section 10 of [the beta 4 checklist](testing/beta-4-checklist.md).

Build:

- Add LaTeX math blocks and inline math.
- Add MathLive editing with pen and keyboard.
- Add a function grapher block (Desmos-style) with zoom and pan, exported as vector graphics.

Test: rendering tests for a library of 200 equations, grapher accuracy tests against known values, and golden PDF tests.

Done when: all math renders on screen and in PDF identically.

### Phase 11: Import and export

Status: built, and in beta testing.

- Built: Importers for Markdown, Obsidian, Word, HTML, Notion, Google Keep, Logseq, Evernote, and more. Also the exporters and the import report with undo. 13 of the 26 extras are built, such as .odt, .xlsx, .pptx, .eml, Sticky Notes, and send to folders.
- Not built: PDF in the dialog, OneNote `.one` and `.onepkg` files, PDF import with note space, PDF highlights, dimmed PDFs, and scan cleanup. Also opening single Markdown files, the local API, the command-line tool, a Model Context Protocol (MCP) server, the web clipper, the phone camera, and the embed block. Share as a file has a back end and no screen.
- Needs the owner: Everything that needs a Google or Microsoft account.
- Checked by agents: The `crates/interop` tests and [docs/perf/phase-11-core.md](perf/phase-11-core.md).
- Checked by hand: Not yet. See section 11 of [the beta 4 checklist](testing/beta-4-checklist.md).

Build:

- Add export to Markdown, HTML, DOCX, and PDF, for a page, a section or a whole notebook.
- Add import from Markdown folders (Obsidian and Joplin exports), and from Evernote export files (ENEX).
- Add OneNote import through the Microsoft Graph API, keeping page layout, ink, images, and attachments.

Test: round-trip tests (export then import gives the same content), plus a corpus of real exported notebooks donated by testers with permission.

Done when: the test corpus imports without errors, and the "OneNote user switching" E2E test passes.

### Phase 12: On-device intelligence

Status: built, and in beta testing.

- Built: Text in pictures, read aloud, summaries, and handwriting to text, all off until a person turns them on. 9 of the 15 extras are built, such as model downloads with consent, search by meaning, Ask your notes, and writing tools.
- Not built: The whisper.cpp transcription engine, dictation, live captions, the speaker separation engine, math recognition from handwriting, and translation on the device.
- Checked by agents: Unit tests and the `crates/intel` tests. It needs Windows language packs and voices on the PC.
- Checked by hand: Not yet. See section 12 of [the beta 4 checklist](testing/beta-4-checklist.md).

These are set up during first-run setup (see FEATURES.md), not left off. They run on the device, and nothing leaves it.

Build:

- Add OCR for images and PDFs, so their text is searchable.
- Add handwriting recognition for search and ink-to-text.
- Add local transcription of recordings with whisper.cpp, using the NPU when present and the processor otherwise. The model downloads only after the person agrees.
- Add read aloud with the voices installed in Windows, word by word highlighting, and a local extractive summary and keyword finder. No model is needed for either.
- Keep every on-device feature off until the person turns it on, and enforce that in one place in the Rust crate.

Test: accuracy benchmarks on sample sets, performance tests that confirm the interface stays within budget during processing, and a network test that proves no data is sent.

Done when: all three features pass their accuracy targets, and the app stays smooth while they run.

### Phase 13: Hardening and beta

Status: partly built.

- Built: Opt-in crash reports with consent, the self-check, the feedback file, safe start, and the Privacy page with Work offline. Interface text is in translation files.
- Not built: The accessibility audit with Narrator and NVDA (a free screen reader), and testing updates from every earlier beta, because the beta exe has no updater.
- Needs the owner: The four-week public beta.
- Checked by agents: Unit tests and the Rust tests.
- Checked by hand: Not yet. See section 13 of [the beta 4 checklist](testing/beta-4-checklist.md).

Build:

- Fix every issue found by the soak tests, fuzzing, and performance runs.
- Complete a full accessibility audit with Narrator, NVDA (a free screen reader) and keyboard only.
- Move all interface text into translation files, ready for other languages.
- Add opt-in crash reports that never include note content.
- Open the beta update channel, and test updating from every earlier beta.

Done when: a four-week public beta shows at least 99.5% of sessions ending without a crash, and no data-loss reports.

### Phase 14: Windows release

Status: built but not run.

- Built: The release workflow, the signing steps, checksums, and winget files. See [docs/RELEASING.md](RELEASING.md).
- Not built: No release has been made, and no sign-off file exists yet in `docs/releases/`.
- Needs the owner: The beta period, the code-signing certificate, and the update signing key.

Complete the [release checklist](#10-release-checklist), then tag version 1.0.0. The release workflow signs the Windows exes and publishes them on GitHub, and every beta copy updates itself to the new version.

### After the Windows release

The next steps, in rough order:

1. Sync: folder-based first, then an optional self-hosted server.
2. macOS and Linux builds.
3. Android and iOS apps using the compact layout.
4. PDF annotation, flashcards from notes, and citation support.
5. Meeting mode with speaker labels.
6. Real-time collaboration.
7. Plugins and scripts, with the same permissions and access log as the local API.
8. Comments and mentions on shared pages, built on real-time collaboration.
9. Publishing a page or notebook as a read-only site from the self-hosted server.
10. PDF forms, signatures, and redaction, and page tools to merge, split, rotate, and reorder PDF pages.
11. Widgets for quick capture and the Upcoming list, on Windows 11 and phones.
12. Sending a page to a nearby device on the same network, with no account.

## 6. Testing strategy

| Layer | Tools | What it covers | When it runs |
|---|---|---|---|
| Unit | cargo test, Vitest | Functions and modules in isolation | Every commit |
| Property-based | proptest, fast-check | Random documents and edits; save and reload give identical results | Every pull request |
| Component | Vitest with Testing Library, axe-core | Each interface control, including accessibility rules | Every pull request |
| End-to-end | WebdriverIO with tauri-driver | Real app on Windows: key user tasks from start to finish | Every pull request (smoke set); nightly (full set) |
| Golden image | Playwright screenshots, PDF rendering | Layout, pagination, PDF export, charts, and math | Every pull request |
| Performance | Custom benchmarks in `tests/perf/` | Every budget in BRAND.md section 10 | Every pull request (quick); nightly on the reference laptop (full) |
| Fuzzing | cargo-fuzz | File reader and importers never crash on bad input | Nightly, 30 minutes per target |
| Soak | Scripted random editing | Memory leaks, slowdowns, and crashes over time | Nightly, 2 hours |
| Crash safety | Kill-during-save harness | No page is ever damaged or lost | Nightly |
| Manual | Checklists | Pen feel, screen readers, real devices | Before each beta and release |

Performance tests compare against the budgets in BRAND.md and fail the build if a result is more than 10% worse than the last release. Every bug fix adds a test that failed before the fix.

Benchmarks and crash measurements run from an optimized build, because a debug build is several times slower and its times mean nothing. The `perf` profile in `Cargo.toml` builds them optimized, with line tables for profilers. Run them with `cargo perf bench <suite> <dir>` and `cargo crashtest measure <m3|m5|m6|all> --dir <dir>`, two aliases in `.cargo/config.toml`. Both commands refuse a debug build unless they get `--debug`.

The palm rejection checklist in [testing/palm-rejection.md](testing/palm-rejection.md) runs on each pen and touch device in the matrix below.

The keyboard and screen reader checklist uses Narrator and NVDA with no mouse. It covers creating a notebook, writing, and formatting a page, inserting a table, and chart, searching, recording audio, and exporting a PDF.

## 7. Device test matrix

| Device type | Examples | Why |
|---|---|---|
| Reference laptop | 4 cores, 8 GB memory, integrated graphics, 1080p at 125% | Every performance budget is measured here |
| Pen tablet PC | Surface Pro, Surface Laptop Studio | Windows pen, touch, and palm rejection |
| Other Windows pens | Wacom AES laptop (ThinkPad), an OEM MPP laptop, a Wacom EMR tablet with Windows Ink on and off | Palm rejection without the Surface firmware's help, hover dropouts, a pen reported as a mouse |
| iPad with Apple Pencil | An iPad without hover and Pencil 1 or USB-C; an M2 or later iPad Pro with Pencil 2 or Pro | No-hover pens, no pressure on Pencil USB-C, WebKit hover and coalesced events |
| Android pen tablet | Galaxy Tab with S Pen; a Chromebook or Android 13 tablet with a USI pen | Long hover, the Android 13 palm rejector |
| Fire Max 11 | Amazon Fire Max 11 with a USI 2.0 pen | Fire OS 8 is Android 11: no system palm rejector, so the app's filter carries it |
| Passive stylus | A rubber or disc stylus on any tablet | A stylus that reports as touch, with the hand resting |
| Phone | Any Android phone or iPhone | Finger drawing with no pen at all, grip at the screen edge |
| Drawing tablet | Wacom Intuos or One | Pen without a touchscreen |
| Touch laptop | Any touch-screen laptop | Finger input and scrolling |
| High-resolution screen | 4K at 150% or 200% scaling | Sharp rendering and layout at high scaling |
| Mixed monitors | Two monitors with different scaling | Moving windows between screens |
| Older hardware | Windows 10 22H2, 4 GB memory | Minimum supported system |

## 8. Continuous integration and releases

Every pull request runs, on Windows:

1. CHECKS on changed files.
2. Format, lint, and type checks for TypeScript and Rust.
3. Unit, property, component, and golden-image tests.
4. A release build of the app.
5. The E2E smoke set and quick performance tests on the built app.

A pull request can merge only when all five pass and one reviewer approves.

Every night, CI builds the main branch and runs the full E2E set, fuzzing, soak, crash-safety, and full performance tests. A failure opens an issue automatically.

Builds move through three channels:

| Channel | Who gets it | How often |
|---|---|---|
| Nightly | Contributors | Every night, if the nightly tests pass |
| Beta | Testers who opt in | Every two weeks, after the release checklist |
| Stable | Everyone | When a beta has run for two weeks with no serious issues |

Versions follow semantic versioning (major.minor.patch). Every release has changelog notes written for users, not developers.

## 9. Distribution and updates

OpenNote ships as one exe per Windows architecture: `OpenNote_Windows64.exe` for 64-bit PCs, `OpenNote_Windows32.exe` for 32-bit PCs, and `OpenNote_WindowsARM64.exe` for 64-bit Arm (ARM64) PCs. People download the one for their PC once. After that, the app updates itself from inside, and updates never touch their notes or settings. Later macOS and Linux builds will follow the same pattern, as `OpenNote_macOS.dmg` and `OpenNote_Linux.AppImage`.

### What the exe holds

The exe holds only the program: code, interface, fonts, and icons. Tauri builds the whole interface into the exe, and uses Microsoft Edge WebView2 to display it. WebView2 is already part of Windows 10 and 11; if it's missing, the app offers Microsoft's small installer.

Everything personal lives outside the exe, in standard Windows folders:

| What | Where |
|---|---|
| Notes | `Documents\OpenNote\`, or a folder the person picks |
| Settings | `%APPDATA%\OpenNote\settings.json` |
| Search index and caches (can be rebuilt) | `%LOCALAPPDATA%\OpenNote\cache\` |
| Downloaded updates, the previous version, and backups | `%LOCALAPPDATA%\OpenNote\` |
| Speech and handwriting models (optional downloads) | `%LOCALAPPDATA%\OpenNote\models\` |

Because the exe holds no personal data, replacing it can't delete anyone's work.

On first launch, the app asks where to keep itself. It can stay where it was downloaded, or move to `%LOCALAPPDATA%\Programs\OpenNote\` and add a Start menu shortcut. Neither choice needs administrator rights, and both let the app replace its own exe later.

### How a release reaches people

1. Developers merge tested changes into `main` on GitHub.
2. To release, a maintainer updates the version number and pushes a tag such as `v0.4.0`.
3. A GitHub Actions workflow runs the same checks and tests as CI on the tagged commit, builds the three exes on Windows, and signs each one (see [Signing](#signing-and-security)). It stops if the tag doesn't match the app's version, and it never publishes an unsigned release.
4. The workflow publishes a GitHub Release with the exes and a small manifest file, `latest.json`. The manifest lists the version and release notes. For each architecture, it lists the exe's download link, file size, SHA-256 hash, and signature.
5. Running copies of OpenNote read the manifest, pick the exe for their own architecture, and update themselves.

Nobody builds or uploads anything by hand. The exe already on someone's computer keeps working, unchanged, until they restart into the new version.

GitHub Releases hosts the files for free. The address `https://github.com/xrxcgh/opennote/releases/latest/download/latest.json` always points to the newest stable manifest. Beta releases publish a separate `beta.json`.

### How the app updates itself

1. At start-up and every six hours, the app fetches the manifest, which is only a few kilobytes. The check runs in the background, so it never slows start-up, and it is skipped while offline.
2. If a newer version exists, the app downloads the new exe for its own architecture at low priority to `%LOCALAPPDATA%\OpenNote\updates\`.
3. It checks the file's SHA-256 hash, and its signature against a public key built into the app. The signature also covers the version number, which must match the manifest. A file that fails any check is deleted, and the next check tries again.
4. A quiet "Update ready" notice appears in the title bar. Choosing "Restart to update", or simply closing the app, applies it.
5. Before the swap, the app finishes saving and waits for any recording to stop. If the new version will convert files or settings, it backs them up first.
6. Windows lets a running exe be renamed. The app renames itself to `OpenNote.previous.exe`, moves the new exe into its place and restarts. The person lands back on the page they were using, about two seconds later.
7. The new version reports a clean start. If it crashes twice in a row at start-up, the previous exe is put back automatically and the problem is reported.

The official Tauri updater expects an installer rather than a single exe. OpenNote therefore uses a small custom updater in Rust, built on the `self-replace` crate and minisign signatures. It reads the same `latest.json` format as Tauri's updater, so switching to an installer later would be easy.

In settings, people choose to install updates automatically (the default), be asked first, or check by hand. They can also skip a version or join the beta channel.

### Keeping work safe during updates

- Updates never apply while there are unsaved changes or an active recording.
- Note files and settings carry format version numbers. A new version upgrades older files with tested migrations, after saving a backup in `%LOCALAPPDATA%\OpenNote\backups\`. The three most recent backups are kept.
- An older version opens newer files read-only instead of changing them, so going back to a previous version is always safe.
- The previous exe stays on disk until the next update. Settings, then About, offers "Go back to the previous version" in one click.
- Before each release, CI updates from each of the last three versions using real sample notebooks, and confirms nothing changed or went missing.

### Signing and security

- **Update signature:** a minisign key pair signs every release. The private key exists only as a GitHub Actions secret, and only the signing step of the release workflow receives it. The public key is built into every exe. Without the private key, nobody can push an update, even from a fake server.
- **Code signing:** an Authenticode certificate, such as one from Azure Trusted Signing, identifies the publisher. Windows SmartScreen and antivirus tools then recognize the app instead of warning about an unknown file.
- **Downgrades:** the app only downloads over HTTPS, and refuses to install an older version unless the person chooses to go back. Because the signature covers the version, a changed manifest can't pass off an older exe as a newer one.

### Later options

A Microsoft Store listing and a winget package can be added later without changing any of this. The exe is expected to be 15 to 30 MB, which downloads in seconds on most connections. If it grows much larger, differential updates can download only the parts that changed.

## 10. Release checklist

A build ships to beta or stable only when every item is checked:

- [ ] `npm run checks:all` passes with no errors.
- [ ] All automated tests pass on the release commit, including the full nightly set.
- [ ] Every budget in BRAND.md section 10 passes on the reference laptop.
- [ ] No open issues labeled `data-loss`, `crash` or `security`.
- [ ] The keyboard and screen reader checklist passes.
- [ ] Manual pen testing passes on at least two devices from the matrix.
- [ ] Upgrading from the previous release keeps all notes and settings (tested with real notebooks).
- [ ] File format changes include a tested migration and an updated specification.
- [ ] Every release exe is code-signed, and each update signature covers the version in the manifest.
- [ ] Updating from each of the last three versions keeps every note and setting, and going back to the previous version works.
- [ ] Changelog and documentation are updated.

Run `npm run release:check` to answer these items. A script checks what a computer can check, and the rest are signed off in `docs/releases/<version>.signoff.json`. The release workflow runs the same script and stops when an item is not done. See [RELEASING.md](RELEASING.md).

## 11. Definition of done

A feature is done, and can leave its feature flag, when:

- [ ] It works with mouse, keyboard, touch, and pen, in every size class and both themes.
- [ ] Every drag has a click or keyboard alternative, as the Web Content Accessibility Guidelines (WCAG) 2.2 require (success criterion 2.5.7).
- [ ] It has unit tests, and an E2E test for its main task.
- [ ] It meets the performance budgets, with a benchmark if it could affect them.
- [ ] It passes automated accessibility checks and the relevant manual checklist items.
- [ ] It uses only design tokens, and its text follows the BRAND.md voice.
- [ ] Its data survives save, reload, crash, undo, and export.
- [ ] Documentation and the changelog are updated.
- [ ] CHECKS passes on every changed file.

## 12. Working agreements

- **Branches:** each phase lives on its own `phase-N` branch, which merges into `main` with a merge commit once the phase meets its exit gate. Smaller changes use short-lived branches off the current phase branch, merged within a few days.
- **Commits:** one logical change per commit, with a message that says what changed and why.
- **Pull requests:** under about 400 changed lines where possible, with screenshots for visual changes.
- **Reviews:** at least one approval. Reviewers check behavior, tests, and readability as well as style.
- **Decisions:** anything hard to reverse gets an ADR before the code.
- **Issues:** every bug gets steps to reproduce, and every TODO in code links to an issue (CHECKS enforces this).

## 13. Risks

| Risk | Impact | Plan |
|---|---|---|
| Pen latency in WebView2 is too high | Ink feels laggy, the core promise fails | Phase 1 measured ink about one compositor frame behind a native window ([ADR 0004](adr/0004-ink-latency.md)). Phase 5 tries delegated ink trails with a real pen, and adds a native ink layer if the camera check fails. |
| OneNote import is harder than expected | Switchers can't bring notes | Start with the Graph API, which returns HTML and ink; keep a test corpus; ship partial import clearly labeled |
| Data loss from bugs or crashes | Loss of trust, which is hard to win back | Atomic saves, journal, version history, crash-safety tests every night |
| An update breaks the app or damages files | People lose trust or work | Backups before migrations, read-only opening of newer files, automatic rollback after two failed starts, and update tests from the last three versions |
| Windows warns about an unknown app | People are scared off at download | Code-sign every exe; build SmartScreen reputation through signed releases |
| Speech models are large | Big downloads, slow on older laptops | Optional download, small model by default, NPU acceleration where present |
| Scope grows faster than quality | Slow, buggy app | Phase gates, feature flags, and performance budgets that block releases |
| License choice | Affects who can contribute and reuse the code | Decide in Phase 0. The Apache 2.0 license is a common choice for apps that welcome companies and individuals alike. |
