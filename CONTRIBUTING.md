# Contributing to OpenNote

OpenNote welcomes bug reports, fixes, features, documentation, and design work. This guide explains how to set up your computer, make a change, and get it merged. By taking part, you agree to follow the [code of conduct](CODE_OF_CONDUCT.md). Report security problems privately, as described in [SECURITY.md](SECURITY.md), never in a public issue.

## Contents

- [Before you start](#before-you-start)
- [Set up on Windows](#set-up-on-windows)
- [npm scripts](#npm-scripts)
- [Branches and pull requests](#branches-and-pull-requests)
- [Commit messages](#commit-messages)
- [Quality gate](#quality-gate)
- [Design tokens](#design-tokens)
- [Big changes and decision records](#big-changes-and-decision-records)
- [Releases and license](#releases-and-license)

## Before you start

These documents describe how OpenNote is planned and built:

- [DEVELOPMENT.md](DEVELOPMENT.md): the phases, technology choices, tests, and working agreements.
- [BRAND.md](BRAND.md): colors, type, motion, voice, accessibility, and performance budgets.
- [CHECKS.md](CHECKS.md): the quality gate every file change must pass.

For a small fix, you can open a pull request right away. For a new feature, open an issue first, so we can agree that it fits the current phase before you write code.

## Set up on Windows

Windows is the first platform OpenNote supports. Install these tools once, in this order:

1. **Microsoft C++ Build Tools.** Install the [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/), and select the "Desktop development with C++" workload. Rust needs it to link programs on Windows, so install it before Rust.
2. **WebView2.** It ships with Windows 10 and 11, so there is usually nothing to install. If it's missing, install the Evergreen Runtime from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).
3. **Rust stable, through rustup.** Install it from [rustup.rs](https://rustup.rs/), and keep the default `stable-msvc` toolchain. If you changed it, `rustup default stable-msvc` sets it back. Run `rustup update` now and then.
4. **Node.js 22.18 or newer.** Get the long-term support release from [nodejs.org](https://nodejs.org/).
5. **Git**, to clone the repository.

On macOS or Linux, install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your system in place of steps 1 and 2.

Open a new terminal, so it finds the new tools. Then clone the repository and start the app with one line:

```sh
git clone https://github.com/XrxcGH/OpenNote.git
cd OpenNote
npm install && npm start
```

Windows PowerShell 5.1, the version built into Windows, doesn't accept `&&`. There, run `npm install` and then `npm start`, or use PowerShell 7 or Command Prompt. If PowerShell says that running scripts is disabled, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

The first start compiles the Rust dependencies, which takes several minutes. Later starts are much faster. The window updates when you edit UI code, and the app rebuilds and restarts when you edit Rust code.

Also run `npm run setup-hooks` once, so CHECKS runs before each commit.

## npm scripts

| Script | What it does |
|---|---|
| `npm start` | Runs the desktop app in development mode with live reload (`tauri dev`). |
| `npm run app:dev` | Starts only the Vite server for the UI on port 1420. `npm start` runs it for you. |
| `npm run app:build` | Regenerates the design tokens and builds the UI into `app/dist`. |
| `npm run app:test` | Runs the UI tests with Vitest. |
| `npm run app:typecheck` | Type-checks the UI and its build scripts. |
| `npm run test:components` | Runs the component tests in the installed Edge or Chrome. |
| `npm run test:ui` | Builds the UI with the web platform and runs the Playwright screen and accessibility tests. |
| `npm run test:e2e` | Runs the end-to-end specs against the built app, which need `tauri-driver` and `msedgedriver` (see `tests/e2e/harness.ts`). They skip when a tool is missing. |
| `npm test` | Runs the CHECKS tests and the UI tests. |
| `npm run lint` | Lints TypeScript and JavaScript with ESLint. |
| `npm run typecheck` | Type-checks all TypeScript: CHECKS, the wireframe generator, and the app. |
| `npm run format` | Formats code with Prettier. |
| `npm run format:check` | Reports formatting problems without changing files. |
| `npm run tokens` | Generates `app/src/theme/tokens.css` and `tokens.ts` from `brand/tokens.json`. |
| `npm run tokens:check` | Fails if the generated token files are out of date. |
| `npm run checks` | Runs CHECKS on files changed since `origin/main`. |
| `npm run checks:all` | Runs CHECKS on every file. |
| `npm run checks:fix` | Applies the safe automatic fixes CHECKS offers. |
| `npm run test:checks` | Tests the CHECKS program itself. |
| `npm run setup-hooks` | Turns on the Git hook that runs CHECKS before each commit. |
| `npm run tauri -- <command>` | Runs the Tauri command line, for example `npm run tauri -- info`. |

The Rust checks use `cargo` directly, as the [quality gate](#quality-gate) shows.

### Running the app with its own data

The app keeps its files in `%APPDATA%\OpenNote` (settings) and `%LOCALAPPDATA%\OpenNote` (device state, logs, and the WebView2 data). These environment variables change how a run behaves, which is how the tests keep away from your real settings:

| Variable | What it does |
|---|---|
| `OPENNOTE_PROFILE_DIR=<folder>` | Puts every file under `<folder>` (`roaming`, `local`, and `Documents`), and gives the run its own instance lock, so several runs can start side by side. |
| `OPENNOTE_PERF_LOG=<file>` | Writes the start-up marks as JSON lines: `processCreated`, `mainEntered`, `settingsLoaded`, `windowCreated`, `windowShown` (with the window's color), `webviewCreated`, then the interface's `firstPaint` (with the theme it painted), `shellReady`, and `pageReady`. |
| `OPENNOTE_FLAGS=<id>=1,<id>=0` | Turns feature flags on or off, in development and nightly builds only. |

The log is `logs\opennote.log` in the local folder. It keeps five files of 1 MB and never holds note content.

## Branches and pull requests

Each phase in [DEVELOPMENT.md](DEVELOPMENT.md#5-phases) is developed on its own branch, named `phase-N`. For example, Phase 2 lives on `phase-2`. When the phase meets its exit gate, a pull request merges `phase-N` into `main` with a merge commit, so each commit stays in the history.

For your own change, create a short-lived branch off the phase branch in progress, usually the highest-numbered one. Then open a pull request into that phase branch. A fix that isn't part of any phase, such as a typo or an urgent bug, branches off `main` and targets `main`. If you can't push to the repository, fork it, push your branch to the fork, and open the pull request from there.

A good pull request:

- Makes one change that a reviewer can read in one sitting, ideally under 400 changed lines.
- Explains what changed and why, and links the issue it closes.
- Includes screenshots for visual changes, in both the light and dark themes.
- Passes every CI check, and has one approving review before it merges.

## Commit messages

Make one logical change per commit. Keep a refactor, a formatting change, and a behavior change in separate commits, so each one is easy to review and revert.

Write the subject line in the imperative mood, under about 72 characters, with no period at the end. Leave a blank line after it. In the body, explain what changed and why, and mention anything a reviewer might not expect.

```text
Keep the page scroll position when switching themes

Switching themes rebuilt the page view and scrolled back to the top.
The view now keeps its scroll offset across the style swap, as BRAND.md
requires for theme changes.

Fixes #42
```

## Quality gate

Continuous integration (CI) runs on every pull request, on Windows and Ubuntu. A pull request can merge only when all of these pass:

1. CHECKS on the changed files. See [CHECKS.md](CHECKS.md) for the rules, and for how to suppress a finding with a reason when a rule is wrong.
2. Lint and format checks: ESLint and Prettier for TypeScript, and Clippy and rustfmt for Rust.
3. Type checks for all TypeScript code.
4. Tests: the UI tests, the CHECKS tests, and the Rust tests.
5. A check that the design tokens are current, and a debug build of the app on Windows.

Run the same checks locally before you push:

```sh
npm run tokens:check
npm run typecheck
npm run lint
npm run format:check
npm test
npm run checks
```

If you changed Rust code, also run the Rust checks from the repository root. Build the UI first, because the Rust app embeds it:

```sh
npm run app:build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

To fix formatting instead of reporting it, run `npm run format` or `cargo fmt --all`. CI treats every Clippy warning as an error.

Every bug fix adds a test that fails without the fix. Every TODO in code links to an issue. A feature is finished only when it meets the [definition of done](DEVELOPMENT.md#11-definition-of-done).

## Design tokens

UI code uses design tokens only. Colors, fonts, font sizes, motion, and layers all come from the generated files in `app/src/theme/`. The CHECKS `brand-consistency` rule rejects raw values in `app/src`.

To change how OpenNote looks, edit `brand/tokens.json`, and then run `npm run tokens`. Commit the edited JSON and the regenerated files together. Never edit the generated files by hand, because the next run overwrites them. The `brand-tokens` rule confirms that both themes still define every token and meet their contrast targets. See [Using the tokens](BRAND.md#14-using-the-tokens) for details.

## Big changes and decision records

Anything hard to reverse needs an architecture decision record (ADR) before the code. Examples include a new framework or core library, a change to the note file format, and a new platform interface. An ADR records the choice, the options considered, and the reasons.

To propose one:

1. Copy the template to a new file with the next free number, as [docs/adr/README.md](docs/adr/README.md) explains.
2. Set the status to "Proposed", and open a pull request with the ADR and no code.
3. Discuss it in the review. If the maintainers accept it, set the status to "Accepted", and add it to the [list of decisions](docs/adr/README.md#decisions) before it merges.
4. Open the pull requests that carry out the decision, and link the ADR from them.

For a change that is large but easy to undo, an issue that describes the plan is enough.

## Releases and license

Maintainers publish releases by pushing a version tag. The steps, including the update signing key, are in [docs/RELEASING.md](docs/RELEASING.md). Contributors don't need to do anything for a release.

OpenNote is licensed under the [Apache License 2.0](LICENSE). By contributing, you agree that your contribution is licensed under the same terms.
