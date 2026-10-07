# Ink and palm rejection

Draw with a pen or a finger on any page. Open the Draw tab to pick a tool, a color, and a width.

![Ink on a page: a highlighter, three pens, and a pencil sketch](../screens/ink-pens-light.png)

## Pens and erasers

The Draw tab has pens, a highlighter, two erasers, the lasso, and shapes. In a wide window the pen slots sit in the bar. In a narrow one they sit under More.

- The stroke eraser removes a whole stroke. The partial eraser cuts a stroke where you rub.
- Turn the pen over to use its eraser end.
- The lasso selects strokes. Drag them to move them. Ctrl+Z and Ctrl+Y undo and redo.
- Filters let the eraser or lasso touch only highlighter, or only ink.

![The Draw tab with the tools, the pen slots, a color, and a width](../screens/tab-draw-light.png)

## Palm rejection

Rest your hand on the screen and write. While a pen is near the screen, a touch never draws. A palm does not scroll or select either.

OpenNote judges each touch from its size, how fast it grows, where on the hand it is, and how it moves. Touch ink is kept so OpenNote can take it back if the touch turns out to be a palm.

Open Settings, then Pen and touch, to change this.

| Setting | Choices |
|---|---|
| Writing hand | Detect, Right hand, or Left hand |
| Draw with a finger | Until a pen is used, Always, or Never |
| Pen buttons | What the side button and the eraser end do, set for each pen |
| Pressure and steady pen | A pressure curve from light to firm, and smoothing for a steadier line |

## Shapes and gestures

- Draw a rough shape and hold the pen still. It snaps to a clean circle, rectangle, triangle, star, or arrow. Keep holding to resize it before you lift.
- Scribble over words to erase them. Circle something, then tap, to select it.
- Double tap with two fingers to undo. Double tap with three to redo.
- Draw a grid and it becomes a table.

## Helpers

Press Ctrl+K and choose one of these by name.

| Name | What it does |
|---|---|
| Insert space | Drag down to push everything below further down. |
| Zoom writing box | Write large in a box. It lands small on the line. |
| Replay ink | Plays your strokes back, and plays a recording along with them. |
| Ruler, Protractor, and Snap to grid | Help you draw neat diagrams. |

## Export a selection

Lasso ink, text, or pictures, then choose Export selection or Copy as image on the bar above the selection, or in its right-click menu. Point at either button to see a dashed outline of the area you will get.

In the export dialog, Area chooses how the edges are cut:

- **Smart** fits the edges to what you selected, with a small margin.
- **Exact** keeps the shape you drew with the lasso.

OpenNote remembers your choice for next time. Copy as image uses it too. You can save the selection as a PDF, PNG, SVG, or Word file.

## Handwriting to text

Lasso your writing and choose Convert to text. The Writing pen converts as you write. Both use on-device intelligence, which you turn on in Settings. See [on-device intelligence](on-device-intelligence.md).

Ink and palm rejection are built. They have been checked by automated tests only, and the real-pen test in [palm-rejection.md](../testing/palm-rejection.md) is waiting for a person with a pen.
