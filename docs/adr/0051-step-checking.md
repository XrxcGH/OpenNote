# ADR 0051: Check my work checks each step on the device, and says "I could not check this step" before "wrong"

- Status: Proposed
- Date: 2026-10-29

## Context

DeriveNotes checks worked math line by line. OpenNote could solve an equation, show the steps of a derivative, and read handwriting as math, but it could not look at a person's own working and say which step went wrong. The owner asked for step-by-step checking of typed and handwritten working (the dn-stepcheck lane), fully offline, and the AI tutor lane will build on the same checker. The hard part is trust: a checker that calls a correct step wrong teaches the wrong lesson, so a missed slip is better than a false alarm.

## Decision

- **One pure engine with a stable API.** `app/src/features/math/stepcheck` is TypeScript with no screen and no network. `checkSteps(lines, options)` takes lines (text, or LaTeX from an equation or handwriting) and returns one result per line: `{index, verdict: 'ok' | 'broken' | 'unchecked', reason, params, suggestion, method, confidence}`. `reason` is a code and `params` are math only; the sentences are in `strings/en/stepCheck.ts`. The module is loaded through `loadStepCheck()` in `features/math/index.ts`, which the AI tutor imports. Same input and seed, same output.
- **What a line is.** A line is a chain of equal values (`(x+1)^2` then `= x^2 + 2x + 1`, or `d/dx(x^3) = 3x^2`), equations and inequalities joined by "and", commas, or "or", a system of equations, a definition (`f(x) = ...`), a substitution (`let u = x^2`, or `u = x, du = dx`), or a note. Calculus inside a line is worked out first with the existing calculus tools: derivatives symbolically, `f'(x)` from a definition, definite integrals, `[F]_a^b`, limits, and sums by value. Matrices and vectors have a small reader of their own; units use the calculator's quantities.

### Real homework

- **A page of problems.** Each problem is checked on its own. A new one starts at a blank line, a line that cannot be read, or a number or title such as `1)`, `(a)`, `Q3`, or `Problem 2`. A line that shares no letter with the line before also starts one. A word in a line (four letters or more that are not a function, a constant, or a Greek letter) makes it a note.
- **Systems on separate lines.** Equations in more than one unknown, written one to a line (`y = 3x`, then `x + y = 8`), are a system. A new linear equation that fits the ones above joins them (reason `systemEquation`). The lines after are checked at their solution. Only a sign slip, or an equation that cannot hold with the one before, is broken there. A nonlinear pair in different unknowns is left unchecked. One nonlinear formula rearranged (`v = u + at`, then `u = v - at`) is still compared by solutions.
- **Rounding.** `≈` is read as `=`. A decimal is right when it is the other side rounded, or cut short, to the places shown (reason `rounded`). This holds in chains (`sqrt(2) = 1.414`) and for answers (`x = 7/3`, then `x ≈ 2.33`). In `x = 1/3 = 0.33`, the `x =` names the chain and is not one of its values.
- **Other shapes.** `dy/dx`, `d^2y/dx^2`, and `y'` are worked out from an earlier `y = ...` line, and left unchecked without one. Notes in brackets at the end of a line, such as `(divide by 2)`, are dropped. `at x = 2` or `|_(x=2)` is the point a derivative is taken at. A mixed number `1 1/2` is one and a half. A one-letter unit, such as `m`, `s`, `g`, `h`, `L`, or `N`, counts after a number and a space when every side has one. So `5m = 20` stays algebra.

### Checking a step

- **How a step is checked, by kind.**
  - Values are multiplied out symbolically when the forms allow. Otherwise they are compared at seeded sample points, and the check says "consistent at sample points". The numbers decide first, so `sqrt(x^2) = x` is "true for some values", not "equivalent".
  - Antiderivatives: both lines are differentiated and the slopes compared. An unworked `∫ f dx` differentiates to `f` times the substitution's slope. A constant of integration does not change the check. When the integral sign goes and no `+ C` comes with it, the step is right with a note to add it (reason `missingConstant`). A later line in the same chain that adds the constant clears the note.
  - Equations: a constant ratio of left minus right means the same equation. Otherwise the solutions of each line are found and checked in the other.
  - Systems: when every equation is linear, they are solved, and each later line must hold at every solution.
  - Inequalities: both lines are tested at many points on both sides of every boundary. A line that matches only with its sign turned around gets "the inequality should turn around".
  - Units: kinds first, then amounts in SI. Matrices: entry by entry, and sizes that do not fit.
- **Precision over recall.** A step is `broken` only on clear evidence: different at every usable sample point by more than 1e-4 of the size, a solution of one line that clearly fails the other in both directions, or a mismatch at points well away from a boundary. Agreement at some points and not others, a step that loses a solution (`x^2 = 9` to `x = 3`), lines that cannot be read, and anything undecided are `unchecked` with a calm reason. A step that only adds solutions (squaring both sides) is `ok` with a note to check the answers.
- **First slip, then "follows".** Every step is judged against the line before it (or, in a system, against the equations so far). After the first broken step, a step that follows from its line is marked "follows from your previous line"; a second independent slip is still marked.
- **Explanations and corrections.** Common slips get their own words:
  - a sign that should change when a term moves across the equals sign (found by flipping each term and testing),
  - an inequality that should turn around,
  - a line that is a multiple of the previous one, or off by a constant.

  The suggestion is a corrected line: the worked-out derivative, value, or matrix, the root (`x = 3`), or the line with the sign fixed.

### Surface and bounds

- **Surface.** One command, `math.checkWork` ("Check my work"), in the palette, the slash menu, the page text menu, and the lasso toolbar, behind the flag `math.checkWork` (on in development, nightly, and Beta) and a switch in Settings, then Editing. It checks lassoed handwriting (split into rows, each read by the existing on-device math recognizer), the selected typed lines, or every line on the page that looks like working. Handwriting read with symbols left out is shown in a dialog to confirm or fix before anything is judged. The marks are buttons in a layer over the page, not ink and not part of the note, with a summary card that lists what needs a look, Check again, and Dismiss.
- **Bounds.** At most 200 lines and 4 seconds per check; a line longer than 4,000 characters, a deep tree, or a hostile string becomes `unchecked`, never an exception or a hang.

## Options considered

| Option                                                                                 | For                                                                                                                      | Against                                                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Symbolic where it can, seeded sample points otherwise, unsure means unchecked (chosen) | Works for trigonometry, logs, and calculus the normal form cannot decide; never calls a correct step wrong in the corpus | A sample-point "consistent" is strong evidence, not proof, and says so      |
| A full computer algebra system                                                         | Proofs of equivalence                                                                                                    | Large, slow to load, and still undecidable for many forms; a new dependency |
| A language model judging steps                                                         | Reads messy working                                                                                                      | Not offline, not repeatable, and can call a correct step wrong              |
| Check only the final answer                                                            | Simple                                                                                                                   | Does not say where the working went wrong                                   |

## Consequences

The corpus is `tests/fixtures/stepcheck/corpus.json`, built by `generate.ts` there and not shipped. It holds 296 correct and 256 broken worked solutions. Newer families cover pages with several problems, systems written one equation to a line, Leibniz notation, rounded answers, notes in brackets, one-letter units, and mixed numbers. The rest cover algebra, trigonometry, exponentials and logs, derivatives, integrals by parts and by substitution, definite integrals, limits, series, linear systems, matrices, vectors, units, and inequalities.

`corpus.test.ts` fails on any correct step called broken, or on fewer than 90% of the slips found, and prints both rates. When this was written, 0 of 1176 correct steps were called broken and 256 of 256 slips were found. The same lane wrote the corpus and the checker, so the owner's own homework is the real test.

Left unchecked for now: complex numbers, matrices with letters, limits that do not settle numerically, and nonlinear systems. Handwriting is only as good as the recognizer. The web build's stand-in recognizer cannot read real math, so the handwriting path needs a pen on Windows to try.
