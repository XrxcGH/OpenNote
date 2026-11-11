// Shapes the diagnostics layers share (DESIGN 6.1, ADR 0074). The checkers run in a worker, so they report a
// message key and its values; the page turns them into text with the app's strings.

import type { Diagnostic, Severity } from '../contracts';
import type { EditorLanguage } from '../editor/indent';

export type { EditorLanguage };

/**
 * The layers of DESIGN 6.1, cheapest first. `syntax` is L-a, `checker` is L-b, `engine` is L-c, `tools` is the
 * code tools pack (L-d), and `compiler` is clang (L-e).
 */
export const LAYERS = ['syntax', 'checker', 'engine', 'tools', 'compiler'] as const;
export type Layer = (typeof LAYERS)[number];

/** How long each layer waits after the last change (DESIGN 6.1). Syntax marks must show within 100 ms. */
export const LAYER_DEBOUNCE_MS: Readonly<Record<Layer, number>> = {
  syntax: 50,
  checker: 300,
  engine: 300,
  tools: 500,
  compiler: 800,
};

/** One file at one version, as a provider reads it. */
export interface DiagnosticRequest {
  /** The project path. */
  file: string;
  version: number;
  language: EditorLanguage;
  text: string;
  /** The other files of the project, for engine checks that read more than one file. */
  files?: readonly { path: string; text: string }[];
}

/** A provider finds problems in one layer for some languages. */
export interface DiagnosticProvider {
  /** Also the `source` of its results, such as `lezer` or `opennote`. */
  id: string;
  layer: Layer;
  languages: readonly EditorLanguage[];
  run(request: DiagnosticRequest): Promise<Diagnostic[]> | Diagnostic[];
}

/** The checker message ids. Each one has a sentence in strings/en/codeStudio/diagnostics.ts. */
export type MessageId =
  | 'syntax'
  | 'syntaxAt'
  | 'endOfFile'
  | 'expectedColon'
  | 'unclosed'
  | 'unexpectedClose'
  | 'mismatched'
  | 'unusedImport'
  | 'redefined'
  | 'undefinedName'
  | 'unusedLocal'
  | 'noneComparison'
  | 'boolComparison'
  | 'isLiteral'
  | 'tabIndent'
  | 'mixedIndent'
  | 'undefinedVar'
  | 'unusedVar'
  | 'constAssign'
  | 'unreachable'
  | 'eqeqeq'
  | 'condAssign'
  | 'fallthrough'
  | 'undeclared'
  | 'unusedVariable'
  | 'luaUndefined'
  | 'luaUnused';

/** What a checker found, before the page words it. */
export interface Finding {
  from: number;
  to: number;
  severity: Severity;
  /** The familiar rule name: a pyflakes or pycodestyle code, an ESLint rule, a clang warning, or a luacheck code. */
  code: string;
  message: MessageId;
  params?: Record<string, string | number>;
}
