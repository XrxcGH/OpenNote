// QuickJS errors as RuntimeDiagnostic (DESIGN 4.6). The runtime prints an uncaught error as its "Name: message" line
// followed by QuickJS's stack, whose frames read "    at f (main.js:3:7)", or "    at main.js:3:7" for a syntax
// error. The diagnostic goes on the first frame in a project file, so a frame of the loader or the test API is
// skipped. A syntax error Sucrase finds is printed the same way, with one frame.

import type { DiagnosticMapper, RunFile, RuntimeDiagnostic } from '../../contracts/run';
import { normalPath } from '../../run/mount';

const HEADER = /^(?<kind>[A-Za-z_$][\w$]*): (?<message>.*)$/;
const INLINE = /\([^\s()]+:\d+:\d+\)$/;
const FRAME = /^\s+at (?:.*? \()?(?<file>[^\s()]+?):(?<line>\d+)(?::(?<column>\d+))?\)?\s*$/;

/** How many diagnostics one run may report, as in run/diagnostics.ts. */
const MAX = 100;

/** The first frame of `stack` in a project file, as a place. */
export function firstProjectFrame(
  stack: string,
  files: readonly RunFile[],
): { file: string; line: number; column?: number } | null {
  for (const text of stack.split('\n')) {
    const place = framePlace(text, files);
    if (place) return place;
  }
  return null;
}

/** The place a message names at its end, "... (util.ts:9:5)", when that is a project file. */
export function inlinePlace(
  message: string,
  files: readonly RunFile[],
): { file: string; line: number; column?: number } | null {
  const inline = INLINE.exec(message.split('\n').find((line) => INLINE.test(line)) ?? '');
  return inline ? framePlace(`    at ${inline[0].slice(1, -1)}`, files) : null;
}

function framePlace(text: string, files: readonly RunFile[]): { file: string; line: number; column?: number } | null {
  const groups = FRAME.exec(text)?.groups;
  if (!groups) return null;
  const file = normalPath(groups.file ?? '');
  const found = file === null ? undefined : files.find((each) => each.path === file);
  const line = Number(groups.line);
  if (!found || !Number.isInteger(line) || line < 1) return null;
  const column = Number(groups.column);
  return {
    file: found.path,
    line: Math.min(line, found.text.split('\n').length),
    ...(Number.isInteger(column) && column >= 1 ? { column } : {}),
  };
}

export const quickjsMapper: DiagnosticMapper = {
  map(errorText, files) {
    const found: RuntimeDiagnostic[] = [];
    let header: { kind: string; message: string } | null = null;
    for (const text of errorText.split('\n')) {
      const head = HEADER.exec(text)?.groups;
      if (head && !/^\s/.test(text)) {
        header = { kind: head.kind ?? 'Error', message: head.message ?? '' };
        // A syntax error in an imported file names its place at the end of the message: "... (util.ts:9:5)".
        const inline = INLINE.exec(header.message);
        const place = inline ? framePlace(`    at ${inline[0].slice(1, -1)}`, files) : null;
        if (!place) continue;
        found.push({ ...place, message: header.message.slice(0, inline!.index).trimEnd(), kind: header.kind });
        header = null;
        if (found.length >= MAX) break;
        continue;
      }
      const place = header ? framePlace(text, files) : null;
      if (!header || !place) continue;
      found.push({ ...place, message: header.message, kind: header.kind });
      header = null;
      if (found.length >= MAX) break;
    }
    return found;
  },
};
