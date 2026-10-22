// The document-structure tools' public face: built-in templates, the equation commands, and the three tool windows.
// The heavy parts load when first used, so start-up stays small.
import { lazy } from 'react';

export { builtinBlocks, builtinInfos, isBuiltin } from './builtinTemplates';
export { DOC_FLAGS } from './flags';
export type { DocFlagId } from './flags';
export const loadEquationCommands = () => import('./equationCommands');

export const FormulaSheetTool = lazy(() =>
  import('./ui/FormulaSheetTool').then((module) => ({ default: module.FormulaSheetTool })),
);
export const PracticeTool = lazy(() => import('./ui/PracticeTool').then((module) => ({ default: module.PracticeTool })));
export const FigureTool = lazy(() => import('./ui/FigureTool').then((module) => ({ default: module.FigureTool })));
