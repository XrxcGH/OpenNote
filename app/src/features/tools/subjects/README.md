# Subject kits: the shared library

Every subject kit builds on kit-core (`../kits/README.md`: the kit window, fields, results, plots, the Insert menu and the live calculation block) and on this folder, which adds what statistics and the sciences share. Import it inside a kit as `../subjects` (the index); code outside the tools feature uses `await loadSubjects()` from `features/tools/index.ts`. Nothing here loads at start-up.

| Folder     | What it holds                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/`    | The `DataSet` model (named columns of numbers, categories, dates or text, missing as `null`), `parseDataText` and `dataFromGrid` (on the tables paste engine: CSV and TSV with quotes, decimal commas, the missing markers blank, NA, N/A, `.` and NaN, at most `MAX_ROWS` rows), `stack` and `unstack`, and `tablesOf` for a page's tables.                                                             |
| `stats/`   | `dist.ts`: cdf, sf and quantile for the central, discrete and noncentral distributions, the studentized range, exact intervals (Clopper-Pearson, Garwood, Wilson, Agresti-Coull) and the exact null distributions of Mann-Whitney, Wilcoxon, Kendall and Spearman. `rank.ts`: mid-ranks and tie corrections. `plots.ts`: histogram bins, kernel density, ECDF, Q-Q points, box whiskers and step curves. |
| `num/`     | `lm.ts`: weighted Levenberg-Marquardt with covariance and delta-method bands. `mle.ts`: maximum likelihood, standard errors and profile intervals. `rng.ts`: the seeded xoshiro128** generator. `worker.ts`: run an engine in a module worker with progress and cancel.                                                                                                                                  |
| `layout/`  | `layoutTree` (tidy trees, down, right or radial), `layoutLayered` and `layoutForce` (layered or force-directed graphs) and `drawingToSvg`.                                                                                                                                                                                                                                                               |
| `figure/`  | The kit figure block's data and its page view.                                                                                                                                                                                                                                                                                                                                                           |
| `ui/`      | `DataField`, `ColumnPicker`, `LongWideField`, `MatrixField`, `ListField`, `SeedField`; the plot specs in `statPlots.ts`; `CoefficientTable`; `SvgDiagram`; `insertFigure`; `sayS` and `subjectProblem` for words.                                                                                                                                                                                        |
| `example/` | A complete small tool, the one-sample sign test, to copy. It is not registered in the app.                                                                                                                                                                                                                                                                                                               |

Engines throw `SubjectError` (`errors.ts`); its code names a message in `kitSubjects.error`, and `subjectProblem(error)` turns it, or a kit-core error, into a sentence.

## Writing a tool: the sign test

1. **Engine.** `example/signTest.ts` takes plain numbers and returns numbers and `KitStep`s, whose keys are full message keys. It checks its input with `ensure` and uses the distributions from `stats/dist.ts`.
2. **Tests.** `example/signTest.test.ts` checks each case against a value worked out independently (here by hand: 22/1024), and the edge cases: empty input, all ties, values that are not numbers, huge and negative values.
3. **Form.** `example/SignTestTool.tsx` is a default export that gets `KitToolProps`. All it needs is in `inputs`, as plain text, so a live block brings it back. It reads the list with `readList`, works the engine inside `useMemo`, and shows any error through `subjectProblem`.
4. **Results.** It shows kit-core's `Problem`, `ResultTable`, `StepsView`, `KitPlot` and `Assumptions`, plus a verdict in words. A p-value never stands alone, and a significance star never replaces words.
5. **Insert.** kit-core's `InsertMenu` gets the answer, rows, steps, the picture (`plotSvg(spec)`) and `live`.

## Data input

```tsx
const [input, setInput] = useState<DataInput>(emptyDataInput());
const data = applyLongWide(readDataInput(input), reshape);
<DataField label={sayS('data.text')} value={input} onChange={setInput} data={data} />
<ColumnPicker data={data} roles={[{ role: 'response', kinds: ['number'] }, { role: 'group', kinds: ['category'] }]} value={roles} onChange={setRoles} />
```

Keep `input`, `reshape` and `roles` in the tool's `inputs`. `missingRoles(data, specs, roles)` lists the roles still to choose; `numbersOf`, `labelsOf` and `completeRows` read the columns. A table picked from the page is copied in as text, so a block reopens the same numbers. The page answers the field's request through `SUBJECT_TABLES_EVENT`; a popped-out window gets no answer and says to open a page.

## Fitting

```ts
const fit = levenbergMarquardt((s, [vmax, km]) => (vmax * s) / (km + s), S, V, [5, 1], { lower: [0, 0] });
const bands = lmBands(model, fit, grid); // confidence and prediction half-widths
const mle = maximizeLikelihood(([rate]) => n * Math.log(rate) - rate * total, [1]);
const interval = profileInterval(logLik, mle, 0, 0.95);
```

A log-likelihood returns `-Infinity` outside its domain. Show `fit.converged` and say so in words when it is false.

## Random numbers

Every simulated result prints its seed. Keep the seed as text in `inputs`, read it with `parseSeed`, start `new Rng(seed)`, and show `SeedField`. Never use `Math.random` in an engine. For long runs (bootstrap, permutation, Gillespie, agent-based models), put the engine in a worker with `runTask` from `num/worker.ts` (the worker module calls `serveTasks`), which reports progress, cancels, and runs on the main thread in tests.

## Figures

Lay out a tree or a graph, draw it with `drawingToSvg`, and show it with `SvgDiagram`, which offers Insert figure. Or call `insertFigure({ kit, tool, inputs, svg, alt, summary })` yourself. The block stores the SVG and shows it only as an `<img>` from a data URL, so nothing in it can run; `alt` is read aloud and `summary` is the block's search and export text. Give every figure both.

## Reference data

Tables of constants or reference values must be public domain or openly licensed, and the tool names the source on screen with kit-core's `SourceNote`.
