# Shared expression engine

This folder reads and runs the small languages in OpenNote: the calculator, the function grapher, table formulas, and lines of math in a note. Before it existed, each had its own tokenizer, parser, and evaluator. Now there is one tokenizer, one Pratt parser, one syntax tree, and one set of tools that work on the tree. It is pure TypeScript with no browser page and no React, so it runs in the app, in a worker, and in tests. Nothing in it ever runs text as code.

## How the languages differ

A host describes its language with a **dialect**: a small object that says what the text may contain and how it is read.

| Host           | Dialect lives in                              | What is special                                                                                  |
| -------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Calculator     | `features/tools/calculator/dialect.ts`        | Brackets for every function, `2pi` multiplies, `2 3` is a mistake, `mod`, `!`, `%`, and `°`.     |
| Note lines     | `features/tools/calculator/notes.ts`          | The calculator plus units, `1,200`, definitions, `;` between arguments, and your own functions. |
| Grapher        | `features/math/grapher/dialect.ts`            | Letters split into names (`pix`), `sin 2x`, `sin^2(x)`, `sin^-1(x)`, and parameters.             |
| Table formulas | `sheet.ts` (used by `features/tables/engine`) | Cells and ranges (`A1`, `B:B`), `[Column]`, `{id}`, `"text"`, comparisons, `&`, a decimal comma. |

The precedence is the same in all of them, from loosest to tightest: a conversion (`in`), comparisons, `&`, `+ -`, `* / mod` and side-by-side products, a leading sign, `^` (right to left), then `! % °`. So `-2^2` is -4 and `2^-1` is 0.5.

## Files

| File            | What it does                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `lexer.ts`      | Tokenizer. A `LexSpec` picks the decimal mark, separators, name style, grouped digits, symbols.  |
| `parser.ts`     | The Pratt parser. `parse(source, dialect)` returns a tree or throws an `ExprError`.              |
| `statement.ts`  | `rent = 1200` and `f(x) = x^2` as definitions.                                                   |
| `unitsyntax.ts` | Reads `km`, `m/s^2`, and the target of `in`, and writes them back.                               |
| `words.ts`      | Splits a run of letters into known names, so `pix` is pi times x.                                |
| `refs.ts`       | Cell and column letters: `A1`, `$B$3`, `AA`.                                                     |
| `ast.ts`        | The tree. Every node has `start`, `end`, and `pos`, so errors and highlights know where to go.   |
| `compile.ts`    | Turns a tree into a closure. Strict mode throws errors with places. Lenient mode gives NaN.      |
| `functions.ts`  | The standard functions in a `strict` and a `plain` profile. `lookup.ts` builds a dialect's list. |
| `numeric.ts`    | Number helpers: snapping to 15 digits, factorial, gamma, nCr, modulo, real roots.                |
| `trig.ts`       | Sine, cosine, and tangent in degrees or radians, exact at familiar angles.                       |
| `rational.ts`   | Exact fractions on big integers. `exact.ts` evaluates a tree with them.                          |
| `quantity.ts`   | Numbers with units. `quantityEval.ts` evaluates a tree that has them.                            |
| `lines.ts`      | A page of lines: definitions, questions, functions, and equations to graph.                      |
| `derive.ts`     | Symbolic derivatives. `simplify.ts` tidies the result. `build.ts` makes trees by hand.           |
| `print.ts`      | Writes a tree back as text with only the brackets it needs.                                      |
| `numfmt.ts`     | Formats a number: automatic, scientific, engineering, or fixed.                                  |
| `general.ts`    | A general dialect, plus `evaluate(source)` for tools and tests.                                  |
| `errors.ts`     | `ExprError` with a code, a place, and a length. The codes carry no interface text.               |

## Using it

```ts
import { evaluate, parse, differentiate, formatExpression } from '../../core/expr';

evaluate('2pi * 3'); // { ok: true, value: 18.84955592153876 }
evaluate('1 +'); // { ok: false, error: { code: 'unexpected-end', position: 3, length: 0, ... } }

const tree = parse('sin(2x)', myDialect);
formatExpression(differentiate(tree, 'x')); // "2*cos(2*x)"
```

`evaluateExact` keeps `0.1 + 0.2` as exactly 3/10 and `30!` as a whole number. The standard evaluators do not need it, because they snap sums to 15 digits as the old calculator did.

## What the screens need

The engine returns codes and places, never sentences. A screen turns `ExprError.code` into words with `t()`. The `position` and `length` fields say which characters to underline. For a missing bracket, `related` is the place of the bracket that opened.

- **Calculator window.** `calculate`, the session functions, and `formatNumber` are unchanged. `evaluateNotes` adds units.
- **Grapher block.** `compileExpression` and `findParameters` are unchanged. `differentiateExpression` gives the slope line and a trace readout.
- **Math lines in a page.** Call `evaluateNotes(lines)` on every change to the page. It returns one result per line. Show the `text` after the equals sign. A `kind` of `equation` is the line "Graph this" sends to the grapher, as `bodyText`.
- **Quick math and tables.** `parseFormula`, `quickMath`, and the table functions are unchanged.

Hosts keep their own value types. The table formulas evaluate to cell values, the grapher to numbers, and note lines to quantities.

## Not here

No source had complex numbers, so there are none. Currency is left out, because rates need the network. The engine has no locale: grouping marks and the decimal mark come from the dialect, and the screen formats results for the locale.
