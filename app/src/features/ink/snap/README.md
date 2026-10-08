# Snap tools

The ruler, the protractor, and snap to grid. This is pure geometry on page units, so a Node test drives it.

## What it does

- `nearRulerEdge` and `onRulerEdge` say whether a stroke begins at a ruler's long edge, and put its points on that edge, kept within the ruler's length.
- `atProtractorCenter` and `snapToProtractor` hold a line that begins at the protractor's center to whole steps of 15 degrees from its zero line. `protractorAngle` reads the angle for the readout.
- `snapToGrid` puts a point on the nearest grid crossing, and `gridSize` turns millimeters into page units.
- `holdFor` decides what a stroke is held to from its first point, with the ruler first, then the protractor, then the grid. `applyHold` moves each later point to where that hold puts it.

## What the interface needs

- Draw the ruler, the protractor, and the grid in the page's chrome layer, and let a finger or the pen move and turn them. Keep a keyboard way to do the same.
- Ask `holdFor` once, at the first sample of a pen or touch stroke, and `applyHold` for every sample, so the live outline and the stored stroke agree.

## Snapping to the paper

`paper.ts` snaps lines, arrows, shapes, library shapes, moves, and keyboard nudges to the lines of ruled, grid, and dot paper. The lines come from `core/paperLattice.ts`, which the paper renderer also draws from, so a snapped point lies on a drawn line on every sheet and at every zoom. `paperSnapFor` is null for plain paper, when the setting is off, or while Alt is held. The ink view (`view/paperSnap.ts`) follows the page's lattice and shows a ring where a point snapped. Freehand ink never snaps.
