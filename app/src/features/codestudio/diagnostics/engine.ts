// Engine checks (layers L-c and L-e, DESIGN 6.1): the runtime lanes register a check that asks the real engine,
// such as SQLite's sqlite3_prepare_v2 against the project schema, wasmoon's load(), Python's compile(), or clang
// -fsyntax-only. A check reports lines, as runtimes do (RuntimeDiagnostic); this turns them into offsets and joins
// them to the scheduler like any other provider.

import type { Diagnostic, RunFile, RuntimeAdapter, RuntimeDiagnostic, Severity } from '../contracts';
import { lineRange, lineStarts } from './text';
import type { DiagnosticProvider, EditorLanguage } from './types';

export interface EngineCheck {
  /** Also the `source` of its marks, such as `sqlite`, `wasmoon`, `pyodide`, or `clang`. */
  id: string;
  /** `engine` (300 ms pause) by default; clang uses `compiler` (800 ms). */
  layer?: 'engine' | 'compiler';
  languages: readonly EditorLanguage[];
  check(file: RunFile, files: RunFile[]): Promise<RuntimeDiagnostic[]>;
}

type Listener = (check: EngineCheck, added: boolean) => void;

const checks = new Map<string, EngineCheck>();
const listeners = new Set<Listener>();

/** Registers a runtime's check. A second check with the same id replaces the first. Returns the way to remove it. */
export function registerEngineCheck(check: EngineCheck): () => void {
  const before = checks.get(check.id);
  if (before) listeners.forEach((l) => l(before, false));
  checks.set(check.id, check);
  listeners.forEach((l) => l(check, true));
  return () => {
    if (checks.get(check.id) !== check) return;
    checks.delete(check.id);
    listeners.forEach((l) => l(check, false));
  };
}

/** The checks registered now. */
export function engineChecks(): EngineCheck[] {
  return [...checks.values()];
}

/** Hears checks come and go. Returns the way to stop listening. */
export function onEngineChecks(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The engine check of a runtime adapter that has one. */
export function fromRuntimeAdapter(
  adapter: RuntimeAdapter,
  languages: readonly EditorLanguage[],
  id: string = adapter.id,
  layer: EngineCheck['layer'] = 'engine',
): EngineCheck | null {
  const check = adapter.check?.bind(adapter);
  return check ? { id, layer, languages, check } : null;
}

function severityOf(kind: string): Severity {
  if (/warn/i.test(kind)) return 'warning';
  if (/note|info/i.test(kind)) return 'info';
  return 'error';
}

/**
 * A runtime's line-based error as a mark in `text`. A column marks the word there; no column marks the line from its
 * first character that is not a space.
 */
export function runtimeToDiagnostic(
  text: string,
  item: RuntimeDiagnostic,
  source: string,
  starts = lineStarts(text),
): Diagnostic {
  const { from: lineFrom, to: lineTo } = lineRange(text, starts, Math.max(1, item.line));
  const line = text.slice(lineFrom, lineTo);
  let from: number;
  let to: number;
  if (item.column !== undefined && item.column >= 1) {
    from = Math.min(lineTo, lineFrom + item.column - 1);
    const word = /^\w+/.exec(line.slice(from - lineFrom));
    to = word ? from + word[0].length : Math.min(lineTo, from + 1);
  } else {
    from = lineFrom + (line.length - line.trimStart().length);
    to = lineTo;
  }
  return {
    file: item.file,
    from,
    to: Math.max(from, to),
    severity: severityOf(item.kind),
    code: item.kind,
    message: item.message,
    source,
  };
}

/** The scheduler provider for an engine check: it reads the file's version and keeps only this file's marks. */
export function engineProvider(check: EngineCheck): DiagnosticProvider {
  return {
    id: check.id,
    layer: check.layer ?? 'engine',
    languages: check.languages,
    async run(request) {
      const file: RunFile = { path: request.file, text: request.text };
      const others = (request.files ?? [])
        .filter((f) => f.path !== request.file)
        .map((f) => ({ path: f.path, text: f.text }));
      const items = await check.check(file, [file, ...others]);
      const starts = lineStarts(request.text);
      return items
        .filter((d) => d.file === request.file)
        .map((d) => runtimeToDiagnostic(request.text, d, check.id, starts));
    },
  };
}
