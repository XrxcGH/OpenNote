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

## Beams

- Open Insert, then Beam solver, or type `/beam` on a new line. The beam starts on a pin and a roller with a point load and a uniform load.
- Add pin, roller, and fixed supports, point loads, distributed loads, and moments from the toolbar. Drag them along the beam, or use the arrow keys. They snap to even steps of the length.
- A positive load points down. A positive moment turns counterclockwise. A distributed load can change linearly from its start to its end, which gives a triangular or trapezoidal load.
- Beside the beam are the reactions, the largest shear and bending moment and where they are, and the places where the shear is zero. Under it are the shear and bending moment diagrams, drawn with sagging moment above the line.
- A beam with more supports than statics needs, such as a propped cantilever or a continuous beam, is solved too, assuming the same EI along its length. A beam its supports cannot hold says so.

## Trusses

- Open Insert, then Truss solver, or type `/truss`. The truss starts as a small Warren truss with one load.
- With Add and move joints on, click an empty grid point to add a joint, and drag a joint to move it. With Draw members on, drag from one joint to another to join them. You can also select a joint and pick the other end under Add member to.
- Give a joint a pin or a roller, and a load, in the fields under the drawing. A roller's angle is the direction it pushes.
- Member forces show on the members and in the table beside them, with T for tension and C for compression. Blue members are in tension and red ones in compression. Zero-force members say so.
- OpenNote counts members, reactions, and joints. It says when the truss can move, and solves a truss with redundant members assuming the same AE for every member.

## Circuits

- Open Insert, then Circuit, or type `/circuit`. The circuit starts as a 12 V battery across two resistors in series, already solved.
- Add resistors, voltage sources, current sources, grounds, and wires from the toolbar. With Place and move parts on, drag a part to move it on the grid. With Draw wires on, drag from one grid point to another to add a wire.
- Terminals on the same grid point are joined, and so is any grid point along a wire, so a ground can sit anywhere on the bottom wire.
- Select a part to change its label and value. Type values with a prefix, such as 4.7k, 220 Ω, or 2 mA. Press R to turn a part, or choose Turn. A voltage source's + end is its long plate; a current source pushes current the way its arrow points.
- Nodal analysis runs as you work. Each node's voltage shows in the drawing and in the table beside it, with every part's current, which way it flows, and the power it delivers or takes.
- Without a ground, the circuit asks for one. A circuit with two sources fighting in parallel, or a current source with nowhere to go, says it cannot be solved.
- The Draw tab's Shapes menu has a Circuit symbols group: resistor, battery, voltage and current sources, ground, capacitor, inductor, and switch, drawn as ink you can move, turn, and resize.
