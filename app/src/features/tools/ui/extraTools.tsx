// The tool windows added after the first three (Phase 10 and the study tools): each body is another feature's panel
// or a small tool of this one. They share the window, the storage, and the pop-out of the first three.
import { lazy, Suspense } from 'react';
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

// The math labs load with the math feature, on first open, so the tool windows' own code stays small.
const MathLab = {
  vectors: lazy(() => import('../../math').then((math) => ({ default: math.VectorsTool }))),
  solids: lazy(() => import('../../math').then((math) => ({ default: math.SolidsTool }))),
  projectile: lazy(() => import('../../math').then((math) => ({ default: math.ProjectileTool }))),
};

// The psychology and behavior kit loads the first time its window opens.
const MindKit = lazy(() => import('../mind').then((mind) => mind.loadMindKit()).then((m) => ({ default: m.MindKit })));

export function ExtraToolBody({ tool }: { tool: ToolId }) {
  if (tool === 'vectors' || tool === 'solids' || tool === 'projectile') {
    const Body = MathLab[tool];
    return (
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    );
  }
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
  if (tool === 'symbols') return <SymbolsTool />;
  if (tool === 'kit-mind')
    return (
      <Suspense fallback={null}>
        <MindKit />
      </Suspense>
    );
  return null;
}
