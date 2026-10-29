# Anchors

Ink that stays with its text (spec 8.1). The rules are pure, so a Node test drives them.

## What it does

- `quoteAt` takes the words around a place in a block's displayed text, counted in code points.
- `findAnchor` finds that place again after the text changed. The stored place wins when its words still match. Otherwise the nearest place where the quote reads the same wins, and a shorter start of the quote is tried before the place is given up as lost.
- `offsetFrom` and `followDelta` hold how far the ink sits from its place, and how far the ink must move when the place moved.
- `readAnchor` reads `data.anchor` of an anchored ink block.

## What the interface needs

- Make one anchored ink block for each place, and put the strokes in it with `moveStrokesToBlock`.
- Find the place on the screen from the text block's displayed text. Move the ink in the picture when the place moved, and do not save that as a step, so undoing a text edit never has to undo an ink move as well.
