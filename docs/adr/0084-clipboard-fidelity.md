# ADR 0084: Copy writes formatting other apps read, and paste keeps source formatting with Paste Options

- Status: Accepted
- Date: 2026-11-07

## Context

Copying from OpenNote used ProseMirror's default serializer. It writes `data-color` and `data-size` attributes, which Word and Docs ignore, so colors, highlight colors, and sizes were lost. Pasting into OpenNote dropped fonts and sizes on purpose (`app/src/features/page/paste/normalize/common.ts`), which is the clean paste of FEATURES.md. Word offers Keep Source Formatting, Merge Formatting, and Keep Text Only after every paste.

## Decision

- **Copy** writes HTML where each formatted element keeps its `data-` attributes and gains an inline `style` in points that Word and Docs read, with `mso-highlight` and `mso-line-height-rule` hints for Word. Spans of one run join, so a run in Georgia 13 pt red is one span. The style is written as text through an attribute, because the browser's style parser would rewrite colors as `rgb()` and drop the `mso-` properties. Copy also writes `text/plain` and, as `text/markdown`, the selection's Markdown.
- **Paragraph formatting** has no DOM attribute, so copy also writes it as JSON in `data-paste-para` on the paragraph, heading, and list item. Paste reads that attribute only from OpenNote's own copy (detected by `data-pm-slice`) and from the Keep source pass. Every other HTML loses it first, and every value is read through the file format's own checks (`paraFormat`). The list reference stays out, because it names data of one page.
- **Paste** from OpenNote keeps everything. Paste from Word, Google Docs, and OneNote keeps source formatting by default: fonts, sizes, colors, highlights, bold, italic, underline styles, small caps, letter spacing, alignment, indents, spacing, line spacing, and page break flags. The pass reads CSS lengths in `pt`, `in`, `cm`, `mm`, `px`, and `pc`, rounds sizes to half points, and removes each declaration it used. Paste from the web keeps today's clean merge unless Settings says otherwise.
- A **Paste options** notice after each paste says which choice it used and opens a menu of Keep source formatting, Merge formatting, and Keep text only. Choosing replaces the pasted text in one transaction, and the page closes its undo step after it, so the switch is one undo step. Any edit after the paste ends the notice. Settings, Editing sets the default for Word, Docs, OneNote, and the web (`text.paste.*`, already in the settings schema).
- Only mapped properties survive. No `style` attribute or class reaches the page.
- Everything sits behind `text.pasteFidelity`. With it off, copy and paste are what they were.

## Options considered

| Option | For | Against |
|---|---|---|
| Inline CSS on copy, source formatting on paste with options (chosen) | Matches Word and Docs both ways; the person can change the choice after pasting | Pasted fonts can make notes uneven; needs the options notice |
| Keep the clean paste and add only copy fidelity | Notes stay uniform | Pasting from Word loses what the owner asked to keep |
| Keep source formatting with no options | Simple | No way back to clean text except undo and Ctrl+Shift+V |

## Consequences

The Word and Docs fixtures (`word-v2.html`, `gdocs-v2.html`) are hand-written to the structure those programs write, not captures, and carry no personal data. Captures from the reference apps replace them when the owner supplies sanitized ones. Word list formats beyond bullets and numbers need list definitions that a paste cannot carry, so they stay with the list item's own style until the lists lane adds a paste route. This changes a built behavior, so it is PLAN.md owner decision 4.
