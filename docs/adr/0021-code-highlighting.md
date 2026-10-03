# ADR 0021: Code highlighting with lowlight, not CodeMirror 6

- Status: Proposed, pending the owner's approval of the change to DEVELOPMENT.md section 2
- Date: 2026-10-02

## Context

DEVELOPMENT.md section 2 lists "CodeMirror 6 and Mermaid" for code and diagrams, loaded only when a page uses them. Phase 4's build list asks for "basic tables and code blocks with syntax highlighting". Code blocks live inside text blocks as fenced Markdown (SPEC 7.2), and the text block is one ProseMirror editor (ADR 0020). The forces:

- Typing within 16 ms, including in a code block inside a 20-page note on the reference laptop.
- One caret, one input method path, one undo path through the core, and consistent screen reader behavior across text and code.
- A small page chunk: its budget is 170 KB gzipped for everything in the editor.
- Highlighting must never run in a keystroke's task, whatever the block's size, which the design reviews required.

## Decision

We will highlight code blocks with lowlight 3.3.0 and highlight.js 11.11 grammars, loaded lazily per language, through our own ProseMirror decoration plugin. On a transaction, the plugin only maps its decorations through the change. It re-highlights changed code blocks in idle callbacks, one block per callback. Blocks over 2,000 lines highlight in slices, blocks over 10,000 lines stay plain, and a block whose highlight takes more than 20 ms stops being highlighted. Code blocks stay ProseMirror text. We won't embed CodeMirror 6 in Phase 4. Mermaid is unaffected and arrives with its own phase.

DEVELOPMENT.md section 2's row becomes "Code and diagrams: lowlight for code highlighting and Mermaid for diagrams, loaded only when a page uses them", once the owner approves.

## Options considered

| Option | For | Against |
|---|---|---|
| lowlight with our idle plugin (chosen) | About 15 KB gzipped plus 1 to 5 KB per language; code stays ordinary ProseMirror text for the caret, input method editor (IME), undo, spell check exclusion, and screen readers; no mount cost | Not incremental: a changed block is highlighted again in full, in idle time. No bracket matching or code folding |
| A CodeMirror 6 view per code block (DEVELOPMENT.md's first idea) | A real code editor | About 120 KB gzipped; each block gets a second selection, history, and focus model that must be bridged to ProseMirror as well as to the core's undo; one mount per code block; arrow-key and screen reader handoffs at every block edge |
| Lezer parsers from `@codemirror/language` as decorations | Incremental parsing, good grammars | `@codemirror/language` and its language data pull in `@codemirror/view` and `-state`; about 110 KB for the core |
| `@tiptap/extension-code-block-lowlight` | Ready-made | Re-highlights every code block inside the transaction, and needs grammars at configure time |
| Shiki 4.4 | VS Code's highlighting | A regular expression engine and TextMate grammars weigh hundreds of kilobytes; not incremental |
| Prism 1.30 | Small | In maintenance; mutates a global |

## Consequences

- Easier: code behaves like the rest of the note for typing, IME, undo, copying, and screen readers; the page chunk stays within budget; grammars cost nothing until a page uses them.
- Harder: no code-editor features (bracket matching, several carets, folding). Very long code blocks highlight with a short delay after typing pauses.
- Follow-up work: the `code.*` color tokens in both themes and forced colors; the language picker; a test that no highlighting work runs inside a transaction; the code-block typing condition in the benchmark.
- Revisit if people ask for code editing features (then a CodeMirror view in a node view or a dialog, with its own ADR), or if very long code blocks need incremental parsing (then Lezer). The Phase 4 owner checks feedback after the first beta.
