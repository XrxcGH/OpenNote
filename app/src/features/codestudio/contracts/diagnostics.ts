// Diagnostics and fixes (DESIGN 6.1 and 7.1, ADR 0074). Lane code:L10 schedules the providers and lane code:L11
// writes the fixes; both speak these shapes, and the editor shows them through @codemirror/lint.

export const SEVERITIES = ['error', 'warning', 'info', 'hint'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** One text change: replace the characters from `from` to `to` (offsets in the file) with `insert`. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** A quick fix. Its edits apply as one undo step. */
export interface Fix {
  /** What the menu shows, such as "Change to `print`". */
  title: string;
  edits: TextEdit[];
  /** The fix Ctrl+. offers first. */
  preferred?: boolean;
}

/**
 * One problem in a file. `from` and `to` are offsets in the file's text. `code` is the familiar rule name: a
 * pyflakes code for Python, an ESLint name for JavaScript. `source` names the layer that found it.
 */
export interface Diagnostic {
  /** The project path. */
  file: string;
  from: number;
  to: number;
  severity: Severity;
  code: string;
  message: string;
  /** For example `lezer`, `opennote`, `sqlite`, `ruff`, `typescript`, `clang`. */
  source: string;
  fixes?: Fix[];
}

/** One provider's answer for one file. A result whose version is older than the file's text is dropped. */
export interface DiagnosticResult {
  file: string;
  /** The document version the provider read. */
  version: number;
  source: string;
  items: Diagnostic[];
}
