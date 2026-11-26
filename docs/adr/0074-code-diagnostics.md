# ADR 0074: Error detection with own checkers first, and a code tools pack

- Status: Accepted
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

## Implementation notes (Beta 12, lane code:L10)

The code lives in `app/src/features/codestudio/diagnostics/`. The code tools pack (Ruff and the TypeScript service) is the lane's Beta 13 work and is not built yet.

- **Scheduler** (`scheduler.ts`): one timer per file and layer. The pauses are 50 ms for syntax, 300 ms for the checkers and engine checks, 500 ms for the tools pack, and 800 ms for clang. A result whose version is older than the file is dropped. When the studio passes CodeMirror's `mapPos` with a change, the marks already shown move with the text until the layers answer.
- **Worker** (`checker.worker.ts`, `client.ts`): the syntax and checker layers run in one diagnostics worker. Where there is no worker, or it fails, the page runs the same code (`analyze.ts`). The syntax layer runs in the worker too, not in the editor's parse, so typing never waits for it. It still answers within 100 ms. The worker loads the bare Lezer grammars; the page loads them through the editor's language packs, so it adds no chunks of its own.
- **Syntax errors** (`syntax.ts`): Lezer error nodes for Python, JavaScript, TypeScript, C, C++, Java, Rust, Go, and SQL. Brackets are matched outside strings and comments first, so the message names the line where an unclosed bracket opened. A Python block header without its colon says so. Otherwise the message names the unexpected token, or the early end of the file. Checker marks below the first broken line are hidden, since the tree there is a guess.
- **Checkers**: Python (`python.ts`) gives F401, F811, F821, F841, E711, E712, F632, W191, and E101. JavaScript and TypeScript (`javascript.ts`, `jsFlow.ts`) give no-undef, no-unused-vars, no-const-assign, no-unreachable, eqeqeq, no-cond-assign, and no-fallthrough with ESLint's default options. C and C++ (`clike.ts`) give clang's `undeclared-identifier` and `unused-variable`. Lua (`lua.ts`) reads tokens, since the editor has no Lezer grammar for it, and gives luacheck's W113 and W211.
- **Engine checks** (`engine.ts`): runtime lanes call `registerEngineCheck`, or `fromRuntimeAdapter` with a `RuntimeAdapter` that has `check`. Line and column answers become offsets. A check registered after the studio opens joins at once.
- **Messages**: the worker returns message ids and values; the page words them from `strings/en/codeStudio/diagnostics.ts`, so the worker carries no strings.
- **Tests**: Ruff's rule examples and ESLint's rule examples are the known answers. The latency gate (`perf.test.ts`, harness `bench.ts`) checks a 1,000-line file in each checker language in under 50 ms.
- **Limits**: the C and C++ checker stays quiet where a name could come from a header it cannot see: calls, qualified names, members inside classes, files that include a project header, and `using namespace` other than std. Clang (layer L-e) covers those.
