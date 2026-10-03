# Function grapher core

This folder is the grapher without a screen: it reads an expression, samples it, lays out the axes, and produces vector paths. It is pure TypeScript with no browser page, so it runs in tests, in a worker, and in the export pipeline. The screen is in `../graph/`: a graph lives in a fenced code block whose language is `graph`, so its text is the whole graph.

Reading and running expressions belong to the shared engine in `core/expr`. `dialect.ts` here sets the grapher's rules: letters split into names (so `pix` is pi times x), `sin 2x` and `sin^2(x)` work, `sin^-1(x)` is the inverse, and a leading `y =` or `f(x) =` is dropped.

## Public API

Everything is exported from `index.ts`.

| Name                                               | What it does                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `compileExpression(source, { parameters })`        | Reads and compiles text. Returns `evaluate(x, params)` or a problem with a place.        |
| `differentiateExpression(source, options, order)`  | The derivative with respect to x, compiled, and its text. Parameters count as constants. |
| `findParameters(source)`                           | The letters that need a value, so the screen can add a slider for each.                  |
| `sampleFunction`, `buildScene`, `sceneToSvg`       | Adaptive sampling, the scene of grid and curves, and a standalone SVG.                   |
| `defaultViewport`, `zoomAround`, `panByPixels`     | Viewport math for zoom and pan.                                                          |

## What the screens need

- **Problems under the input box.** A bad expression gives `message`, `position`, and `length`. Underline the characters from `position` for `length`.
- **Sliders.** Call `findParameters` as the person types. Give each result a slider, and pass the values as `params` when evaluating.
- **Gaps.** `evaluate` returns NaN or Infinity where the expression is not defined. The sampler turns these into breaks in the curve.
- **Tangent and trace.** `differentiateExpression` gives the slope at any x without numeric noise. A function with no derivative everywhere, such as `floor` or `mod`, comes back as a problem at that function.
- **Graph this.** The calculator's note lines return a line of kind `equation` with `bodyText`. Pass that text to `compileExpression`.
