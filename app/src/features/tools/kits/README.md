# Tool kits: the shared foundation

The subject kits (thermodynamics, heat transfer, solid mechanics, feedback control, and the others) are tabbed tool windows. Each tool works one kind of problem with units, worked steps, and page inserts. This folder holds what every kit shares, so a kit only writes its engines and forms.

| Path          | What it gives a kit                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `num/`        | Numerics: matrices (LU, QR, Cholesky, eigenvalues with complex pairs, SVD, expm, Lyapunov), complex numbers, polynomials and their roots, partial fractions, root finding, quadrature, ODEs with events, and special functions. |
| `props/`      | Air (ideal gas, US Standard Atmosphere 1976 transport properties) and liquid water (IAPWS-IF97, R12-08, R15-11), each with a source string.                                                                                     |
| `units.ts`    | Quantity kinds with SI and US customary unit lists, conversion to and from SI, and formatting as text and LaTeX.                                                                                                                |
| `types.ts`    | `KitStep`, `KitResultRow`, `KitInsertContent`, `KitToolProps`, `KitToolDef`, and `KitDef`.                                                                                                                                      |
| `problem.ts`  | `KitProblem`, which an engine throws with a message key when it can say what is wrong.                                                                                                                                          |
| `registry.ts` | `registerKit`, `openKitTool`, `selectKitTab`, and the inputs handoff from a live calculation block.                                                                                                                             |
| `ui/`         | `KitWindow`, `QuantityField`, `ChoiceField`, `SystemToggle`, `ResultTable`, `StepsView`, `Assumptions`, `SourceNote`, `Problem`, `KitPlot` (with `plotSvg`), the sketch helpers in `diagram.ts`, and `InsertMenu`.              |
| `block/`      | The live calculation block (`ext:org.opennote/kitcalc`) that reopens a tool with its saved inputs.                                                                                                                              |
| `example/`    | A complete small tool, the ideal gas law, to copy. It is not registered in the app.                                                                                                                                             |

## Rules

- **Engines are pure.** An engine (`<tool>/engine.ts`) takes SI numbers and returns SI numbers, `KitStep[]`, and plot data. It has no DOM, no React, and no `t()`. It throws `KitProblem` (a message key) or `NumError` (a numerics code) when it cannot answer. Engines never run typed text as code; expressions go through `core/expr`.
- **Every validation case is a test.** Put each case next to the engine in `engine.test.ts`, with the tolerance, and an independent check of the number (a hand calculation, a published table, or another method). Add a test for zero, negative, huge, and impossible input.
- **Steps are keys.** A `KitStep` is `{ key, vars, math }`. The key is a full message key in the kit's own namespace. `math` is LaTeX built from numbers and fixed text, never from typed text.
- **Words live in one strings file.** A kit's words go in `app/src/strings/en/kit<Name>.ts`. The shared words here are in `strings/en/kits.ts`.
- **Units.** Fields use `QuantityField` with a kind from `units.ts`. Read a field with `readQuantity` (SI, with limits) and show a result with `showQuantity` (in the chosen system). Call `inSystem` on a field's value so switching between SI and US converts it. State the assumptions with `Assumptions`: units, sign conventions, and whether a gas is ideal.
- **Sources.** Data comes from public-domain or openly published formulations, named in a `SOURCES` constant and shown with `SourceNote`. If no public source exists, the tool takes the value as an input.

## Adding a tool, step by step

The example tool in `example/idealGas` shows each step.

1. **Engine.** Write `engine.ts`. It takes SI inputs and returns SI results with steps. See `idealGas()` in `example/idealGas/engine.ts`.
2. **Tests.** Write `engine.test.ts` with the validation cases and the edge cases. See `example/idealGas/engine.test.ts`.
3. **Form.** Write the tool component (a default export, so it can load lazily). It gets `KitToolProps`: `inputs` (saved, or restored from a block), `setInputs`, and `system`. Keep everything the form needs in `inputs`, so a live block can bring it back. See `IdealGasTool.tsx`.
4. **Results.** Show `Problem`, `ResultTable`, `StepsView`, `Assumptions`, and, when there is one, `KitPlot` or a sketch from `diagram.ts`.
5. **Insert.** Add `InsertMenu` with the answer line, the LaTeX, the rows, the steps, the picture (`plotSvg(spec)` or `diagramSvg(...)` with the paper palette, and its alternative text), and `live` with the kit id, the tool id, the title, and the inputs.
6. **Kit list.** Add the tool to the kit's `kit.ts` (a `KitDef`), with `Component: lazy(() => import('./tool/Tool'))`. See `example/kit.ts`.
7. **Window and commands.** A kit window renders `<KitWindow kit={KIT} />`. The kit's registration file calls `registerKit(id, open)`, where `open(tool)` calls `selectKitTab(id, tool)` and then opens the kit's tool window. A live block's Open in tool then lands on the right tab with its inputs.

```ts
// app/src/features/page/registrations/kit<Name>.ts (loads at start-up: definitions only)
const open = async (tool: string) => {
  const tools = await import('../../tools');
  tools.selectKitTab('thermo', tool);
  tools.openTool('kit-thermo');
};
void import('../../tools').then((tools) => tools.registerKit('thermo', open));
```

## Loading

Everything here except `registry.ts`, `flags.ts`, and `types.ts` loads on first use. Code outside the tools feature reaches the kits through `features/tools/index.ts`: the registry functions and types directly, and the rest with `await loadKits()`, inside the kit's own lazy window. Tools inside the tools feature import these modules directly.
