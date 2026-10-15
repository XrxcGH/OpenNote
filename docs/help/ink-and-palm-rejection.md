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
- On typed text, the pen edits: strike through words to delete them, draw a short line between words to add a space or a long one to split the paragraph, and circle words to select them. With on-device handwriting recognition on, write in a gap between words, or where the cursor is, and a moment after you stop the words are typed in there. Each edit shows Undo, and each can be turned off: press Ctrl+K and type "pen edit".
- Draw a grid of at least three lines each way, and OpenNote offers Convert to table. You can also lasso a grid you drew earlier and choose Convert to table on the bar, or press Ctrl+K and type it. With on-device handwriting recognition on, what you wrote in each cell becomes the cell's text. One Ctrl+Z puts the lines and the writing back.

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

Arrows, signs, and formulas come out as you meant them: `->` becomes →, `>=` becomes ≥, and H2O becomes H₂O. When OpenNote isn't sure of a word, it draws a thin amber line under it. Tap the line, or Tab to it and press Enter, to see other readings. Choose one to put it in the text, or choose Keep to remove the line. Ctrl+Z undoes the change.

Ink and palm rejection are built. They have been checked by automated tests only, and the real-pen test in [palm-rejection.md](../testing/palm-rejection.md) is waiting for a person with a pen.

## Group things together

Select two or more things with the lasso (ink, text boxes, pictures) and choose Group, or press Ctrl+G. A group moves, resizes and deletes as one, and one Undo takes each of those back. Ungroup (Ctrl+Shift+G) lets them go again; reading order is not changed.

## More pens

On the Draw tab, pick a pen and choose **Pen type** to change it to a fountain pen, brush, calligraphy pen, dashed pen, or dotted pen. The fountain pen and brush draw wider when you press harder or move slowly, and thinner when you move fast. The calligraphy pen has a flat nib held at a fixed angle, so strokes across the nib are broad and strokes along it are fine. The dashed and dotted pens draw a broken line. Each keeps its own sizes and colors, and screen readers hear its name.

**Pen sets** saves the pens on your palette under a name, so you can switch between a writing set and a drawing set. Choose a set to bring its pens back, or choose Delete to remove it. You can keep 12 sets.

## Links on handwriting

Lasso some writing and choose **Make link** (on the bar above the selection, or in the command list). The link can go to a page, to a heading on a page, to a web address, or to the recording at the moment you wrote it. The writing keeps its link when you move or resize it. Choose **Remove link** to take it off.

**Links on this page** in the command list opens a list of every link. For each one you can **Select** its writing, which draws the selection outline around it, or **Open** it. The list works with the keyboard and screen readers. A link to a page counts in that page's backlinks.

## Layers

Choose **Layers** in the command list to keep ink apart. Each layer has a name, and you can hide it, lock it, move it up or down, make it the one new ink goes to, export it on its own, or delete it (its ink goes to the first layer). A hidden layer isn't shown, printed or exported. A locked layer is shown, but the pen, the erasers and the lasso pass over it, so you can trace over a drawing without moving it. To move writing to another layer, lasso it and choose **Move to layer**. A layer made for an imported PDF or slide is locked and stays at the bottom.

## Writing in text fields with the pen

In Settings, Pen and touch, turn on **Write in text fields with the pen**. Then touching the search box, a rename field, or a table cell with the pen opens the handwriting panel of Windows, and what you write there is typed into the field. The panel is Windows' own. If it doesn't appear, check that the handwriting panel is turned on in Windows settings under Bluetooth & devices, Pen & Windows Ink. Fingers and the mouse work as before.
