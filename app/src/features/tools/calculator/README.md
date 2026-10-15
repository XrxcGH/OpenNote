# Calculator core

This folder is the calculator without a screen: expression entry, history, memory slots, degrees and radians, constants, unit conversion, and lines of math in a note. It is pure TypeScript. The window is in `../ui/`.

Reading and running expressions belong to the shared engine in `core/expr`. This folder holds the calculator's dialect and its data.

## Public API

Everything is exported from `index.ts`.

| Name                                              | What it does                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `calculate(source, context)`                      | Evaluates an expression. Returns a value or an error with a code and a place.           |
| `newSession`, `submit`, `setAngleMode`, and so on | A session as plain data: history, nine memory slots, and the angle mode.                |
| `formatNumber(value, options)`                    | Writes a result: automatic, scientific, engineering, or fixed.                          |
| `convert`, `convertText`, `parseConversion`       | Unit conversion for ten categories, such as `5 km to mi`.                               |
| `evaluateNotes(lines, options)`                   | Runs a page of math lines: `rent = 1,200`, `rent * 12 =`, `5 mi in km =`, `f(x) = x^2`. |
| `calculatorUnits`, `CALCULATOR`, `NOTES`          | The unit table, the calculator dialect, and the notes dialect, for other features.      |

## What the screens need

- **Errors are codes.** `CalcError.code` is for `t()`. `position` says where to put the cursor or underline.
- **The angle mode lives in the session.** The expression `sin(30)` means different things in degrees and radians.
- **Note lines.** Call `evaluateNotes` with every line of the page whenever one changes. It returns one result per line. Show the `text` of a `result` or a `define` after the equals sign. A line of kind `text` is writing and gets no answer. A line of kind `equation` can offer "Graph this".
- **Locale.** Results use a period and no grouping. The screen adds the locale's marks.
- **History stays on the device.** The session is plain JSON, and `restoreSession` rebuilds it from saved data.
