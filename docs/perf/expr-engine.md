# Expression engine performance

The shared expression engine (`app/src/core/expr`) replaced three separate parsers: the calculator's, the grapher's, and the table formulas'. This page records what it costs, before and after. The rule for the port was that no host gets slower in a way a person could feel, and that the grapher's redraw loop gets faster or stays the same.

## How it was measured

- **Machine.** A Surface Laptop Studio 2, while several other jobs were building and testing on it. CPU load was about 85% for the whole session. Every number below is therefore slower than a quiet laptop would give, and the ratios are the useful part.
- **Method.** Each figure is the fastest of nine rounds, because other work on a machine only ever slows a round down. In the before-and-after table, one round of the old code and one of the new run in turn in a single process, so a busy moment hits both.
- **Before** is commit `ba404a0`, the merge of `phase-7`, `phase-10`, and `tools-core` with each host still on its own parser. **After** is this branch. Both are measured through the hosts' public functions (`calculate`, `compileExpression`, `parseFormula`, `quickMath`), which are the same on both sides.
- The engine's own benchmark is `app/src/core/expr/expr.bench.test.ts`. Run it with `npx vitest run --config app/vitest.config.ts --project unit app/src/core/expr/expr.bench.test.ts --silent=false`. It prints the figures under "Expression engine" and fails if one goes above a budget set at about ten times what a quiet laptop needs.

## Before and after

Time per call, in nanoseconds. A ratio below 1.00 means the engine is faster.

| What                                                      | Old parsers | Engine     | Ratio |
| --------------------------------------------------------- | ----------- | ---------- | ----- |
| Calculator: tokenize 6 expressions                        | 50,343      | 33,831     | 0.67  |
| Calculator: tokenize and parse 6 expressions              | 64,869      | 53,645     | 0.83  |
| Calculator: parse and evaluate 6 expressions              | 109,088     | 83,979     | 0.77  |
| Grapher: parse and compile 6 expressions                  | 135,443     | 93,208     | 0.69  |
| Grapher: 100,000 evaluations of `sin(x)*x^2+3x-1/(x^2+1)` | 11,596,883  | 5,375,650  | 0.46  |
| Grapher: 100,000 evaluations with three parameters        | 51,036,700  | 43,078,983 | 0.84  |
| Table formulas: parse 6 formulas                          | 182,310     | 67,136     | 0.37  |
| Quick math: scan 320 characters of prose                  | 2,791,910   | 3,039,420  | 1.09  |

What the table says:

- **Reading text is faster everywhere.** The tokenizer builds its plan once per dialect and only tries a number or name pattern where one can start. Formulas gain the most.
- **The grapher's inner loop is about twice as fast** for a typical curve. The compiler writes each operator into its closure, reads a constant right side once, and turns `^2` into one product. A graph of 2,000 points costs about 0.1 ms.
- **Quick math is the same.** It tries each starting point in the 200 characters before the equals sign, so its cost depends on the number of tries more than on the speed of one. The 9% is inside the noise (the first run of the same pair gave 1.02). It runs once, when Space follows an equals sign.

## The engine on its own

Fastest of nine rounds, same machine and load.

| What                                                 | Time                     |
| ---------------------------------------------------- | ------------------------ |
| Parse a calculator expression                        | 9,100 ns                 |
| Parse and evaluate a calculator expression           | 13,400 ns                |
| Parse a spreadsheet formula                          | 9,800 ns                 |
| Evaluate a compiled curve at one point (five curves) | 230 ns                   |
| Evaluate five curves at 20,000 points each           | 23 ms for 100,000 points |
| Evaluate an expression in exact fractions            | 11,200 ns                |
| Differentiate and simplify an expression             | 19,800 ns                |
| Write an expression back as text                     | 3,900 ns                 |
| Evaluate a page of 100 lines of math with units      | 3.3 ms                   |

A page of 100 lines costs 3.3 ms on this loaded machine, so recalculating on every keystroke is fine.

## Reading the numbers again

Run the benchmark on a quiet machine before quoting these figures anywhere outside the repository. The test's budgets are loose on purpose, so a pass says nothing has become ten times slower, not that nothing has slowed down. For a closer look, compare two commits in one process as the table above did.
