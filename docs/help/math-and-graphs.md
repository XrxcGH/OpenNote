# Math and graphs

Write equations, work out sums in your text, and plot functions on a page.

![An inline equation in a sentence, and a graph block with its function](../screens/math-graph-light.png)

## Equations

- Type `$x^2$` in text, or open Insert, then Equation. Type the equation as LaTeX and press Enter. It renders, and you can edit it.
- When you open an equation, it opens in a visual editor with its own math keyboard, which also works with touch and pen. Choose Edit as LaTeX to type the source instead. OpenNote remembers your choice. A screen reader speaks the equation when you finish. Pages keep the same LaTeX either way.
- Select an equation and choose Solve or Simplify. Solve needs an equation with exactly one letter in it.
- If an action cannot read your LaTeX, it says so and leaves the equation alone.
- To turn handwriting into an equation, lasso the writing, and choose Convert handwriting to math. The equation is added below the page and the ink stays. Or open an equation, choose Write with pen, write it, and choose Use writing. It needs handwriting recognition turned on, and Windows must have a handwriting recognizer for your language.

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

## The grapher

Open Insert, then Graph. Type a function, such as `y = sin(x)`. Pan and zoom the graph with the mouse, the pen, or your fingers.

## Diagrams and mind maps

- Type Mermaid text and get a diagram.
- Give a diagram a description in its Description of the diagram box. Screen readers read it, and it is kept when you print or export. Printed, PDF, and web page exports draw the diagram as a sharp vector picture.
- Save a mind map as an SVG, PNG, or PDF picture from its toolbar. With a pen, tap a branch to write in it, drag from it into empty space to add a branch, or drag it onto another branch to move it.
- Turn an outline into a mind map, and turn the map back into an outline.

## Tool windows

Press Ctrl+K and choose Calculator or Unit converter. Each opens in its own small window. See [study tools](study-tools.md).

## In a PDF

Export a page as PDF and its equations, graphs, and charts print as sharp shapes and text, not as pictures. A smart table's charts follow the table.

Math, the grapher, and diagrams are built and have been checked by automated tests only. Turning handwritten math into an equation is built, but it reads fractions, roots, exponents, integrals, and matrices from how the strokes are laid out, so write each part clearly apart from the next.
