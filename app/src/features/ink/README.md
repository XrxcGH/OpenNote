# Ink

This feature is the pen, the erasers, the lasso, and the ink on a page. This folder holds the core of it: pure TypeScript with no React, no browser calls, and no platform code. A worker, the page view, and a Node test all load it directly. The page view, the Draw tab, and the engine worker come after Phase 4's page view lands, and they call what is here.

Import from `index.ts`. Other features never reach into these folders.

## Map

| Folder                                     | What it does                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [geometry](geometry/README.md)             | Matrices, boxes, the stroke index, hit tests, the erasers' math, the lasso, outlines, pressure curves, the steady pen, shapes              |
| [model](model/README.md)                   | Adapters between the note file's ink records and the geometry's strokes, plus the page's stroke table and the edits that recolor or resize |
| [pens](pens/README.md)                     | The brand pen and highlighter colors, the tool numbers, and width from pressure and tilt                                                   |
| [input](input/README.md)                   | Samples to strokes, the stroke builder, palm rejection, and pen buttons                                                                    |
| [input/gestures](input/gestures/README.md) | Scribble to erase, circle and tap, and two-finger and three-finger double taps                                                             |
| [edits](edits/README.md)                   | Erase sessions for a whole gesture, and the eraser and lasso filters                                                                       |
| [selection](selection/README.md)           | The lasso over blocks, and over ink and blocks together                                                                                    |
| [space](space/README.md)                   | What moves when space is inserted                                                                                                          |
| [zoombox](zoombox/README.md)               | The zoom writing box: strip and box coordinates, and moving the box along the line                                                         |
| [engine/tiles](engine/tiles/README.md)     | The tile cache planner: which tiles to draw, invalidate, and give back                                                                     |

The 10,000-stroke benchmark and its numbers are in [docs/perf/phase-5-core.md](../../../../docs/perf/phase-5-core.md).

## How the pieces fit

1. A pointer event becomes a `RawSample`. The palm filter decides whether a touch may draw, and the pen buttons decide what a pen does at contact.
2. The stroke builder turns samples into a stroke, with the pen's pressure curve and steady pen applied. At pen-up the model encodes it as a record for the core.
3. The core confirms the change. The engine decodes records with the model, keeps them in the geometry's stroke index, and plans tiles from what changed.
4. Erasers, the lasso, insert space, and the gesture detectors read the index and return what to remove, select, or move. The page view commits that as one transaction.

## What the interface needs

Each folder's README ends with what the page view must do for that part. The shared rules are these.

- Make stroke IDs with the shared ID generator, and pass the same generator to the builder and the erase sessions.
- Run the engine's work in a worker, and keep the page view's handler to a few steps for each pointer move.
- Convert client coordinates to page units with the camera cached at pen contact.
- Choose colors with `resolveColor` and the page's color scheme, so the dark theme draws each pen with its dark value.
- Show a toast with Undo after each gesture, and list each gesture in the shortcut list so it can be turned off.
