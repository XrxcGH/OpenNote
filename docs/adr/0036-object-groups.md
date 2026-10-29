# ADR 0036: Object groups

- Status: Proposed
- Date: 2026-10-07

## Context

People want to keep a sketch, its label, and a picture together, so that one drag moves them all and one Delete removes them all (FEATURES.md A2-8 and A4-16). OneNote and Word call this grouping. A group mixes strokes, which live in binary ink segments (format spec sections 8 and 9), with text boxes and images, which are blocks in `page.json` (section 6).

The plan's first sketch put a `groupId` field on each block and on each stroke. A stroke record has no spare field, so a group ID there means a new record flag and a longer record, read by both the Rust core and the app's record code, before format version 1 freezes. Grouping must also be one undo step, and today a stroke edit and a block edit only share a step when they go in one `page_apply` batch.

## Decision

We will keep groups in the page's view, under a `groups` key, as a map from a group ID to the IDs of its blocks and strokes:

```json
"view": {
  "groups": {
    "01J9Z6...": { "blocks": ["01J9Z5..."], "strokes": ["01J9Z4...", "01J9Z4..."] }
  }
}
```

Each member's group ID is the key of the entry that lists it. A block or stroke is in at most one group, and groups do not nest. Grouping, ungrouping, and deleting a group change the map with a `setPage` view patch in the same batch as any block and stroke edits, so each is one undo step. Readers ignore IDs that no longer exist, and the next group edit drops them.

## Options considered

| Option | For | Against |
|---|---|---|
| A `groups` map in the page view (chosen) | No change to block or stroke records. Older readers keep it as an unknown view key (section 2.2). One `setPage` patch carries the change, in the batch with the moves | Membership lives apart from the members, so a deleted member leaves a stale ID until the next edit |
| A `groupId` on blocks and a new stroke record flag | Membership travels with each object | A new stroke record layout in two readers before the freeze; ungrouping a large drawing rewrites a property record per stroke |
| A `group` block type that holds its members (reserved in section 6.4) | Matches the reserved type name | Strokes would have to move into a container block; every view of the page needs to learn nesting |
| Doing nothing | No work | People can't keep a drawing and its label together |

## Consequences

- Selecting any member selects the whole group, and the lasso frame then moves, resizes, and deletes the group in one step. The reading order of the blocks does not change when they are grouped or ungrouped.
- Group (Ctrl+G) and Ungroup (Ctrl+Shift+G) are commands in the palette, the lasso bar, and the selection's menu.
- A partial erase replaces a stroke with new pieces that are not in the group. They stay on the page where they were, ungrouped.
- If the stale-ID cost shows up in practice, or groups need to nest, revisit this in favor of the record flag before version 1 freezes.
