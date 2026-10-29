# Math and graphs

Write equations, work out sums in your text, and plot functions on a page.

![An inline equation in a sentence, and a graph block with its function](../screens/math-graph-light.png)

## Equations

- Type `$x^2$` in text, or open Insert, then Equation. Type the equation as LaTeX and press Enter. It renders, and you can edit it.
- When you open an equation, it opens in a visual editor with its own math keyboard, which also works with touch and pen. Choose Edit as LaTeX to type the source instead. OpenNote remembers your choice. A screen reader speaks the equation when you finish. Pages keep the same LaTeX either way.
- Select an equation and choose Solve or Simplify. Solve needs an equation with exactly one letter in it, or a system of linear equations with one equation for each letter. Put each equation on its own row with `\\`, or in a `cases` block. Solve also finds the determinant and inverse of a matrix written with `pmatrix` or `bmatrix`.
- Choose Steps to see how a derivative or an integral is worked out, one rule at a time. Write `\int_0^3 x^2 \, dx` for an integral. Any other expression shows the steps of its derivative. An integral that is not in the table of rules gets its value only, and only when it has limits.
- An equation shows its answer beside it as you write, such as x = 4 after 2x + 3 = 11.
- Select an equation and choose Graph, or press Alt+Shift+G, to see its graph beside it. y = f(x) draws in 2D, and an expression in x and y draws in 3D. Choose Insert graph to add it below as a graph you can edit, or Insert as picture.
- If an action cannot read your LaTeX, it says so and leaves the equation alone.
- To turn handwriting into an equation, lasso the writing, and choose Convert handwriting to math. The equation is added below the page and the ink stays. Or open an equation, choose Write with pen, write it, and choose Use writing. It needs handwriting recognition turned on, and Windows must have a handwriting recognizer for your language.

## Check my work

Check my work looks at your own working, one line at a time, and marks each step beside the line: a check when it follows from the line before, an exclamation mark when it needs a look, and a question mark when it could not be checked. It runs on this device, and nothing is sent anywhere.

- Select the lines you want checked and choose Check my work from the command palette (Ctrl+K), the slash menu, or the text menu. With nothing selected, it checks every line on the page that looks like working.
- For handwriting, lasso the rows of working and choose Check my work on the lasso toolbar. Each row is read as math. If some of it was hard to read, you see the lines as read first, and can fix any of them before they are checked. The ink is never changed.
- Write one step per line. A line can start with "=" to carry on from the line above, as in `(x + 1)^2` then `= x^2 + 2x + 1`. Use `d/dx(...)`, `f'(x)` after `f(x) = ...`, `∫ ... dx` (or `int`), `∫_0^1 ... dx`, `[F]_a^b`, `lim_(x->0)`, and `Σ_(n=1)^(10)`. Write `let u = x^2` before a substitution. Put a system on one line with commas, such as `x + y = 5, x - y = 1`. Matrices are `[[1, 2], [3, 4]]` and vectors `[1, 2, 3]`, with `·` for the dot product and `×` for the cross product. Units such as `km/h` and `m/s` are converted.
- The first step that goes wrong says why in plain words, such as "The sign of 3 should change when it moves across the equals sign", and suggests a corrected line. Steps after it that follow correctly say "This follows from your previous line".
- When a step cannot be decided, it says "I could not check this step" rather than calling it wrong. A step that is true only for some values, or that drops a solution, says so.
- Steps it could not prove symbolically are checked at sample points, and the card says so.
- Choose Check again after you change the working, or Dismiss to take the marks away. Escape on the card dismisses it too. Turn the feature off in Settings, then Editing.

## Insert LaTeX

Press Ctrl+Alt+X, or open Insert and choose Insert LaTeX. Type LaTeX and the equation is drawn as you type. Choose In the line or On its own line, then Insert equation. The snippet tabs (Basics, Calculus, Matrices, Greek, Symbols) put a fraction, a sum, a matrix, or a Greek letter into the field, with the first blank selected so you can type over it.

Paste LaTeX and OpenNote makes equations of it. `$x^2$` and `\(x^2\)` become equations in the line, and `$$x^2$$`, `\[x^2\]`, and `\begin{align}` blocks become equations on their own line. A paste that is only LaTeX, such as `\frac{a}{b}`, becomes one equation. Prices such as `$5 and $6` stay text.

## Scientific constants

Press Ctrl+Alt+N, or choose Insert a scientific constant. Search by name or symbol, then choose Symbol, Value, or Both to add it at the caret as text or, with Equation chosen, as an equation. Values are the 2022 CODATA recommended values. The digits in brackets are the standard uncertainty. In the calculator and on lines of math you can use the short name each row shows, for example `kB * 300 =`.

## Significant figures

Press Ctrl+Alt+F. Type a measured number to see how many significant figures it has, round it to a count, and show it in scientific or engineering notation. Type a sum such as `2.50 * 3.1` and the answer is rounded by the rules, with the rule named. Turn on the Significant figures switch in the calculator to round its answers the same way. Whole numbers written alone count as measured, so write `2pi` when the 2 is a count.

## Quick math

Type a sum followed by an equals sign, such as `12*7=`. The answer appears. Lines on a page can also hold variables and units, and later lines can use earlier ones.

On a line of math, choose Graph this to plot it.

Type an equation with one unknown letter, such as `2x + 3 = 11`, and its solution appears in gray. Press Tab to add it as a line of its own, which later lines can use. The page's variables and units count, so after `d = 100 m` and `t = 10 s`, the line `d = v t` gives `v = 10 m/s`. Turn the answers or the solutions off in Settings, then Editing, then Live math.

## The grapher

Open Insert, then Graph. Type a function, such as `y = sin(x)`. Pan and zoom the graph with the mouse, the pen, or your fingers.

Open Insert, then 3D function plot, or type `/3d function plot`, for a surface such as `z = sin(x) cos(y)`. A curve such as `(cos(t), sin(t), t/5)` and a surface in u and v such as `(cos(u) sin(v), sin(u) sin(v), cos(v))` work too. Drag the graph or press the arrow keys to turn it. Plus and minus zoom, and 0 resets the view. Add `@range t 0 12` to set how far t runs.

To graph handwriting, lasso it and choose Graph in the bar above the selection.

A graph also takes parametric and polar curves and vector and slope fields, and a 3D graph plots surfaces. See [3D graphs, vectors, and motion](3d-graphs-vectors-and-motion.md).

## Diagrams and mind maps

- Type Mermaid text and get a diagram.
- Give a diagram a description in its Description of the diagram box. Screen readers read it, and it is kept when you print or export. Printed, PDF, and web page exports draw the diagram as a sharp vector picture.
- Save a mind map as an SVG, PNG, or PDF picture from its toolbar. With a pen, tap a branch to write in it, drag from it into empty space to add a branch, or drag it onto another branch to move it.
- Turn an outline into a mind map, and turn the map back into an outline.

## Tool windows

Press Ctrl+K and choose Calculator or Unit converter. Each opens in its own small window. See [study tools](study-tools.md).

The calculator has seven tabs, and the arrow keys move between them:

- Basic is a four-function keypad.
- Scientific takes typed expressions. Choose the notation (normal, scientific, or engineering) and the significant figures, or match the fewest figures you typed.
- Graphing 2D and Graphing 3D are the grapher.
- Programmer works in hexadecimal, decimal, octal, or binary, with AND, OR, XOR, NOT, and shifts, in 8 to 64 bits.
- Statistics gives the mean, median, mode, quartiles, and standard deviations of a list. Put x and y on each line to get a line of best fit.
- Matrix adds, multiplies, inverts, and row-reduces matrices, and solves A x = B.

Each tab keeps its history on this device, with Copy and Insert. Open a tab straight from Ctrl+K, such as Programmer calculator.

## In a PDF

Export a page as PDF and its equations, graphs, and charts print as sharp shapes and text, not as pictures. A smart table's charts follow the table.

Math, the grapher, 3D graphs, the calculator's modes, live solving, and diagrams are built and have been checked by automated tests only. Turning handwritten math into an equation is built, but it reads fractions, roots, exponents, integrals, and matrices from how the strokes are laid out, so write each part clearly apart from the next.
