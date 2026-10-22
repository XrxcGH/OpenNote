// The tool windows added after the first three (Phase 10 and the study tools): each body is another feature's panel
// or a small tool of this one. They share the window, the storage, and the pop-out of the first three.
import { lazy, Suspense } from 'react';
import { CitationsPanel } from '../../citations';
import { DeckPanel } from '../../study';
import { ConverterTool } from './ConverterTool';
import { DictionaryTool } from './DictionaryTool';
import { ReferenceTool } from './ReferenceTool';
import type { ToolId } from './tools';

// The math labs load with the math feature, on first open, so the tool windows' own code stays small.
const MathLab = {
  vectors: lazy(() => import('../../math').then((math) => ({ default: math.VectorsTool }))),
  solids: lazy(() => import('../../math').then((math) => ({ default: math.SolidsTool }))),
  projectile: lazy(() => import('../../math').then((math) => ({ default: math.ProjectileTool }))),
};

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
  return null;
}
