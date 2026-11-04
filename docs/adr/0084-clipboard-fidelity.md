# ADR 0084: Copy writes formatting other apps read, and paste keeps source formatting with Paste Options

- Status: Proposed
- Date: 2026-11-01

## Context

Copying from OpenNote uses ProseMirror's default serializer. It writes `data-color` and `data-size` attributes, which Word and Docs ignore, so colors, highlight colors, and sizes are lost. Pasting into OpenNote drops fonts and sizes on purpose (`app/src/features/page/paste/normalize/common.ts`), which is the "clean paste" of FEATURES.md. Word offers Keep Source Formatting, Merge Formatting, and Keep Text Only after every paste.

## Decision

- **Copy** writes HTML where each formatted element carries its `data-` attributes and an inline `style` in points that Word and Docs read (with `mso-` hints for Word). It also writes plain text and, where the platform allows custom formats, Markdown.
- **Paste** from OpenNote keeps everything. Paste from Word, Google Docs, and OneNote keeps source formatting by default: fonts, sizes, every mapped character format, alignment, indents, spacing, and list formats. Paste from the web keeps today's clean merge.
- A Paste Options chip after each paste switches among Keep source formatting, Merge formatting, and Keep text only, in one undo step. Settings, Editing sets the default for each source.
- Only mapped properties survive. No `style` attribute or class reaches the page.

## Options considered

| Option | For | Against |
|---|---|---|
| Inline CSS on copy, source formatting on paste with options (chosen) | Matches Word and Docs both ways; the person can change the choice after pasting | Pasted fonts can make notes uneven; needs the options chip |
| Keep the clean paste and add only copy fidelity | Notes stay uniform | Pasting from Word loses what the owner asked to keep |
| Keep source formatting with no options | Simple | No way back to clean text except undo and Ctrl+Shift+V |

## Consequences

The paste fixtures need new captures from Word and Docs with fonts, sizes, and paragraph formats. This changes a built behavior, so it is PLAN.md owner decision 4.
