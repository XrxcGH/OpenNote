# ADR 0020: The typed notes editor

- Status: Proposed
- Date: 2026-10-02

## Context

[Phase 4](../DEVELOPMENT.md#phase-4-typed-notes) builds typed notes: text containers anywhere on a page or stacked in a flow, rich formatting, Markdown shortcuts, images, tables, and code. Its exit gate is typing within 16 ms on the reference laptop with a 20-page note, which [ADR 0005](0005-freeform-text.md) restates as the 95th percentile from keydown to the end of rendering. The forces:

- **Accepted decisions.** ADR 0005 chose one Tiptap editor per container, with `contain: paint` on blocks. ADR 0008's draft chose text boxes that hold many paragraphs in OpenNote Markdown, with no paragraph IDs in format version 1, and left anchors to a later phase.
- **Phase 3's rules for Phase 4** (core plan 10.4). Text renders as static HTML at open, editors mount only on focus or in view, and a page never mounts 500 editors. The editor caches each node's Markdown and sends nothing during composition. It sends changed text 150 ms after typing pauses and at least every 300 ms. The core owns every undo stack.
- **Canonical Markdown.** SPEC 7 defines one canonical form with exact escaping, mark nesting, and HTML fallbacks. Phase 3 lists "the Phase 4 serializer is not canonical" as a risk.
- **Budgets.** 16 ms typing, 50 ms feedback (including undo), 150 ms page open with 80 ms for rendering, and at most 40 MB of memory for Phase 4.
- **Screen readers.** Replacing the document object model (DOM) under the virtual cursor of NVDA (a free screen reader) or Narrator moves the cursor.
- **Two reviewed candidates.** A lean design (one block, one editor) and a rich design (one editor per flow surface or container, groups, and paragraph IDs). The reviews preferred the lean design and asked for fixes to long outlines, undo cost, and screen reader stability.

## Decision

We will build the editor as ARCHITECTURE.md sections 7 to 10 describe:

1. **One block, one editor.** Each `text` block is its own Tiptap 3.31.4 editor, each `table` block a small table editor, and each `image` block a plain element. Flow and freeform pages use the same blocks. No paragraph IDs, no groups.
2. **Static DOM first, then mounting in place.** Every block renders static DOM from the same schema at open, viewport first. An editor mounts on the same root element with ProseMirror's `mount` form, on focus, pointer down, a target, or in idle time for blocks in view. At most 16 unfocused editors stay mounted. With a screen reader running, nothing mounts or demotes in idle time, and every block renders in idle time after open.
3. **Markdown.** markdown-it 15.0.2 parses the full CommonMark syntax with small plugins for the dialect. Our own serializer writes the canonical form, with a cache for every node (textblocks, list items, and containers), so a keystroke in a long outline re-serializes one paragraph.
4. **Sync.** Text goes to the core as `spliceText` (a small Phase 3 addition, P3-10) with the exact splice, or as `setText` with the whole Markdown when that addition isn't available, at Phase 3's 150 ms and 300 ms timings. Automatic changes are their own undo step.
5. **Undo.** The core owns undo. Frames from undo, redo, and other windows re-parse only the touched range of a text block, and the result is proven by re-serializing it; a whole-block parse (in a worker above 64 KB) is the fallback.
6. **Containment.** `contain: paint` goes on every textblock and list item, with list markers drawn inside the item's box.

This holds only if week-one spike S3 meets the typing, mount, flush, and undo gates on the reference laptop, with the ordered fallbacks in ARCHITECTURE.md section 28.

## Options considered

| Option | For | Against |
|---|---|---|
| One block, one editor (chosen) | Matches ADR 0005 and ADR 0008. One-to-one mapping to `page.json`, so each edit is a precise Phase 3 edit. Few moving parts | Text selection and drag stop at block edges. Tables and images typed into a floating text box are separate blocks (ADR 0026 handles layout) |
| One editor per flow surface or container, with wrapper nodes, groups, and paragraph IDs | One caret across text, tables, and images; OneNote-like containers | Needs `group`, `parent`, and positional paragraph IDs in version 1, against ADR 0008; wrapper normalization, promotion, and a block-list diff are each a source of bugs; IDs are lost when `setText` is the fallback |
| One ProseMirror document for the whole page | One selection and undo history | ADR 0005 rejected it: free positioning fights a single flow, and every transaction covers the page |
| `@tiptap/markdown` or `prosemirror-markdown` | Less code | Not canonical; marked isn't full CommonMark |
| `setText` only | No Phase 3 change | About 60 KB of JSON and IPC every 300 ms in a 20-page note, and no check against a stale copy |
| Re-parse the whole block on every frame | Simple | About 60 KB parsed on the main thread per undo, which risks the 50 ms budget on the reference laptop |
| Cache Markdown for top-level nodes only | Simple | A 20-page outline or callout is one top-level node, so every flush re-serializes it |
| Keep every editor mounted (ADR 0005's untested default) | No mounting code | Breaks Phase 3's rule; 50 editors fill the page-open budget |

## Consequences

- Easier: the mapping to Phase 3 is direct, and every edit and undo step names one block. Later block types register a renderer and a mapping. The static DOM serves page open, screen readers, and spell check before any editor exists.
- Harder: crossing between blocks is app code (arrow keys between flowing blocks, Backspace merges, and multi-block selection with an Undo toast). Dragging text between editors copies instead of moving. The serializer, its cache, and the range re-parse need property tests before text leaves its flag: round trips, cache equivalence, and range equals full parse.
- Follow-up work: the Phase 3 changes P3-5 (full block JSON in frames), P3-10 (`spliceText`), and P3-12 (adjacent lists); the typing benchmark in `tests/perf/typing`; `docs/perf/phase-4.md`.
- Revisit if the reference laptop misses the gate after every fallback; long blocks then split at paragraph boundaries, as SPEC 6.3 allows. Also revisit if mounting in place fails in a Tiptap update, or if Phase 8's anchors need paragraph identity that the `{` syntax can't give. The Phase 4 owner checks the benchmark every night.
