# 3D graphs, vectors, and motion

Plot surfaces and curves in space, trace parametric and polar curves, work with vectors, lines, and planes, find volumes of solids of revolution, and fly a projectile. These tools are in the Beta channel.

## 3D graphs

Open Insert, then 3D graph, or type `/3d graph`. The block starts with a saddle, its tangent plane at one point, and its level curves.

- Each box above the plot holds one item. Type a surface such as `z = sin(x) cos(y)`, or a curve in space such as `(cos t, sin t, t/4)`.
- Add arrows, points, lines, and planes with lines like these: `vector <1, 2, 3>`, `point (1, -2, 4)`, `line (1, -2, 4) + t<1, 3, -1>`, and `plane 3x + 2y + 6z = 5`.
- Drag the plot to turn it, or use the arrow keys. The wheel and the plus and minus keys zoom. Zero resets the view.
- Surface, Contour, and Both switch between the 3D view, the level curves seen from above, and the 3D view with level curves on its floor.
- Turn on Tangent plane and choose a point. The plane is drawn there, and its equation and the partial derivatives appear below the plot.
- A letter other than x, y, and t gets a slider, as in the 2D grapher.
- Save as SVG and Save as PNG save the picture in the light theme's colors. Print and PDF export draw the graph as a vector picture.

The block's text is the whole graph, so undo, copy, and search work on it. Its first line is `@3d`. Lines that start with `@` hold the view, such as `@range -2 2 -2 2` for x and y and `@angle -55 25` for the turn and tilt.

## Parametric and polar curves

Open Insert, then Parametric or polar graph. Any graph block also takes these lines:

- A parametric curve in t: `(cos(3t), sin(2t))`. A line `@t 0 6.28` sets the range of t. It is 0 to 2π unless you set it.
- A polar curve: `r = 1 + cos θ`. You can type `theta` or `t` for θ.
- A vector field: `F = (-y, x)` draws arrows on a grid.
- A slope field: `dy/dx = x - y` draws short dashes.

A dot traces the first parametric or polar curve. Play runs it, and the t slider moves it by hand. When Windows is set to show fewer animations, Play is hidden. The slider still works.

## Vectors, lines, and planes

Open the command palette and choose Open vector tools, or use the button on the Insert tab.

- On the Vectors tab, type up to three vectors as numbers, such as `1, 3, 4`. You get the dot and cross products, the lengths, the angle, both projections, the unit vector, the area of the parallelogram, and the triple product. The vectors are plotted in 3D.
- On the Lines and planes tab, pick a point, a line, or a plane for each of two objects. You get the distance between them, where they meet, and the angle between them.
- Insert into page adds the results as text and the plot as a 3D graph block.

## Solids of revolution

Open Solids of revolution from the palette or the Insert tab. Type the outer and inner curves as functions of x, the limits, and the axis.

- A horizontal axis, y = k, uses the washer method, where a washer with no hole is a disk. A vertical axis, x = k, uses shells.
- The steps show the radii, the integral, and the volume. When the volume is a simple fraction of π, it is also shown exactly, such as 8π.
- The solid is drawn in a 3D view you can turn. Insert into page adds the steps and the solid.

## Projectile simulator

Open Projectile simulator from the palette or the Insert tab. Type the launch speed, angle, height, gravity, and drag.

- The time of flight, the range, the highest point, and the landing speed update as you type.
- Launch flies the ball along its path. With fewer animations turned on, the ball waits at the landing point, and the slider moves it.
- Drag is linear air resistance, with the constant k in 1/s. Set it to 0 for none.
- Insert into page adds the values as text and the path as a parametric graph, which you can trace.
