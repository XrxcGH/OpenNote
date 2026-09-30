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
9. [Release checklist](#9-release-checklist)
10. [Definition of done](#10-definition-of-done)
11. [Working agreements](#11-working-agreements)
12. [Risks](#12-risks)

## 1. How this plan works

The work is split into phases. Each phase adds a small set of features and ends with an exit gate: a list of tests and measurements that must pass before the next phase starts. Short experiments (spikes) come first, so risky choices are proven before much code depends on them.

Unfinished features stay behind feature flags. The main branch must always build, pass every test and run without crashing, even when a feature is half done. A feature leaves its flag only after it meets the [definition of done](#10-definition-of-done).

Every change, from a typo fix to a new feature, goes through the same path: branch, pull request, automated checks, review, merge. Nothing reaches users without passing the [release checklist](#9-release-checklist).

## 2. Technology choices

| Layer | Choice | Why |
|---|---|---|
| App shell | Tauri 2 (Rust, with WebView2 on Windows) | Small installs and low memory. One codebase for Windows, macOS, Linux, iOS and Android. |
| Core logic | Rust library crates | Fast, memory-safe code for storage, search, audio and import that runs on every platform |
| Interface | TypeScript, React and Vite | The largest pool of contributors and components. Drawing bypasses React to stay fast. |
| Rich text | ProseMirror through Tiptap | Proven editor with tables, Markdown shortcuts and collaboration support for later |
| Ink | Custom canvas renderer | Pointer Events with pressure and tilt, coalesced and predicted points, a low-latency canvas, and perfect-freehand for stroke shapes |
| Charts | Observable Plot | Clear defaults, and vector (SVG) output stays sharp in PDFs |
| Math | KaTeX to display, MathLive to edit | Fast rendering, and equation input that works with a pen or keyboard |
| Code and diagrams | CodeMirror 6 and Mermaid | Loaded only when a page uses them, so start-up stays fast |
| Search | SQLite full-text search (FTS5) through rusqlite | Instant local search that can be rebuilt from the note files at any time |
| Audio | cpal for capture, Opus for storage | Microphone and Windows system audio (WASAPI loopback) with small files |
| On-device intelligence | whisper.cpp for speech, Windows.Media.Ocr for images | Private, offline and free. Other platforms swap in their own engines behind the same interface. |

The rule of thumb is that anything platform-specific sits behind a small Rust or TypeScript interface. Pen input, audio capture, optical character recognition (OCR) and neural processing unit (NPU) acceleration each get one. Porting to a new platform means writing new adapters, not rewriting features.

Large decisions are written down as architecture decision records (ADRs) in `docs/adr/`. Each one records the choice, the options considered, and why.

## 3. Repository layout

```text
app/
  src/            TypeScript interface: shell, editor, ink, views
  src/theme/      Generated from brand/tokens.json; the only place raw design values appear
  src-tauri/      Rust shell: windows, menus, commands the interface calls
crates/
  core/           Document model, file format, storage, undo history, search index
  media/          Audio capture and encoding, transcription, OCR adapters
  interop/        Import and export: Markdown, HTML, DOCX, PDF, OneNote, Evernote
brand/            Design tokens, logo and icon
checks/           The CHECKS quality gate
docs/adr/         Architecture decision records
docs/format/      The note file format specification
tests/e2e/        End-to-end tests that drive the real app
tests/perf/       Performance benchmarks and large sample notebooks
```

## 4. Note file format

The file format is the most important long-term decision, because every future platform must read it. It is designed in Phase 3 and published in `docs/format/` before any user data exists.

- A notebook is a folder. Sections are subfolders. Each page is a folder holding `page.json`, an `assets/` folder for images, PDFs and audio, and `page.md`.
- `page.json` is the source of truth. It stores blocks (text, ink, tables, charts, math, images) with their positions and timestamps. Text inside blocks is stored as Markdown.
- Ink strokes store raw points: position, pressure, tilt and time. Rendering can improve later without changing the data.
- `page.md` is a readable copy written on every save, so notes stay useful even without OpenNote.
- Every file carries a `formatVersion`. Older versions are upgraded by tested migrations, never by hand.
- Saves are atomic: write to a temporary file, flush it to disk, then rename. A crash can't leave half a page.
- The search index lives in the local app data folder. It is a cache and can be deleted and rebuilt at any time.

## 5. Phases

Each phase lists what to build, how to test it, and when it is done. Time estimates are left out on purpose; the exit gates decide when to move on.

### Phase 0: Foundation

Build:

- Install the toolchains: Node.js 22 LTS, Rust stable and the Tauri prerequisites for Windows.
- Scaffold the Tauri app with an empty window that uses the brand tokens.
- Add linting and formatting: ESLint and Prettier for TypeScript, Clippy and rustfmt for Rust.
- Set up continuous integration (CI) on `windows-latest`: CHECKS, lint, type-check, tests and a debug build.
- Add issue and pull request templates, the ADR template and a code of conduct. Choose the license (see [Risks](#12-risks)).

Done when: a fresh clone builds and opens a window with one command on Windows, and CI passes.

### Phase 1: Spikes

Four throwaway experiments answer the riskiest questions before real code depends on them.

1. **Ink latency.** Draw with a Surface Pen and a Wacom tablet in WebView2. Measure pen-to-screen time with a high-speed phone camera (240 frames per second).
2. **Text on a freeform page.** Place several Tiptap editors on a zoomable canvas, mixed with ink, and check typing latency.
3. **PDF export.** Print a paginated page through WebView2's print-to-PDF and compare it with the screen.
4. **Audio capture.** Record the microphone and system audio at the same time with cpal.

Done when: each spike has an ADR with measurements. If ink latency misses the 25 ms budget in BRAND.md and can't be fixed, the ADR switches the interface to Flutter before Phase 2.

### Phase 2: App shell and navigation

Build:

- Generate CSS custom properties and a typed module from `brand/tokens.json`.
- Add light and dark themes with the dark mode setting from BRAND.md: Light, Dark or Match Windows. Include the title bar toggle, Ctrl+Shift+D and the "Choose your look" onboarding step, plus support for Windows contrast themes.
- Build the responsive layout from BRAND.md section 6: three panes on wide windows, down to one pane on narrow ones.
- Add the notebook, section and page tree with create, rename, reorder, color and delete (to Trash).
- Add the command bar, a command palette (Ctrl+K), keyboard navigation and a shortcut list (Ctrl+/).
- Add a settings page and first-run onboarding.

Test: component tests for every control, keyboard-only end-to-end (E2E) tests of navigation, automated accessibility checks, and screenshot tests at each size class in both themes. Theme tests confirm that first-run setup preselects the Windows setting, that switching keeps scroll position and selection, and that start-up never shows the wrong theme.

Done when: the shell meets the start-up and feedback budgets, and passes the keyboard and screen reader checklist in [section 6](#6-testing-strategy).

### Phase 3: Document model and storage

Build:

- Write the file format specification and implement it in `crates/core`.
- Add reading, writing and atomic saves, with autosave one second after the last change.
- Add crash recovery from a small write-ahead journal.
- Add undo and redo as commands on the document model, shared by text, ink and every later block type.
- Add Trash with restore, and a page history of saved versions.

Test:

- Property-based tests that generate random pages, save and reload them, and require identical results.
- Fuzz tests that feed corrupted files to the reader: it must report an error, never crash.
- A crash-safety test that kills the app during saves 1,000 times and checks that no page is ever damaged.

Done when: all three test types pass, and a 1,000-page sample notebook opens within budget.

### Phase 4: Typed notes

Build:

- Add text containers that can be placed anywhere on a page (the OneNote model), or stacked in a simple document flow.
- Add headings, lists, checkboxes, bold and italic, links, quotes and callouts.
- Add Markdown shortcuts as you type (for example `# ` for a heading), and Markdown paste.
- Add images by paste, drag or file picker, with resize and crop.
- Add basic tables and code blocks with syntax highlighting.
- Add spell check using the Windows spelling service.

Test: editor unit tests for every command, E2E tests for writing and formatting a page, a typing-latency benchmark, and paste tests from Word, OneNote, web pages and plain text.

Done when: typing stays within 16 ms on the reference laptop with a 20-page-long note.

### Phase 5: Ink

Build:

- Add pens, pencil and highlighter with pressure and tilt, using the pen colors from `brand/tokens.json`.
- Add a stroke eraser and a partial eraser, and the pen's own eraser button.
- Add palm rejection: while a pen is near the screen, touch never draws.
- Add a lasso that selects ink and text together, to move, resize, recolor or delete them.
- Add shape recognition for lines, rectangles, circles and arrows.
- Render finished strokes into cached tiles so large pages stay smooth.

Test: geometry unit tests, recorded pen sessions replayed in E2E tests, a latency benchmark, a 10,000-stroke page benchmark, and manual testing on every pen device in the [matrix](#7-device-test-matrix).

Done when: the pen-to-screen and frame-rate budgets pass on the reference laptop and a Surface Pro.

### Phase 6: Page views and export

This phase delivers the owner's top request: seeing page breaks.

Build:

- Add a per-page switch between infinite canvas and paginated view (Letter, A4 or custom), with visible margins and page breaks.
- Add manual page breaks, "keep together" for images and tables, and a default paper size per notebook.
- Add paper backgrounds: plain, lined, dot grid, graph and Cornell.
- Add print and PDF export that match the paginated view exactly, with ink kept as vector graphics.

Test: golden-image tests that render sample pages to PDF and compare them pixel by pixel with approved images. Also test page-break placement for text, tables and images at each paper size.

Done when: exported PDFs match the screen for every sample page, and switching views keeps the content under the pointer still.

### Phase 7: Smart tables and charts

This phase delivers the owner's second request: easy charts.

Build:

- Upgrade tables with column types, sorting on several columns, filters, formulas and a totals row.
- Add pasting from Excel or CSV into a smart table.
- Add chart blocks (bar, line, area, pie and scatter) created from a table in two clicks, updating live when the table changes.
- Add chart styling from the brand palette, with patterns for color-blind readers.

Test: formula engine unit tests, E2E tests for "paste data, make chart, edit data, chart updates", and chart images in the golden PDF tests.

Done when: a 1,000-row table sorts and redraws its chart within 100 ms.

### Phase 8: Search and linking

Build:

- Add the full-text search (FTS) index, updated in the background after each save.
- Add instant search with filters (notebook, tag, date, type), and saved searches.
- Add `[[page links]]` with autocomplete, backlinks on every page, and nested tags.
- Add a complete command palette with every action.

Test: index consistency tests after random edits, the 10,000-page search benchmark, and E2E tests for linking and renaming a linked page.

Done when: search meets its 100 ms budget, and renaming a page updates every link to it.

### Phase 9: Audio recording

Build:

- Add recording from the microphone, and optionally system audio for meetings, with a clear on-screen recording indicator.
- Add a timestamp on every stroke and text change made while recording.
- Add playback: tap any word or stroke to hear that moment, with a moving highlight during playback.
- Add pause, resume and several recordings per page.

Test: synchronization tests with recorded pen and typing sessions, a 3-hour recording soak test, and checks for recovery if recording stops unexpectedly.

Done when: timestamps stay within 100 ms of the audio after a 3-hour recording, and a crash never loses more than 1 second of audio.

### Phase 10: Math

Build:

- Add LaTeX math blocks and inline math.
- Add MathLive editing with pen and keyboard.
- Add a function grapher block (Desmos-style) with zoom and pan, exported as vector graphics.

Test: rendering tests for a library of 200 equations, grapher accuracy tests against known values, and golden PDF tests.

Done when: all math renders on screen and in PDF identically.

### Phase 11: Import and export

Build:

- Add export to Markdown, HTML, DOCX and PDF, for a page, a section or a whole notebook.
- Add import from Markdown folders (Obsidian and Joplin exports), and from Evernote export files (ENEX).
- Add OneNote import through the Microsoft Graph API, keeping page layout, ink, images and attachments.

Test: round-trip tests (export then import gives the same content), plus a corpus of real exported notebooks donated by testers with permission.

Done when: the test corpus imports without errors, and the "OneNote user switching" E2E test passes.

### Phase 12: On-device intelligence

All of these are optional and off until the person turns them on. They run on the device, and nothing leaves it.

Build:

- Add OCR for images and PDFs, so their text is searchable.
- Add handwriting recognition for search and ink-to-text.
- Add local transcription of recordings with whisper.cpp, using the NPU when present and the processor otherwise. The model downloads only after the person agrees.

Test: accuracy benchmarks on sample sets, performance tests that confirm the interface stays within budget during processing, and a network test that proves no data is sent.

Done when: all three features pass their accuracy targets, and the app stays smooth while they run.

### Phase 13: Hardening and beta

Build:

- Fix every issue found by the soak tests, fuzzing and performance runs.
- Complete a full accessibility audit with Narrator, NVDA (a free screen reader) and keyboard only.
- Move all interface text into translation files, ready for other languages.
- Add opt-in crash reports that never include note content.
- Add an installer, auto-update and a beta channel.

Done when: a four-week public beta shows at least 99.5% of sessions ending without a crash, and no data-loss reports.

### Phase 14: Windows release

Complete the [release checklist](#9-release-checklist), sign the installer, publish to the Microsoft Store and winget, and tag version 1.0.0.

### After the Windows release

The next steps, in rough order:

1. Sync: folder-based first, then an optional self-hosted server.
2. macOS and Linux builds.
3. Android and iOS apps using the compact layout.
4. PDF annotation, flashcards from notes and citation support.
5. Meeting mode with speaker labels.
6. Real-time collaboration.

## 6. Testing strategy

| Layer | Tools | What it covers | When it runs |
|---|---|---|---|
| Unit | cargo test, Vitest | Functions and modules in isolation | Every commit |
| Property-based | proptest, fast-check | Random documents and edits; save and reload give identical results | Every pull request |
| Component | Vitest with Testing Library, axe-core | Each interface control, including accessibility rules | Every pull request |
| End-to-end | WebdriverIO with tauri-driver | Real app on Windows: key user tasks from start to finish | Every pull request (smoke set); nightly (full set) |
| Golden image | Playwright screenshots, PDF rendering | Layout, pagination, PDF export, charts and math | Every pull request |
| Performance | Custom benchmarks in `tests/perf/` | Every budget in BRAND.md section 10 | Every pull request (quick); nightly on the reference laptop (full) |
| Fuzzing | cargo-fuzz | File reader and importers never crash on bad input | Nightly, 30 minutes per target |
| Soak | Scripted random editing | Memory leaks, slowdowns and crashes over time | Nightly, 2 hours |
| Crash safety | Kill-during-save harness | No page is ever damaged or lost | Nightly |
| Manual | Checklists | Pen feel, screen readers, real devices | Before each beta and release |

Performance tests compare against the budgets in BRAND.md and fail the build if a result is more than 10% worse than the last release. Every bug fix adds a test that failed before the fix.

The keyboard and screen reader checklist uses Narrator and NVDA with no mouse. It covers creating a notebook, writing and formatting a page, inserting a table and chart, searching, recording audio and exporting a PDF.

## 7. Device test matrix

| Device type | Examples | Why |
|---|---|---|
| Reference laptop | 4 cores, 8 GB memory, integrated graphics, 1080p at 125% | Every performance budget is measured here |
| Pen tablet PC | Surface Pro, Surface Laptop Studio | Windows pen, touch and palm rejection |
| Drawing tablet | Wacom Intuos or One | Pen without a touchscreen |
| Touch laptop | Any touch-screen laptop | Finger input and scrolling |
| High-resolution screen | 4K at 150% or 200% scaling | Sharp rendering and layout at high scaling |
| Mixed monitors | Two monitors with different scaling | Moving windows between screens |
| Older hardware | Windows 10 22H2, 4 GB memory | Minimum supported system |

## 8. Continuous integration and releases

Every pull request runs, on Windows:

1. CHECKS on changed files.
2. Format, lint and type checks for TypeScript and Rust.
3. Unit, property, component and golden-image tests.
4. A release build of the app.
5. The E2E smoke set and quick performance tests on the built app.

A pull request can merge only when all five pass and one reviewer approves.

Every night, CI builds the main branch and runs the full E2E set, fuzzing, soak, crash-safety and full performance tests. A failure opens an issue automatically.

Builds move through three channels:

| Channel | Who gets it | How often |
|---|---|---|
| Nightly | Contributors | Every night, if the nightly tests pass |
| Beta | Testers who opt in | Every two weeks, after the release checklist |
| Stable | Everyone | When a beta has run for two weeks with no serious issues |

Versions follow semantic versioning (major.minor.patch). Every release has changelog notes written for users, not developers.

## 9. Release checklist

A build ships to beta or stable only when every item is checked:

- [ ] `npm run checks:all` passes with no errors.
- [ ] All automated tests pass on the release commit, including the full nightly set.
- [ ] Every budget in BRAND.md section 10 passes on the reference laptop.
- [ ] No open issues labeled `data-loss`, `crash` or `security`.
- [ ] The keyboard and screen reader checklist passes.
- [ ] Manual pen testing passes on at least two devices from the matrix.
- [ ] Upgrading from the previous release keeps all notes and settings (tested with real notebooks).
- [ ] File format changes include a tested migration and an updated specification.
- [ ] The installer is signed, and auto-update from the previous version works.
- [ ] Changelog and documentation are updated.

## 10. Definition of done

A feature is done, and can leave its feature flag, when:

- [ ] It works with mouse, keyboard, touch and pen, in every size class and both themes.
- [ ] It has unit tests, and an E2E test for its main task.
- [ ] It meets the performance budgets, with a benchmark if it could affect them.
- [ ] It passes automated accessibility checks and the relevant manual checklist items.
- [ ] It uses only design tokens, and its text follows the BRAND.md voice.
- [ ] Its data survives save, reload, crash, undo and export.
- [ ] Documentation and the changelog are updated.
- [ ] CHECKS passes on every changed file.

## 11. Working agreements

- **Branches:** short-lived branches off `main`, merged within a few days. The long-running `windows-prototype` branch holds the prototype until it can merge.
- **Commits:** one logical change per commit, with a message that says what changed and why.
- **Pull requests:** under about 400 changed lines where possible, with screenshots for visual changes.
- **Reviews:** at least one approval. Reviewers check behavior, tests and readability as well as style.
- **Decisions:** anything hard to reverse gets an ADR before the code.
- **Issues:** every bug gets steps to reproduce, and every TODO in code links to an issue (CHECKS enforces this).

## 12. Risks

| Risk | Impact | Plan |
|---|---|---|
| Pen latency in WebView2 is too high | Ink feels laggy, the core promise fails | Measured in Phase 1 spike; switch the interface to Flutter if the budget can't be met |
| OneNote import is harder than expected | Switchers can't bring notes | Start with the Graph API, which returns HTML and ink; keep a test corpus; ship partial import clearly labeled |
| Data loss from bugs or crashes | Loss of trust, which is hard to win back | Atomic saves, journal, version history, crash-safety tests every night |
| Speech models are large | Big downloads, slow on older laptops | Optional download, small model by default, NPU acceleration where present |
| Scope grows faster than quality | Slow, buggy app | Phase gates, feature flags, and performance budgets that block releases |
| License choice | Affects who can contribute and reuse the code | Decide in Phase 0. The Apache 2.0 license is a common choice for apps that welcome companies and individuals alike. |
