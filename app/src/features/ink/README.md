# Ink

This feature is the pen, the erasers, the lasso, and the ink on a page. Every folder but `view/` holds the core of it: pure TypeScript with no React, no browser calls, and no platform code. A worker, the page view, and a Node test all load it directly. The `view/` folder puts the core on the page view.

Import the core from `index.ts`. `flags.ts` holds the ink flags and `loadInkView`, which start-up code may import. Other features never reach into these folders.

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
| [anchor](anchor/README.md)                 | Anchors that tie ink to the words it was drawn with, and the rules that find the words again after an edit                                 |
| [snap](snap/README.md)                     | The ruler, the protractor, and snap to grid                                                                                                |
| [space](space/README.md)                   | What moves when space is inserted                                                                                                          |
| [zoombox](zoombox/README.md)               | The zoom writing box: strip and box coordinates, and moving the box along the line                                                         |
| [engine/tiles](engine/tiles/README.md)     | The tile cache planner: which tiles to draw, invalidate, and give back                                                                     |
| `view`                                     | The pointer tools, the ink overlay and its tiles, the lasso frame, the Draw tab, and Settings, Pen and touch                               |

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

## How the view is wired

`features/page/registrations/ink.ts` loads the view when the first page shows and hands it the page view's seams. Those are the pointer router, the shown page's viewport, sync queue, open page, and block layer, and the page selection.

- `install.ts` registers three pointer tools: the pen and mouse tool (priority 80), the palm filter for touch (100), and the lasso frame's handles (95). It also registers the commands, the Draw tab, and the Pen and touch section of Settings.
- `surface.ts` is one page's ink. An overlay over the viewport holds the tile layer (`tiles.ts`) and a live canvas for the stroke in progress, the eraser, and the lasso. Its chrome layer holds the lasso frame.
- Every change shows at once and goes through the page's sync queue. New strokes ride in a batch's `strokes` as ink records, so the core saves them to the page's ink segments and they join the undo history. `OpenPage.ink` brings them back at open and after undo and redo.
- The palm filter loads in its own chunk (`palm.ts`), and the touch tool feeds it pen hover and contact.
- `more.ts` registers everything the later features add, each behind its own flag: the canvas lock, the hover circle, Insert space, the snap widgets, shape handles and libraries, replay, the zoom writing box, anchoring, the handwriting tools, and the pen edits of typed text. Those that need the page's text editor, the recognizer, the recordings, or the sheets of a paginated page reach them through optional members of the host (`text`, `handwriting`, `audio`, `sheets`).
- Choices that belong to one device (the hover circle, the canvas lock, the snap tools, and each pen's buttons, pressure curve, and steady pen) live in `prefs.ts`, in the browser storage of this device.
- Test builds expose `inkSeed` and `inkStats` hooks for the 10,000-stroke benchmark in [docs/perf/phase-5.md](../../../../docs/perf/phase-5.md).
