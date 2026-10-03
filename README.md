# OpenNote

![OpenNote: writing, drawing, and recording in one open-source notebook](brand/social-preview.png)

OpenNote is an open-source note-taking app that combines your favorite writing, drawing, and recording features for professional and personal use. Windows comes first; macOS, Linux, iOS, and Android follow.

**New here?** The [project wiki](https://github.com/XrxcGH/OpenNote/wiki) holds the user guide, development updates, and the developer guide.

## Status

OpenNote is in early development. Each phase of the [development plan](docs/DEVELOPMENT.md#5-phases) gets its own branch and merges into `main` when it meets its exit gate.

| Phase                                   | Focus                                                                                  | Status                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| 0                                       | Project foundation                                                                     | Done and merged                              |
| 1                                       | Spikes that test ink, text, PDF export, and audio                                      | Done and merged                              |
| 2                                       | [App shell and navigation](https://github.com/XrxcGH/OpenNote/pull/8)                  | Done and merged 2026-10-02                   |
| 3                                       | [Document model and storage](https://github.com/XrxcGH/OpenNote/pull/9)                | Done and merged 2026-10-03                   |
| 4                                       | Typed notes (text, Markdown, tables, code)                                             | In progress                                  |
| [5 to 14](docs/DEVELOPMENT.md#5-phases) | Ink, export, charts, search, audio, math, import, intelligence, hardening, and release | Core in progress; beta build being assembled |

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

That opens the OpenNote window in development mode. Run `npm run setup-hooks` once, so CHECKS runs before every commit. [CONTRIBUTING.md](CONTRIBUTING.md) has the full setup, the npm scripts, and the workflow for branches and pull requests.

## Repository map

```text
app/           The desktop app (Phase 2)
  src/         TypeScript and React interface
  src-tauri/   Rust shell, built on Tauri 2
brand/         Design tokens, logo, and app icon
checks/        The CHECKS quality gate
crates/        Rust libraries (Phase 3)
  core/        Document model, file format, storage, undo, and search
  updater/     Self-updater (fetch, verify, install, rollback)
docs/          Plans, specs, and guides
  adr/         Architecture decision records
  design/      Screen wireframes and the generator that draws them
  format/      Note file format specification and tools
spikes/        Throwaway Phase 1 experiments and their results
tests/         End-to-end, UI, performance, and crash tests (Phase 3)
  crash/       Crash safety tests that kill the app during saves
  e2e/         Smoke set of real-app tests (keyboard, screen reader)
  perf/        Performance benchmarks for every budget
  ui/          Screenshot tests of every screen and size
.github/       Issue and pull request templates, and the CI and release workflows
```

The root also holds tool settings such as `package.json`, `Cargo.toml`, and `checks.config.json`.

## Documentation

The [documentation index](docs/README.md) lists everything in `docs/`. Start with the wiki for guides, or pick a document below.

| Document                                                | What it covers                                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Project wiki](https://github.com/XrxcGH/OpenNote/wiki) | The user guide, development updates, and the developer guide                           |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)              | The step-by-step plan for the Windows prototype, with tests and release gates          |
| [docs/FEATURES.md](docs/FEATURES.md)                    | The feature spec: Office and Google, handwriting, transcripts, study tools, and more   |
| [docs/RESEARCH.md](docs/RESEARCH.md)                    | Popular and rising note apps, the features people love, and the gaps OpenNote can fill |
| [docs/BRAND.md](docs/BRAND.md)                          | Colors, type, layout, motion, accessibility, and performance budgets                   |
| [docs/design/SCREENS.md](docs/design/SCREENS.md)        | Wireframes of each major screen, with sizes and keep-out zones                         |
| [docs/CHECKS.md](docs/CHECKS.md)                        | The quality gate every file change must pass                                           |
| [docs/format/README.md](docs/format/README.md)          | The note file format specification and tools (Phase 3)                                 |
| [docs/adr/README.md](docs/adr/README.md)                | The architecture decision records (ADRs), and how to write one                         |
| [docs/RELEASING.md](docs/RELEASING.md)                  | The maintainer guide to cutting, checking, and rolling back a release                  |
| [CONTRIBUTING.md](CONTRIBUTING.md)                      | How to set up, make a change, and get it merged                                        |
| [SECURITY.md](SECURITY.md)                              | How to report a security problem privately                                             |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)                | How we treat each other                                                                |

## License

OpenNote is licensed under the [Apache License 2.0](LICENSE).
