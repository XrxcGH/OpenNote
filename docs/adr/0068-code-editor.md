# ADR 0068: CodeMirror 6 for the Code studio and code cells

- Status: Proposed
- Date: 2026-11-01

## Context

The owner wants people to write, test, and debug code in OpenNote with the editing they know from VS Code, JetBrains, Replit, and LeetCode. Today code cells are a plain `<textarea>` with Tab indenting (`app/src/features/codecells/CodeCellPanel.tsx`, `indent.ts`), and page code blocks are ProseMirror text highlighted by lowlight (ADR 0021). ADR 0021 rejected CodeMirror 6 for page code blocks and said to revisit "if people ask for code editing features (then a CodeMirror view in a node view or a dialog, with its own ADR)". This is that ADR.

Forces: typing within 16 ms; touch, pen, and on-screen keyboard use on the Surface; screen readers; the 40 KB default budget for a lazy chunk and the 520 KB start-up budget (`app/bundle-budget.json`); diagnostics, completion, ghost text, breakpoints, and inline values need an editor with decorations, gutters, and transactions.

## Decision

We will use CodeMirror 6 (MIT) for the Code studio's editor and for code cells, pinned to exact versions (`@codemirror/view` 6.43.15, `state` 6.7.6, `language` 6.13.1, `commands` 6.11.1, `autocomplete` 6.20.4, `lint` 6.9.7, `search` 6.7.2, and `lang-python` 6.2.1, `lang-javascript` 6.2.5, `lang-sql` 6.10.0, `lang-cpp` 6.0.3, `lang-java` 6.0.2, `lang-rust` 6.0.2, `lang-go` 6.0.1, `legacy-modes` 6.5.5 for the rest). The editor loads lazily in its own chunk with a `lazyKb` entry of at most 190 KB gzip; each language pack is its own chunk under the 40 KB default. Page code blocks stay on lowlight; ADR 0021 is unchanged for them.

## Options considered

| Option | For | Against |
|---|---|---|
| CodeMirror 6 (chosen) | Measured 81,708 B gzip for view and state, 136,691 B gzip with language, commands, autocomplete, lint, and search; language packs 12 to 34 KB gzip; `contenteditable` gives the system caret, selection handles, IME, on-screen keyboard, and the Windows handwriting panel; real DOM text for screen readers; themable with CSS variables | Fewer built-in IDE features than Monaco; TypeScript intelligence must be added (ADR 0074) |
| Monaco 0.57.0 | VS Code's editor, with its TypeScript worker | Measured 620,056 B gzip editor chunk plus a 318,536 B chunk, and a 1,547,713 B gzip TypeScript worker; the project documents no mobile or touch support; its own theming and focus model |
| Keep the `<textarea>` and add features | No dependency | Every feature (gutters, squiggles, folding, multiple carets, ghost text) from scratch; slow on large files |
| Ace | Mature, small | Older architecture, weaker accessibility, and touch support, smaller ecosystem for lint, and completion |

## Consequences

- Easier: every editing row of MATRIX section A, diagnostics display, completion, and ghost text as extensions, gutter breakpoints, per-file undo history.
- Harder: two editing models in the app (ProseMirror for pages, CodeMirror for code). Code cells are panel blocks with their own React root already, so focus and undo were separate before; the Escape-then-Tab exit stays. By the owner decision of 2026-11-01, Tab and Shift+Tab only indent and outdent in both surfaces, and Ctrl+Tab accepts a suggestion, which takes Ctrl+Tab from Next page tab while a code editor has focus (DESIGN 5.3.1).
- Follow-up: the `codeEditor` key scope and the keymap test (DESIGN.md section 5.3), themes from the `code.*` tokens with forced colors, NVDA tests, the typing benchmark in a 1,000-line file.
- Revisit if CodeMirror's accessibility fails NVDA tests the app cannot fix, or if the chunk passes 190 KB gzip.
