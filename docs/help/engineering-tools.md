# Engineering tools

Draw statics and circuit problems as parts that snap together, and see the answers worked out beside the drawing.
These tools are new in Beta, so check the answers against your own work while you learn them.

## Free-body diagrams

- Open Insert, then Free-body diagram, or type `/free body` on a new line. The diagram starts as a beam on a pin and a roller with one force, already solved.
- Add a body, a force, a moment, a pin, a roller, or a fixed support from the diagram's toolbar. Drag a part to move it. It snaps to the grid, and to the corners, edge midpoints, and center of a body and to the other parts, so a force lands exactly on the point it acts at. Drag the head of a force to turn it in 15° steps.
- Moving a body moves everything attached to it.
- Without a mouse, press Tab to reach a part, the arrow keys to move it (hold Shift for small steps), R and Shift+R to turn it, and Delete to remove it. The fields under the drawing change the selected part's label, size, magnitude, angle, and position.
- Beside the drawing, ΣFx, ΣFy, and ΣM about the point O update as you work, with the resultant of the applied loads. Drag O, or choose Sum moments about the selected part, to take moments somewhere else.
- When the supports give exactly three unknowns, OpenNote solves the reactions that hold the body in equilibrium and draws them as dashed arrows. With more unknowns it says the body is statically indeterminate; with fewer, or with supports that all push the same way, it says the body can move.
- A positive moment turns counterclockwise. A roller's angle is the direction it pushes on the body: 90° is straight up.
- The Draw tab's Shapes menu has a Mechanics group: pin, roller, and fixed supports, force and moment arrows, a distributed load, and a spring, drawn as ordinary ink you can move and resize.
