# OpenNote

![OpenNote: writing, drawing, and recording in one open-source notebook](brand/social-preview.png)

OpenNote is an open-source note-taking app that combines your favorite writing, drawing, and recording features for professional and personal use. Windows comes first; macOS, Linux, iOS, and Android follow.

**New here?** The [project wiki](https://github.com/XrxcGH/OpenNote/wiki) holds the user guide, development updates, and the developer guide.

## Status

OpenNote is in early development. Each phase of the [development plan](docs/DEVELOPMENT.md#5-phases) gets its own branch and merges into `main` when it meets its exit gate.

| Phase                                     | Focus                                                                                    | Status                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 0                                         | Project foundation                                                                       | Done and merged                                                                           |
| 1                                         | Spikes that test ink, text, PDF export, and audio                                        | Done and merged                                                                           |
| 2                                         | [App shell and navigation](https://github.com/XrxcGH/OpenNote/pull/8)                    | Done and merged 2026-10-02                                                                |
| 3                                         | [Document model and storage](https://github.com/XrxcGH/OpenNote/pull/9)                  | Done and merged 2026-10-03                                                                |
| 4                                         | [Typed notes (text, Markdown, tables, code)](https://github.com/XrxcGH/OpenNote/pull/15) | Done and merged 2026-10-03                                                                |
| [5 to 12](docs/DEVELOPMENT.md#5-phases)   | Ink, page views and export, tables and charts, search, audio, math, import, intelligence | Built, and in beta testing on branch `beta` (0.1.0-beta.4)                                |
| [13 and 14](docs/DEVELOPMENT.md#5-phases) | Hardening and privacy; the release pipeline                                              | Built but not complete: the beta period, code signing, and the update key are the owner's |

## What the app does today

OpenNote runs as a Windows desktop app. You organize notebooks, sections, and pages in a notes folder you choose, as plain folders in OpenNote's open note format, and pages save on their own and recover after a crash. On the `beta` branch (0.1.0-beta.4) it also has:

- Typed notes: text boxes, headings, lists, checklists, tables, code, callouts, Markdown, templates, find and replace, and page embeds
- Ink with pen, highlighter, erasers, lasso, shapes, gestures, and palm rejection, plus handwriting to text
- Page views (flow, paginated, canvas) with lined, grid, and dot paper that text snaps to; PDF, image, and Word export; print; slides
- Smart tables with views and calculated columns, charts, math, the grapher, mind maps, Mermaid diagrams, and study tools (flashcards, Anki, study tape, Upcoming)
- Search, page links and backlinks, tags, daily notes, the graph view, and replace across notebooks
- Recording with stamped notes, transcripts, speakers, and meeting recaps
- Import from Obsidian, Markdown, Word, OneNote-style exports, Excel, PowerPoint, and more; export to the same
- On-device intelligence (text in pictures, read aloud, summaries, Ask your notes, writing tools), each off until turned on
- Crash reports with consent, a self-check, a feedback file, safe start, Work offline, and Settings > Connectors for signing in to other services

The beta's hand test checklist is [docs/testing/beta-4-checklist.md](docs/testing/beta-4-checklist.md). [docs/CONNECTORS.md](docs/CONNECTORS.md) explains how to register OpenNote with each connected service.

## Downloads

There is no release yet. When one ships, it will appear on the [GitHub Releases page](https://github.com/XrxcGH/OpenNote/releases) as three files:

| File                        | For                                            |
| --------------------------- | ---------------------------------------------- |
| `OpenNote_Windows64.exe`    | 64-bit Windows, on most PCs                    |
| `OpenNote_Windows32.exe`    | 32-bit Windows                                 |
| `OpenNote_WindowsARM64.exe` | Windows on Arm PCs, such as Snapdragon laptops |

## Quick start for contributors

On Windows, install Node.js 22.18 or newer, Rust (through rustup), and the Microsoft C++ Build Tools. Then run:

```sh
git clone https://github.com/XrxcGH/OpenNote.git
cd OpenNote
npm install && npm start
```

That opens the OpenNote window in development mode. Run `npm run setup-hooks` once, so CHECKS runs before every commit. To test your changes, run:

```sh
npm test                 # CHECKS, lint rule, and unit tests
npm run test:components  # component tests in the installed Edge or Chrome
npm run test:ui          # screen and accessibility tests in Playwright
npm run test:e2e         # real-app tests, which need tauri-driver and msedgedriver
npm run perf:typing      # the typing latency benchmark
cargo test --workspace   # Rust tests
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the full setup, every npm script, and the workflow for branches and pull requests.

## Repository map

```text
app/           The desktop app
  src/         TypeScript and React interface
    core/      Interface-side models: ink, audio, page layout and rules
    editor/    The typed notes editor: schema, Markdown, tables, and highlighting
    features/  One folder per feature, each with a README: page, pages (views, paper, export), ink,
               tables, math, study, tools, search, audio, interop, intel, diagnostics, connectors,
               qol (shell extras), tree, settings, setup, and more
    services/  The notes and page service contracts, with their Tauri and in-memory versions
    shell/     The window, panes, command bar, and title bar
  src-tauri/   Rust shell, built on Tauri 2: commands for notes, search, audio, import and export,
               intelligence, diagnostics, connectors, and the shell extras
brand/         Design tokens, logo, and app icon
checks/        The CHECKS quality gate
crates/        Rust libraries (Phase 3)
  core/        Document model, file format, storage, undo, and search
  crashreport/ Crash reports with consent and scrubbing (Phase 13)
  diagnostics/ The self-check and the feedback file (Phase 13)
  intel/       On-device intelligence through Windows (Phase 12)
  interop/     Import and export of other apps' formats (Phase 11)
  media/       Recording, Opus encoding, and playback (Phase 9)
  search/      The search index (Phase 8)
  updater/     Self-updater (fetch, verify, install, rollback)
docs/          Plans, specs, and guides
  adr/         Architecture decision records, including Phase 4's 0020 to 0026
  design/      Screen wireframes and the generator that draws them
  format/      Note file format specification and tools
  perf/        Performance records, starting with Phase 4's typing numbers
spikes/        Throwaway Phase 1 experiments and their results
tests/         End-to-end, UI, performance, and crash tests (Phase 3)
  crash/       Crash safety tests that kill the app during saves
  e2e/         Real-app tests: the smoke set (keyboard, screen reader) and typed notes
  perf/        Performance benchmarks for every budget
    typing/    The typing latency benchmark for the 20-page note (Phase 4)
  ui/          Screenshot tests of every screen and size
.github/       Issue and pull request templates, and the CI and release workflows
```

The root also holds tool settings such as `package.json`, `Cargo.toml`, and `checks.config.json`.

## Documentation

The [documentation index](docs/README.md) lists everything in `docs/`. Start with the wiki for guides, or pick a document below.

| Document                                                             | What it covers                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Project wiki](https://github.com/XrxcGH/OpenNote/wiki)              | The user guide, development updates, and the developer guide                           |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)                           | The step-by-step plan for the Windows prototype, with tests and release gates          |
| [docs/FEATURES.md](docs/FEATURES.md)                                 | The feature spec: Office and Google, handwriting, transcripts, study tools, and more   |
| [docs/RESEARCH.md](docs/RESEARCH.md)                                 | Popular and rising note apps, the features people love, and the gaps OpenNote can fill |
| [docs/BRAND.md](docs/BRAND.md)                                       | Colors, type, layout, motion, accessibility, and performance budgets                   |
| [docs/design/SCREENS.md](docs/design/SCREENS.md)                     | Wireframes of each major screen, with sizes and keep-out zones                         |
| [docs/CHECKS.md](docs/CHECKS.md)                                     | The quality gate every file change must pass                                           |
| [docs/format/README.md](docs/format/README.md)                       | The note file format specification and tools (Phase 3)                                 |
| [docs/adr/README.md](docs/adr/README.md)                             | The architecture decision records (ADRs), and how to write one                         |
| [docs/RELEASING.md](docs/RELEASING.md)                               | The maintainer guide to cutting, checking, and rolling back a release                  |
| [docs/CONNECTORS.md](docs/CONNECTORS.md)                             | Registering OpenNote with each connected service, and where the client IDs go          |
| [docs/testing/beta-4-checklist.md](docs/testing/beta-4-checklist.md) | The hand test checklist for beta 4, safest way to run it first                         |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                   | How to set up, make a change, and get it merged                                        |
| [SECURITY.md](SECURITY.md)                                           | How to report a security problem privately                                             |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)                             | How we treat each other                                                                |

## License

OpenNote is licensed under the [Apache License 2.0](LICENSE).
