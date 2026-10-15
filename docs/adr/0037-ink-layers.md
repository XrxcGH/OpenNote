# ADR 0037: Ink layers

- Status: Proposed
- Date: 2026-10-14

## Context

People who draw, annotate a diagram, or mark up an imported page want to keep some ink apart: a sketch they can hide, a tracing they cannot move by accident, an answer key they leave out of the printout (FEATURES.md A3-2). A page keeps all its strokes in one ink block (format spec sections 8 and 9), and a stroke record has no spare field for a layer.

ADR 0036 solved the same problem for groups by keeping the membership in the page's view, so no record changes before format version 1 freezes. Layers have the same shape.

## Decision

We will keep layers in the page's view, under an `inkLayers` key:

```json
"view": {
  "inkLayers": {
    "order": ["01J9Z6...", "01J9Z7..."],
    "layers": { "01J9Z6...": { "name": "Tracing", "hidden": false, "locked": true, "imported": false } },
    "assign": { "01J9Z4...": "01J9Z6..." }
  }
}
```

- `order` lists the layers from the bottom up. The layer called `base` always exists and is the first layer: a stroke that is not in `assign` is on it, so pages made before layers are unchanged and a page with one layer stores nothing.
- `layers` holds each layer's name and its hidden and locked switches. `imported` marks the locked bottom layer made for imported PDF pages and slides.
- `assign` maps a stroke to its layer, only for strokes that are not on `base`. A piece cut from a stroke by the partial eraser stays on the layer of the stroke it came from, through its `origin`.
- New ink goes to the active layer, a choice that belongs to the open window and is not saved. The placement is an edit in the batch that adds the strokes, so drawing, and every change to a layer, is one undo step.
- A hidden layer is not drawn, printed, or exported. A locked layer is drawn, but the pen, erasers, and lasso do not reach it. Export can also take one layer alone.

## Options considered

| Option | For | Against |
|---|---|---|
| Layers and `assign` in the page view (chosen) | No change to stroke records. Older readers keep the key as an unknown view value (section 2.2). One `setPage` patch carries a change, in the batch with the strokes | `assign` grows with the strokes that are off the base layer. Membership lives apart from the strokes, so a deleted stroke leaves a stale ID until the layer is next edited |
| A layer field in the stroke record | Membership travels with the stroke | A new record layout in two readers before the freeze, and moving a large drawing rewrites a record per stroke |
| One ink block per layer | Matches how blocks already stack | Strokes would move between blocks, and every reader of ink would need to learn many blocks |
| Doing nothing | No work | Ink cannot be kept apart, hidden, or left out of a printout |

## Consequences

- Readers ignore IDs that no longer exist. Deleting a layer puts its strokes back on `base`.
- The Layers dialog (command list and Draw tab), the lasso's Move to layer, and per-layer export are the entry points. A page with a single layer pays nothing.
- Imported PDF pages and slides call `importedLayerPatch` to get their locked bottom layer; that call is the only link the importers need.
- If `assign` becomes too large in practice, or layers need to nest, revisit this in favor of the record field before version 1 freezes.
