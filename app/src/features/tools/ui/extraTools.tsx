// The tool windows added after the first three (Phase 10 and the study tools): each body is another feature's panel
// or a small tool of this one. They share the window, the storage, and the pop-out of the first three.
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';

// The fluid and heat transfer kit loads with its engineering feature the first time its window opens.
const FluidHeatKit = lazy(() =>
  import('../../engineering')
    .then((engineering) => engineering.loadFluidHeatKit())
    .then((m) => ({ default: m.FluidHeatKit })),
);
import { CitationsPanel } from '../../citations';
import { FigureTool, FormulaSheetTool, PracticeTool } from '../../docstructure';
import { DeckPanel, loadExamPanel } from '../../study';
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

const EconTool = lazy(() => import('../econ/EconTool').then((m) => ({ default: m.EconTool })));
// The statistics kit loads the first time its window opens.
const StatInferKit = lazy(() => import('../statinfer').then((kit) => ({ default: kit.StatInferTool })));

// The solvers are a large window of their own, so they load the first time it opens.
const SolversTool = lazy(() =>
  import('../../math').then((math) => math.loadSolversTool()).then((loaded) => ({ default: loaded.SolversTool })),
);

// The molecular biology kit loads on first open.
const KitMolBio = lazy(() => import('../molbio/KitMolBioTool').then((loaded) => ({ default: loaded.KitMolBioTool })));
// The life science tools load on first open, each tool's forms and engines only when its tab opens.
const LifeSysTool = lazy(() => import('../lifesys/ui/LifeSysTool').then((m) => ({ default: m.LifeSysTool })));

// Practice exams load with their window, on first open.
const ExamPanel = lazy(() => loadExamPanel().then((loaded) => ({ default: loaded.ExamPanel })));

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

// The mechanisms and dynamics kit loads on first open.
const KitMechDyn = lazy(() =>
  import('../../engineering')
    .then((engineering) => engineering.loadMechDynKit())
    .then((loaded) => ({ default: loaded.MechDynKit })),
);

// The physics tools are a kit window whose tools each load the first time their tab opens.
const PhysicsKit = lazy(() => import('../physics/ui/PhysicsKit').then((kit) => ({ default: kit.PhysicsKit })));

// The math labs load with the math feature, on first open, so the tool windows' own code stays small.
const MathLab = {
  vectors: lazy(() => import('../../math').then((math) => ({ default: math.VectorsTool }))),
  solids: lazy(() => import('../../math').then((math) => ({ default: math.SolidsTool }))),
  projectile: lazy(() => import('../../math').then((math) => ({ default: math.ProjectileTool }))),
};

// The statistical models kit loads the first time its window opens.
const StatModelsKit = lazy(() => import('../statmodels/ui/StatModelsKit').then((m) => ({ default: m.StatModelsKit })));
// The psychology and behavior kit loads the first time its window opens.
const MindKit = lazy(() => import('../mind').then((mind) => mind.loadMindKit()).then((m) => ({ default: m.MindKit })));
// The solid mechanics kit loads with its engineering feature the first time its window opens.
const SolidsKit = lazy(() =>
  import('../../engineering')
    .then((engineering) => engineering.loadSolidsKit())
    .then((m) => ({ default: m.SolidsKit })),
);
// The Chemistry and materials window loads the first time it opens: it carries the engines and the species data.
const ChemMatKit = lazy(() => import('../chemmat/ui/KitWindow').then((loaded) => ({ default: loaded.KitWindow })));

// The dynamics and control kit loads with its engineering feature the first time its window opens.
const ControlKit = lazy(() =>
  import('../../engineering')
    .then((engineering) => engineering.loadControlKit())
    .then((m) => ({ default: m.ControlKit })),
);

// The design kit loads the first time its window opens.
const DesignKit = lazy(() => import('../design/ui/DesignKit').then((m) => ({ default: m.DesignKit })));

// The engineering mathematics kit loads the first time its window opens.
const MathKit = lazy(() => import('../mathkit/ui/MathKitTool'));

/** The subject kits' windows (docs/help/subject-tool-kits.md), each loaded the first time it opens. */
const KIT_WINDOWS: Partial<Record<ToolId, LazyExoticComponent<ComponentType>>> = {
  kitelectrical: KitElectrical,
  kitaero: KitAero,
  'kit-fluidheat': FluidHeatKit,
  'kit-solids': SolidsKit,
  'kit-chemmat': ChemMatKit,
  'kit-thermo': ThermoKit,
  'kit-control': ControlKit,
  'kit-design': DesignKit,
  'kit-math': MathKit,
  'kit-mechdyn': KitMechDyn,
  'kit-physics': PhysicsKit,
  econ: EconTool,
  'kit-statinfer': StatInferKit,
  'kit-mind': MindKit,
  'kit-statmodels': StatModelsKit,
  kitmolbio: KitMolBio,
  lifesys: LifeSysTool,
};

export function ExtraToolBody({ tool }: { tool: ToolId }) {
  const Kit = KIT_WINDOWS[tool];
  if (Kit)
    return (
      <Suspense fallback={null}>
        <Kit />
      </Suspense>
    );
  if (tool === 'vectors' || tool === 'solids' || tool === 'projectile') {
    const Body = MathLab[tool];
    return (
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    );
  }
  if (tool === 'flashcards') return <DeckPanel />;
  if (tool === 'exam')
    return (
      <Suspense fallback={null}>
        <ExamPanel />
      </Suspense>
    );
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
  if (tool === 'symbols') return <SymbolsTool />;
  return null;
}
