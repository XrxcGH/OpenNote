// The tool windows added after the first three (Phase 10 and the study tools): each body is another feature's panel
// or a small tool of this one. They share the window, the storage, and the pop-out of the first three.
import { CitationsPanel } from '../../citations';
import { DeckPanel } from '../../study';
import { ChemCalcTool } from './ChemCalcTool';
import { ConverterTool } from './ConverterTool';
import { DictionaryTool } from './DictionaryTool';
import { PropertiesTool } from './PropertiesTool';
import { ReferenceTool } from './ReferenceTool';
import { StructureTool } from './StructureTool';
import type { ToolId } from './tools';

export function ExtraToolBody({ tool }: { tool: ToolId }) {
  if (tool === 'flashcards') return <DeckPanel />;
  if (tool === 'converter') return <ConverterTool />;
  if (tool === 'reference') return <ReferenceTool />;
  if (tool === 'citations') return <CitationsPanel />;
  if (tool === 'dictionary') return <DictionaryTool />;
  if (tool === 'chemcalc') return <ChemCalcTool />;
  if (tool === 'structure') return <StructureTool />;
  if (tool === 'properties') return <PropertiesTool />;
  return null;
}
