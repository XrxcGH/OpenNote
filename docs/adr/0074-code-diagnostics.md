# ADR 0074: Error detection with own checkers first, and a code tools pack

- Status: Proposed
- Date: 2026-11-01

## Context

People expect squiggles as they type. The options differ in size (measured, gzip): CodeMirror's Lezer parsers are already in the language packs (12 to 34 KB); Ruff 0.17.3's WebAssembly build is 3,646,641 B; the TypeScript 6.0.3 language service is 1,639,161 B; clang is in the C and C++ pack (ADR 0070). The default lazy chunk budget is 40 KB (`app/bundle-budget.json`).

## Decision

We will detect errors in layers:

- Lezer syntax errors on every change.
- OpenNote's own checkers over the Lezer tree, in a worker: undefined names, unused variables and imports, and common mistakes. They use the rule codes people know: pyflakes codes as Ruff documents them for Python, and ESLint rule names for JavaScript.
- Engine checks for SQL (`sqlite3_prepare_v2`), Lua (`load`), and Python (`compile`).
- clang `-fsyntax-only` when the C and C++ pack is present.
- An optional **code tools pack**, downloaded with consent: Ruff for Python lint and format, and the TypeScript language service for types, members, definitions, and rename. Every result carries the document version, and stale results are dropped.

## Options considered

| Option | For | Against |
|---|---|---|
| Own checkers plus an optional tools pack (chosen) | Useful errors with no download; precise tools for those who want them; small bundle | Own checkers cover fewer rules than Ruff or TypeScript |
| Bundle Ruff and TypeScript | Best checks from the start | About 5.3 MB gzip more in every installer |
| tree-sitter grammars | Many languages | `web-tree-sitter.wasm` 83,663 B gzip plus a grammar per language, duplicating Lezer |
| Only errors from running | Nothing to build | Misses "automatic error detection" |

## Consequences

- Easier: diagnostics work offline on every build; adding a rule is a checker plus a known-answer test.
- Harder: own checkers must match the reference tools' answers on the shared rules, which the tests check.
- Follow-up: the `Diagnostic` contract; the checkers for Python, JavaScript, TypeScript, Lua, C, and C++; the pack entries; latency gates (marks within 400 ms of a pause in a 1,000-line file).
- Revisit if most people download the tools pack (then bundle it), or if the TypeScript pin of ADR 0003 moves.
