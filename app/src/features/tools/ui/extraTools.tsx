// The tool windows added after the first three (Phase 10 and the study tools): each body is another feature's panel
// or a small tool of this one. They share the window, the storage, and the pop-out of the first three.
import { lazy, Suspense } from 'react';
import { CitationsPanel } from '../../citations';
import { DeckPanel } from '../../study';
import { ConstantsTool } from './ConstantsTool';
import { ConverterTool } from './ConverterTool';
import { DictionaryTool } from './DictionaryTool';
import { LatexTool } from './LatexTool';
import { ReferenceTool } from './ReferenceTool';
import { SigFigsTool } from './SigFigsTool';
import type { ToolId } from './tools';

// The solvers are a large window of their own, so they load the first time it opens.
const SolversTool = lazy(() =>
  import('../../math').then((math) => math.loadSolversTool()).then((loaded) => ({ default: loaded.SolversTool })),
);

export function ExtraToolBody({ tool }: { tool: ToolId }) {
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
  return null;
}
