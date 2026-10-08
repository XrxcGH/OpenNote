# Zoom writing box

This folder holds the coordinates and movement rules of the zoom writing box (design 12.3). People who write large, have a tremor, or use a small tablet write in a magnified strip at the bottom of the page pane, and the ink lands small in a box on the page. It has no React, no browser calls, and no platform code.

## What it does

- `mapping.ts` links the strip to the box. The strip is 30 percent of the pane's height, between 160 and 320 pixels. Magnification 2, 3 (the default), or 4 sets the box's size: the strip's size divided by the magnification and by the page zoom, in page units. `stripToPage` maps a strip point to a page point, and `pageToStrip` is its inverse.
- `advance.ts` moves the box along the line. After the pen lifts, `shouldAdvance` says whether the last stroke reached the right quarter of the box. If it did, the box moves right by half its width after 300 ms, so a dot or a crossbar can come first. At the right margin, `advance` wraps to the next line at the left margin. The distance between lines is the paper's ruling, or 1.25 times the box's height.
- `moveBox` handles the arrow keys and Home and End. Arrows move the box a quarter of its width or one line. Home goes to the margin, and End goes to the end of the line's ink.
- `lineNumber` gives the line for the announcement "Zoom writing box on, line 3." `revealDelta` gives the least scroll that brings the box into view.

## Public API

| Name                                                                               | Use                                                 |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| `stripHeight(paneHeight)`, `boxAt(origin, strip, magnification, zoom)`             | Docking the strip and placing the box               |
| `stripToPage(point, strip, box, magnification, zoom)`                              | The strip's `toPage` mapping for its router surface |
| `pageToStrip(...)`, `stripWidth(pageWidth, magnification, zoom)`                   | Drawing the ink and the pen width in the strip      |
| `shouldAdvance(box, strokeBounds)`, `advance(box, margins, ruling?)`               | After each stroke, and the Next button              |
| `newLine(box, margins, ruling?)`, `moveBox(box, key, margins, ruling?, inkRight?)` | New line and the keyboard                           |
| `lineNumber(box, firstLineTop, ruling?)`, `revealDelta(box, view)`                 | The announcement and scrolling                      |

## What the interface needs

- The strip is a second router surface with its own live canvas, the same tools, the same palm filter, and the same commit path as the page. It counts as page for palm rejection.
- Draw the ink in the box's region as a sprite at the strip's scale, refresh it after each stroke, and draw a baseline guide. Do not draw typed text in the strip.
- Mark the box on the page with a 2 pixel outline in the accent color. Start the 300 ms timer after the pen lifts, and cancel it when the pen touches again.
- Take the margins from the paper's margins, the text column, or the view's edge on an infinite page. Take the ruling from the page background when it has one.
- Left-handed mode mirrors the strip's controls. It does not change these functions.
- Next, New line, Undo, and Close buttons do by hand what the timer does.
