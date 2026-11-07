// Mapping a runtime's error text to project lines (DESIGN 4.6). Each adapter implements DiagnosticMapper; most do it
// with patternMapper and one pattern per error form. The worker runs the mapper over the run's error output and
// sends one `diagnostic` message, so the editor can mark the lines and the console can link them.

import type { DiagnosticMapper, RunFile, RuntimeDiagnostic } from '../contracts/run';
import { normalPath } from './mount';
import { MESSAGE_LIMITS } from './protocol';

/**
 * One error form. The regular expression must have the named groups `file` and `line`; `column`, `message`, and
 * `kind` are read when present. `kind` falls back to `fallbackKind`.
 */
export interface ErrorPattern {
  pattern: RegExp;
  fallbackKind: string;
}

/** How many diagnostics one run may report. */
export const MAX_DIAGNOSTICS = 100;

function toLine(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const value = Number.parseInt(text, 10);
  return Number.isInteger(value) && value >= 1 ? value : undefined;
}

/**
 * A mapper over `patterns`. Only paths that name a project file count, so a runtime's own frames are skipped. A line
 * past the end of its file is moved to the last line. Repeats of the same place and message are reported once.
 */
export function patternMapper(patterns: readonly ErrorPattern[]): DiagnosticMapper {
  return {
    map(errorText, files) {
      const lines = new Map(files.map((file) => [file.path, file.text.split('\n').length]));
      const found: RuntimeDiagnostic[] = [];
      const seen = new Set<string>();
      for (const { pattern, fallbackKind } of patterns) {
        const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
        for (const match of errorText.matchAll(global)) {
          const groups = match.groups ?? {};
          const file = normalPath(groups.file ?? '');
          const line = toLine(groups.line);
          const last = file === null ? undefined : lines.get(file);
          if (file === null || line === undefined || last === undefined) continue;
          const column = toLine(groups.column);
          const message = (groups.message ?? match[0]).trim();
          const kind = groups.kind ?? fallbackKind;
          const key = `${file}:${line}:${column ?? ''}:${message}`;
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({ file, line: Math.min(line, last), ...(column ? { column } : {}), message, kind });
          if (found.length >= MAX_DIAGNOSTICS) return found;
        }
      }
      return found;
    },
  };
}

/**
 * Runs an adapter's mapper safely: a mapper that throws reports nothing. Each message and kind is cut to the
 * protocol's cap, because the page drops a whole diagnostic message when one item is over it.
 */
export function mapDiagnostics(
  mapper: DiagnosticMapper | undefined,
  errorText: string,
  files: readonly RunFile[],
): RuntimeDiagnostic[] {
  if (!mapper || errorText === '') return [];
  try {
    return mapper
      .map(errorText, files)
      .slice(0, MAX_DIAGNOSTICS)
      .map((item) => ({
        ...item,
        message: item.message.slice(0, MESSAGE_LIMITS.shortChars),
        kind: item.kind.slice(0, MESSAGE_LIMITS.shortChars),
      }));
  } catch {
    return [];
  }
}
