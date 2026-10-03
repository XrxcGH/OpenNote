# ADR 0026: Layout rules for text boxes and reading order

- Status: Proposed, pending the Phase 3 owner's agreement to P3-1 and P3-11
- Date: 2026-10-02

## Context

SPEC 6.2 defines floating and flowing blocks, draws floating blocks in order with later ones on top, and fixes reading order as flowing blocks, then floating blocks by position. The design reviews found gaps that every reader of a page must resolve the same way:

- A floating text block without `w` has no defined width.
- Tables and images inserted while typing in a floating text box become separate floating blocks (format version 1 has no groups), which the growing text box would cover.
- Phase 5's handwriting layer is an `ink` block that must stay on top of text added later.
- FEATURES.md's "Reading order" feature needs a chosen order that screen readers, read aloud, the compact view, `page.md`, and PDF export all follow, and the page's document object model (DOM) order must never drop keyboard focus when that order changes.
- Web Content Accessibility Guidelines (WCAG) 1.4.10 needs flow pages to reflow at 320 CSS px.

## Decision

We will apply these rules (ARCHITECTURE.md sections 6 and 20):

1. **Auto width.** A floating `text` block without `w` is as wide as its content, from 120 to 600 units. The first width change stores `w`. SPEC 6.2 says so (P3-11).
2. **Keep-below.** An edit in this view can change a floating text block's height. Then floating, non-ink, unlocked blocks whose top lies from 0 to 24 units below its old bottom edge, and that overlap it horizontally, move by the same amount. They move breadth first, in the same transaction as the edit. Opening a page, font loads, and style changes never move anything. The results are ordinary frames, so every reader agrees.
3. **Under the ink layer.** New floating blocks are inserted before the page's `layer` ink block, and z-order commands stay among non-ink blocks.
4. **A stored reading order.** `view.readingOrder` lists block IDs; listed blocks come in that order, and each unlisted block follows its predecessor in the default order (P3-1). It is written with `setPage` and a `view` merge patch.
5. **DOM order equals reading order,** applied by an imperative block layer that never moves the wrapper holding focus, and only after a move is committed.
6. **The flow column clamps to the visible width,** and pages with floating blocks open in the compact Reading view under 600 CSS px.

## Options considered

| Option | For | Against |
|---|---|---|
| Keep-below stored as frames (chosen) | Every reader sees the same layout; one undo reverts text and moves; no format change | A block placed just below a text box follows it, which may surprise; limited to a 24-unit band and unlocked blocks |
| Groups with `parent` (a text box that contains tables and images) | OneNote's model | Needs the reserved `group` type and `parent` field in version 1, against ADR 0008; promotion and demotion code |
| A device-local list of stacked blocks | No format change | Other devices and readers don't know about it, so layouts differ |
| Allow overlap | No code | Text covers tables and images as it grows |
| `readingOrder` as a new page field | Explicit | Needs a new `PageFields` member and `SetPage` change; `view` already travels with `setPage` |
| `aria-flowto` or `aria-owns` to reorder for screen readers | No DOM moves | Poor support in Narrator and NVDA (a free screen reader); Tab order and read aloud wouldn't follow |
| React reorders wrappers by key | Little code | Chromium drops focus when a focused element is moved |

## Consequences

- Easier: tables and images typed into a text box stay readable on every device; Phase 5's ink stays on top; one reading order serves screen readers, Tab, read aloud, the compact view, `page.md`, and Phase 6's tagged PDFs.
- Harder: the core and the Python reference reader need the reading order function with shared fixtures; the keep-below rule needs tests that opening a page never moves anything.
- Follow-up work: P3-1 and P3-11 in the spec before version 1 freezes; the `reading-order` fixtures; the end-to-end (E2E) specs for keep-below and focus during reordering.
- Revisit if people find keep-below surprising (then a setting, or groups in a later format version with its own ADR), or if Phase 6's paginated view needs different rules for blocks near page breaks. The Phase 4 and Phase 6 owners check it.
