// The code editor's chunk (ADR 0068). The studio window (code:L04) and code cells (code:L19) load it on demand
// through loadCodeEditor in features/codestudio/index.ts; nothing here runs at start-up.

export { ABANDON_MS, AUTO_PAUSE_MS, createCodeEditor } from './create';
export type { CodeEditor, CodeEditorOptions, GhostRequest, GhostSource } from './create';
export { createDiffView, diffLines } from './diff';
export type { DiffOp, DiffView, DiffViewOptions } from './diff';
export { DEFAULT_INDENT, detectIndent, resolveIndent } from './indent';
export type { EditorLanguage, IndentStyle } from './indent';
export { loadLanguage } from './languages';
export type { InlineValue } from './marks';
export { measureTyping } from './perf';
export type { TypingTimes } from './perf';
export { codeTheme } from './theme';
