// The Problems panel's model (DESIGN 5.1 and 6.2): every problem of the project, from the checkers (Diagnostic,
// by offsets) and from the last run (RuntimeDiagnostic, by line), grouped by file with counts. The status bar shows
// the same counts.

import type { Diagnostic, RuntimeDiagnostic, Severity } from '../contracts';

export interface Problem {
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  severity: Severity;
  message: string;
  /** The rule name or the runtime's own name for the error. */
  code: string;
  source: string;
}

export interface ProblemCounts {
  errors: number;
  warnings: number;
  /** Information and hints. */
  infos: number;
}

export interface ProblemGroup {
  file: string;
  problems: Problem[];
  counts: ProblemCounts;
}

/** The 1-based line and column of an offset in a text. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  const at = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, at);
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line: before.split('\n').length, column: at - lineStart + 1 };
}

/** A checker's diagnostic as a problem, with its line read from the file's text. */
export function fromDiagnostic(item: Diagnostic, text: string): Problem {
  const { line, column } = lineColumn(text, item.from);
  return {
    file: item.file,
    line,
    column,
    severity: item.severity,
    message: item.message,
    code: item.code,
    source: item.source,
  };
}

/** A runtime error as a problem: always an error. */
export function fromRuntime(item: RuntimeDiagnostic): Problem {
  return {
    file: item.file,
    line: item.line,
    column: item.column ?? 1,
    severity: 'error',
    message: item.message,
    code: item.kind,
    source: 'run',
  };
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2, hint: 3 };

export function countProblems(problems: readonly Problem[]): ProblemCounts {
  const counts: ProblemCounts = { errors: 0, warnings: 0, infos: 0 };
  for (const problem of problems) {
    if (problem.severity === 'error') counts.errors += 1;
    else if (problem.severity === 'warning') counts.warnings += 1;
    else counts.infos += 1;
  }
  return counts;
}

/**
 * Problems grouped by file, the files in the project's order (unknown files last, by name), each file's problems
 * by line, column, and then severity. The same problem reported twice shows once.
 */
export function groupProblems(problems: readonly Problem[], fileOrder: readonly string[] = []): ProblemGroup[] {
  const byFile = new Map<string, Problem[]>();
  const seen = new Set<string>();
  for (const problem of problems) {
    const key = [problem.file, problem.line, problem.column, problem.severity, problem.message].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    byFile.set(problem.file, [...(byFile.get(problem.file) ?? []), problem]);
  }
  const place = (file: string) => {
    const index = fileOrder.indexOf(file);
    return index === -1 ? fileOrder.length : index;
  };
  return [...byFile.entries()]
    .sort(([a], [b]) => place(a) - place(b) || a.localeCompare(b))
    .map(([file, items]) => {
      const sorted = [...items].sort(
        (a, b) => a.line - b.line || a.column - b.column || RANK[a.severity] - RANK[b.severity],
      );
      return { file, problems: sorted, counts: countProblems(sorted) };
    });
}
