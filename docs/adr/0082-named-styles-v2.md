# ADR 0082: Named styles move to notebook.json, gain inheritance and user styles, and pages can carry their own sheet

- Status: Proposed
- Date: 2026-11-01

## Context

Ten styles are editable today, but they live in this device's `localStorage` (`app/src/features/page/styles/store.ts`). So they don't sync, don't export, and are lost on another device. Yet the core can already write `notebook.json` `styles` (`crates/core/src/session/notebook.rs`). Word and Docs users expect user styles, `basedOn`, next style, character styles, theme fonts, "update style to match selection", and imported documents that keep their own styles.

## Decision

- Two bridge commands, `notebook_styles_get` and `notebook_styles_set`, expose the core's notebook styles. On first run, each notebook's local styles are copied into its `notebook.json` when it has no `styles` yet, and the local copy is cleared.
- Style objects gain the keys in DESIGN.md section 2.4: `type`, `label`, `basedOn`, `next`, `order`, `hidden`, `sizePt`, `weight`, the run keys, the paragraph keys, and `list`. User styles are named `u-<slug>`. Character styles apply through a `data-style` tag.
- `notebook.json` gains `theme` (fonts and colors) and `stylesChanged` (the time each style last changed). Two copies merge per style by those times.
- `page.json` gains an optional `styles` sheet with the same shape. It overrides the notebook's styles by key for that page. DOCX import writes a document's styles there.
- Resolution follows Word's order (ECMA-376 Part 1, 17.7.2), with the page sheet between the notebook styles and direct formatting.

## Options considered

| Option | For | Against |
|---|---|---|
| Notebook styles plus optional page sheets (chosen) | Synced, exported, and imported faithfully; imported pages don't restyle the notebook | Two places to look; the gallery must show where a style comes from |
| Notebook styles only | Simpler | Importing a DOCX either restyles the whole notebook or puts every font on every run |
| Keep device-local storage | No format change | Styles don't sync or export, which breaks the promise that every use updates, on other devices |

## Consequences

Every key is optional and version 1 readers keep it, so this needs no version bump (ADR 0078). Built-in style sets for OpenNote, Word, Word for Microsoft 365, and Google Docs come with fixture files from those apps. The styles dialog becomes the Format pane's style mode.
