# CHECKS

CHECKS is the quality gate for OpenNote. Every file change must pass it before it is merged or released. It runs on your machine before each commit and again in continuous integration (CI) on every push and pull request.

## Contents

- [Quick start](#quick-start)
- [What it checks](#what-it-checks)
- [Errors and warnings](#errors-and-warnings)
- [Suppressing a finding](#suppressing-a-finding)
- [Configuration](#configuration)
- [Where it runs](#where-it-runs)
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
| `spelling` | British and other non-American spellings, such as `colour` or `organise` | Docs and code comments |
| `grammar` | Wrong article (`a`/`an`), repeated words, `could of`, `then`/`than`, spacing and bracket slips | Docs and code comments |
| `ai-markers` | Chatbot leftovers, stock AI phrases such as `delve`, heavy em dash use, emoji headings, formulaic bold-label lists | Docs and code comments |
| `redundancy` | Wordy phrases such as `in order to`, repeated sentences and paragraphs, paragraphs copied between documents | Docs and code comments |
| `length` | Long sentences, paragraphs and sections; long code lines | Docs, comments, code |
| `readability` | Reading grade per section (ease of learning); acronyms defined on first use | Docs |
| `usability` | One title, no skipped heading levels, sentence-case headings, table of contents for long docs, working links, image alt text, basic UI accessibility | Docs and UI code |
| `modifiability` | File and function length, nesting depth, parameter count, TODOs without an issue link, commented-out code, copy-pasted blocks | Code |
| `brand-consistency` | UI code must use design tokens for colors, fonts, motion, layers and font sizes | App UI code |
| `brand-tokens` | `brand/tokens.json` themes match, colors are valid, text meets contrast targets, motion stays under 400 ms | Design tokens |

The word lists live in `checks/data/` as JSON, so you can extend them without touching code.

For a full grammar check, run a LanguageTool server and set `CHECKS_LANGUAGETOOL_URL` (for example `http://localhost:8081`). Its suggestions appear as warnings.

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

- `severity`: `"error"`, `"warning"` or `"off"` to override every finding of that rule
- `exclude`: glob patterns of files the rule skips
- rule-specific limits, such as `length.sentenceWords` or `modifiability.functionLines`

Top-level `ignore` patterns skip files entirely. Change a limit only with a reason in the pull request, because loosening limits is how quality slips.

## Where it runs

- **Pre-commit hook:** `.githooks/pre-commit` checks staged files. Enable it with `npm run setup-hooks`.
- **CI:** `.github/workflows/checks.yml` type-checks and tests the checker, then checks changed files on pull requests and all files on pushes. It runs on Ubuntu and Windows.
- **Releases:** the release checklist in `DEVELOPMENT.md` requires a clean `npm run checks:all`.

## Adding or changing a rule

1. Create `checks/rules/<name>.ts` exporting a `Rule` (see `checks/types.ts`). Keep functions short; the checker holds itself to its own limits.
2. Register it in `checks/rules/index.ts`.
3. Add tests in `checks/test/` covering a failing and a passing case.
4. Document it in the table above.
5. Run `npm run typecheck`, `npm run test:checks` and `npm run checks:all`.
