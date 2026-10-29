// The tool windows added after the first three (Phase 10 and the study tools): each body is another feature's panel
// or a small tool of this one. They share the window, the storage, and the pop-out of the first three.
import { lazy, Suspense } from 'react';

// The fluid and heat transfer kit loads with its engineering feature the first time its window opens.
const FluidHeatKit = lazy(() =>
  import('../../engineering')
    .then((engineering) => engineering.loadFluidHeatKit())
    .then((m) => ({ default: m.FluidHeatKit })),
);
import { CitationsPanel } from '../../citations';
import { FigureTool, FormulaSheetTool, PracticeTool } from '../../docstructure';
import { DeckPanel } from '../../study';
import { ChemCalcTool } from './ChemCalcTool';
import { ConstantsTool } from './ConstantsTool';
import { ConverterTool } from './ConverterTool';
import { DictionaryTool } from './DictionaryTool';
import { LatexTool } from './LatexTool';
import { PropertiesTool } from './PropertiesTool';
import { ReferenceTool } from './ReferenceTool';
import { SigFigsTool } from './SigFigsTool';
import { StructureTool } from './StructureTool';
import { SymbolsTool } from './SymbolsTool';
import type { ToolId } from './tools';

// The solvers are a large window of their own, so they load the first time it opens.
const SolversTool = lazy(() =>
  import('../../math').then((math) => math.loadSolversTool()).then((loaded) => ({ default: loaded.SolversTool })),
);

// The circuits and energy kit loads on first open.
const KitElectrical = lazy(() =>
  import('../../engineering')
    .then((engineering) => engineering.loadElectricalKit())
    .then((loaded) => ({ default: loaded.KitElectricalTool })),
);

// The aerospace kit loads on first open.
const KitAero = lazy(() =>
  import('../../engineering')
    .then((engineering) => engineering.loadAeroKit())
    .then((loaded) => ({ default: loaded.KitAeroTool })),
);

// The thermodynamics kit loads with its engines' forms on first open, so the tool windows' own code stays small.
const ThermoKit = lazy(() => import('../../engineering').then((engineering) => engineering.loadThermoKit()));

// The math labs load with the math feature, on first open, so the tool windows' own code stays small.
const MathLab = {
  vectors: lazy(() => import('../../math').then((math) => ({ default: math.VectorsTool }))),
  solids: lazy(() => import('../../math').then((math) => ({ default: math.SolidsTool }))),
  projectile: lazy(() => import('../../math').then((math) => ({ default: math.ProjectileTool }))),
};

// The solid mechanics kit loads with its engineering feature the first time its window opens.
const SolidsKit = lazy(() =>
  import('../../engineering')
    .then((engineering) => engineering.loadSolidsKit())
    .then((m) => ({ default: m.SolidsKit })),
);
// The Chemistry and materials window loads the first time it opens: it carries the engines and the species data.
const ChemMatKit = lazy(() => import('../chemmat/ui/KitWindow').then((loaded) => ({ default: loaded.KitWindow })));

export function ExtraToolBody({ tool }: { tool: ToolId }) {
  if (tool === 'vectors' || tool === 'solids' || tool === 'projectile') {
    const Body = MathLab[tool];
    return (
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    );
  }
  if (tool === 'kitelectrical')
    return (
      <Suspense fallback={null}>
        <KitElectrical />
      </Suspense>
    );
  if (tool === 'kitaero')
    return (
      <Suspense fallback={null}>
        <KitAero />
      </Suspense>
    );
  if (tool === 'flashcards') return <DeckPanel />;
  if (tool === 'converter') return <ConverterTool />;
  if (tool === 'reference') return <ReferenceTool />;
  if (tool === 'citations') return <CitationsPanel />;
  if (tool === 'dictionary') return <DictionaryTool />;
  if (tool === 'constants') return <ConstantsTool />;
  if (tool === 'sigfigs') return <SigFigsTool />;
  if (tool === 'latex') return <LatexTool />;
  if (tool === 'solvers')
    return (
      <Suspense fallback={null}>
        <SolversTool />
      </Suspense>
    );
  if (tool === 'chemcalc') return <ChemCalcTool />;
  if (tool === 'structure') return <StructureTool />;
  if (tool === 'properties') return <PropertiesTool />;
  const lazyTool = { formulasheet: FormulaSheetTool, practice: PracticeTool, figure: FigureTool }[tool as string];
  if (lazyTool) {
    const Body = lazyTool;
    return (
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    );
  }
  if (tool === 'kit-fluidheat')
    return (
      <Suspense fallback={null}>
        <FluidHeatKit />
      </Suspense>
    );
  if (tool === 'symbols') return <SymbolsTool />;
  if (tool === 'kit-solids')
    return (
      <Suspense fallback={null}>
        <SolidsKit />
      </Suspense>
    );
  if (tool === 'kit-chemmat')
    return (
      <Suspense fallback={null}>
        <ChemMatKit />
      </Suspense>
    );
  if (tool === 'kit-thermo')
    return (
      <Suspense fallback={null}>
        <ThermoKit />
      </Suspense>
    );
  return null;
}
