# CHECKS

CHECKS is the quality gate for OpenNote. Every file change must pass it before it is merged or released. It runs on your machine before each commit and again in continuous integration (CI) on every push and pull request.

## Contents

- [Quick start](#quick-start)
- [What it checks](#what-it-checks)
- [Errors and warnings](#errors-and-warnings)
- [Suppressing a finding](#suppressing-a-finding)
- [Configuration](#configuration)
- [Where it runs](#where-it-runs)
- [Asset attribution](#asset-attribution)
- [Clippy ratchet](#clippy-ratchet)
- [Cross-checks](#cross-checks)
- [Adding or changing a rule](#adding-or-changing-a-rule)

## Quick start

You need Node.js 22.18 or newer. The checker itself has no dependencies.

```sh
npm install              # formatter and type checker for contributors
npm run setup-hooks      # run CHECKS on every commit
npm run checks           # check files changed since origin/main
npm run checks:all       # check every file
npm run checks:fix       # apply safe automatic fixes
```

Other options: `--staged`, `--base <ref>`, `--rules spelling,grammar`, `--strict`, `--quiet`, `--format json` and `--list-rules`. Run `node checks/cli.ts --help` for details.

## What it checks

| Rule | Covers | Applies to |
|---|---|---|
| `hygiene` | Trailing spaces, Windows line endings, missing final newline, invisible characters, merge markers, leaked keys, files over 1 MB | All text files |
| `spelling` | British and other non-American spellings, such as `colour` or `organise`. OpenNote's default language is American English, so the docs, the help pages, and the text people read in the app all use it | Docs, code comments, and the text in the string literals of UI code and Rust (the `strings` setting) |
| `grammar` | Missing serial (Oxford) comma, wrong article (`a`/`an`), repeated words, `could of`, `then`/`than`, spacing and bracket slips | Docs and code comments |
| `ai-markers` | Chatbot leftovers, stock AI phrases such as `delve`, heavy em dash use, emoji headings, formulaic bold-label lists | Docs and code comments |
| `redundancy` | Wordy phrases such as `in order to`, repeated sentences and paragraphs, paragraphs copied between documents | Docs and code comments |
| `length` | Long sentences, paragraphs, and sections; long code lines | Docs, comments, code |
| `readability` | Reading grade per section (ease of learning); acronyms defined on first use | Docs |
| `usability` | One title, no skipped heading levels, sentence-case headings, table of contents for long docs, working links, image alt text, basic UI accessibility | Docs and UI code |
| `modifiability` | File and function length, nesting depth, parameter count, TODOs without an issue link, commented-out code, copy-pasted blocks | Code |
| `brand-consistency` | UI code must use design tokens for colors (hex, color functions, and named colors such as `white`), fonts (including the `font` shorthand), motion, layers, and font sizes | App UI code in `app/src`, except the generated token files |
| `logical-properties` | Warns about physical CSS properties and values, such as `left`, `margin-right`, `width`, and `text-align: left`, so a right-to-left language later needs only `dir="rtl"` | Style sheets and inline styles in `app/src` |
| `ui-voice` | Interface text follows the voice in BRAND.md: sentence case, no exclamation marks, no "Oops", no emoji, digits for numbers, and shortcuts written as Ctrl+Shift+D. The spelling, grammar, and AI marker rules also run on each string. ICU messages are checked branch by branch | The string files in `app/src/strings/en` |
| `layout` | Renders each SVG in a headless browser and checks overlapping text, padding inside containers, centering, alignment, edge spacing, minimum text size, safe margins, scaling, and sentence case | SVG graphics |
| `brand-tokens` | `brand/tokens.json` themes match, colors are valid, text meets contrast targets, motion stays under 400 ms. The `forcedColors` map for Windows contrast themes must name existing color tokens and CSS system colors such as `Canvas` or `Highlight`. Contrast pairs can name pens and highlighters (`ink.pens.Fern`), checked with each theme's value, and `over` composites a translucent background, such as a highlighter, over a surface first. A pair can set a floor (`min`), a ceiling (`max`), or both: ambient washes use a ceiling so they stay close to the surface beside them | Design tokens |

The word lists live in `checks/data/` as JSON, so you can extend them without touching code.

The `layout` rule needs a Chromium-based browser (Chrome, Edge, or Chromium). It finds one automatically, or you can set `CHECKS_BROWSER` to its path.

For a full grammar check, run a LanguageTool server, and set `CHECKS_LANGUAGETOOL_URL` (for example `http://localhost:8081`). Its suggestions appear as warnings.

## Errors and warnings

Errors block the commit and fail CI. Warnings are shown but don't block, unless you pass `--strict`.

Treat warnings as review notes. Fix them when the fix makes the text or code better. Leave them when the rule is wrong for that case, and add a suppression if the warning keeps coming back.

## Suppressing a finding

Sometimes a rule is wrong, for example when quoting a source or naming a product. Put a directive on the line before, with the rule and a reason:

```md
<!-- checks-disable-next-line <rule-id>: <reason> -->
```

In code, use a comment such as `// checks-disable-next-line <rule-id>: <reason>`. To exempt a whole file, use `checks-disable-file` instead.

A suppression without a reason, or with an unknown rule, is itself an error and suppresses nothing. Text inside double quotes is already skipped by the spelling, AI marker and redundancy rules, so exact quotes need no suppression.

## Configuration

`checks.config.json` sets limits and exceptions. Each rule accepts:

- `severity`: `"error"`, `"warning"`, or `"off"` to override every finding of that rule
- `exclude`: glob patterns of files the rule skips
- rule-specific limits, such as `length.sentenceWords` or `modifiability.functionLines`
- `spelling.allow`: words to let through, such as a proper name. `spelling.strings`: the globs of source files whose string literals are read; the default is `app/src/**/*.tsx`, `app/src-tauri/src/**/*.rs`, and `crates/*/src/**/*.rs` (the strings in `app/src/strings/en` are read by `ui-voice`). A literal that must keep a British spelling, such as a file format's keyword, takes a `checks-disable-next-line spelling: <reason>` comment

Top-level `ignore` patterns skip files entirely. Change a limit only with a reason in the pull request, because loosening limits is how quality slips.

## Where it runs

- **Pre-commit hook:** `.githooks/pre-commit` checks staged files. Enable it with `npm run setup-hooks`.
- **CI:** `.github/workflows/ci.yml` type-checks, lints, and tests everything, then runs CHECKS on changed files for pull requests and on all files for pushes. It runs on Ubuntu and Windows.
- **Releases:** the [release checklist](DEVELOPMENT.md#10-release-checklist) requires a clean `npm run checks:all`.

## Asset attribution

Every picture, font, sound, model, and other non-code file needs a row in [ATTRIBUTION.md](ATTRIBUTION.md) with its author, source, and license. So does every crate copied into `crates/third_party/`, which must also keep its license files. Fonts reach the app through npm, so each `@fontsource` package in `package.json` needs an `npm:` row too, and its copyright line must appear in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), which the app shows under Settings, then About. `npm run checks:assets` lists the gaps, and `npm test` runs the same check. A row that matches no file fails too, so the table cannot go stale.

## Clippy ratchet

New Rust code in `crates/` and `app/src-tauri` must not call `unwrap`, `expect`, or `panic!`. Old code is not rewritten. Instead, `checks/data/clippy-ratchet.json` counts the existing uses in each file, and `npm run checks:clippy` fails when a count goes up or a file with none gets one. It lints library and binary targets only, so tests, benches, and examples may still unwrap.

When you remove a use, run `node checks/clippy-ratchet.ts --update` to lower the count and commit the file. CI runs the ratchet after Clippy on Windows.

## Cross-checks

Another program reading OpenNote's files catches mistakes that our own tests share. `npm run crosscheck` builds a small corpus of exports and runs it through four open-source tools, each built from a revision pinned in `tests/crosscheck/pins.json`:

| Export | Reader | What it checks |
|---|---|---|
| Word (`.docx`) | `wordcraft-cli` | The file opens, has pages and text, and has a structure |
| Excel (`.xlsx`) | `gridcraft-cli` | Package parts, content types, relationships, and recalculated values |
| PowerPoint (`.pptx`) | `deckcraft-cli` | The deck opens |
| PDF | `pdfcraft-cli` | The 32-rule accessibility check, and PDF/A-2b preflight as notes |

`npm run crosscheck:formulas` also runs about 200 table formulas through OpenNote's engine and through `gridcraft-cli eval`, and fails on a result that differs and is not listed in `KNOWN` of `app/src/features/tables/engine/gridcraftDiff.test.ts` with its reason. Dates there are compared after the gap between the 1900 and 1970 epochs.

Three formula differences are decided and stay in `KNOWN`: `2^3^2` and `-2^2` follow mathematics, `ROUND(7)` accepts one argument, and `COUNTA` of an empty text does not count it, because an empty table cell holds empty text. `POWER(0,0)` was changed to `#NUM!` to match Excel.

These tools are alpha software, so a difference means "look", not "bug". The `crosscheck` workflow (`.github/workflows/crosscheck.yml`) runs weekly and on pull requests that touch exports, and it never blocks a merge. Use `npm run crosscheck:install` once to build the tools locally. It needs Rust and several minutes. Nothing from them ships with OpenNote.

## Adding or changing a rule

1. Create `checks/rules/<name>.ts` exporting a `Rule` (see `checks/types.ts`). Keep functions short; the checker holds itself to its own limits.
2. Register it in `checks/rules/index.ts`.
3. Add tests in `checks/test/` covering a failing and a passing case.
4. Document it in the table above.
5. Run `npm run typecheck`, `npm run test:checks` and `npm run checks:all`.
