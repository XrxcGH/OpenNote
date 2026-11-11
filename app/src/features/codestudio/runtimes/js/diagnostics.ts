// QuickJS errors as RuntimeDiagnostic (DESIGN 4.6). The runtime prints an uncaught error as its "Name: message" line
// followed by QuickJS's stack, whose frames read "    at f (main.js:3:7)", or "    at main.js:3:7" for a syntax
// error. The diagnostic goes on the first frame in a project file, so a frame of the loader or the test API is
// skipped. A syntax error Sucrase finds is printed the same way, with one frame.
//
// A project path may hold spaces and parentheses ("my file.ts", "main (1).js"). So a place is found from its end.
// That is ":line:column", and before it the longest project path that ends there.

import type { DiagnosticMapper, RunFile, RuntimeDiagnostic } from '../../contracts/run';

const HEADER = /^(?<kind>[A-Za-z_$][\w$]*): (?<message>.*)$/;
/** A name that starts a new error, not a line of the last one's message such as "Received: 1". */
const ERROR_NAME = /(?:Error|Exception)$/;
const FRAME_START = /^\s+at /;
const FRAME_END = /:(\d+)(?::(\d+))?\)?\s*$/;
const INLINE_END = /:(\d+):(\d+)\)\s*$/;

/** How many diagnostics one run may report, as in run/diagnostics.ts. */
const MAX = 100;

type Place = { file: string; line: number; column?: number };

/** The longest project path that `before` ends with, standing after one of `starts`. */
export function pathAtEnd(before: string, files: readonly RunFile[], starts: string): RunFile | null {
  let best: RunFile | null = null;
  for (const file of files) {
    if (!before.endsWith(file.path)) continue;
    const ahead = before.length - file.path.length - 1;
    if (ahead >= 0 && !starts.includes(before[ahead]!)) continue;
    if (!best || file.path.length > best.path.length) best = file;
  }
  return best;
}

function placeIn(file: RunFile, lineText: string, columnText: string | undefined): Place | null {
  const line = Number(lineText);
  if (!Number.isInteger(line) || line < 1) return null;
  const column = Number(columnText);
  return {
    file: file.path,
    line: Math.min(line, file.text.split('\n').length),
    ...(Number.isInteger(column) && column >= 1 ? { column } : {}),
  };
}

function framePlace(text: string, files: readonly RunFile[]): Place | null {
  if (!FRAME_START.test(text)) return null;
  const end = FRAME_END.exec(text);
  if (!end) return null;
  const file = pathAtEnd(text.slice(0, end.index), files, ' (');
  return file ? placeIn(file, end[1]!, end[2]) : null;
}

/** "... (util.ts:9:5)" at the end of a line: the place, and where its "(" starts. */
function inlineAt(text: string, files: readonly RunFile[]): { place: Place; index: number } | null {
  const end = INLINE_END.exec(text);
  if (!end) return null;
  const before = text.slice(0, end.index);
  const file = pathAtEnd(before, files, '(');
  const place = file ? placeIn(file, end[1]!, end[2]) : null;
  return place && file ? { place, index: before.length - file.path.length - 1 } : null;
}

/** The first frame of `stack` in a project file, as a place. */
export function firstProjectFrame(stack: string, files: readonly RunFile[]): Place | null {
  for (const text of stack.split('\n')) {
    const place = framePlace(text, files);
    if (place) return place;
  }
  return null;
}

/** The place a message names at the end of one of its lines, "... (util.ts:9:5)", when that is a project file. */
export function inlinePlace(message: string, files: readonly RunFile[]): Place | null {
  for (const text of message.split('\n')) {
    const found = inlineAt(text, files);
    if (found) return found.place;
  }
  return null;
}

export const quickjsMapper: DiagnosticMapper = {
  map(errorText, files) {
    const found: RuntimeDiagnostic[] = [];
    let header: { kind: string; message: string } | null = null;
    for (const text of errorText.split('\n')) {
      const head = /^\s/.test(text) ? undefined : HEADER.exec(text)?.groups;
      // A header-shaped line inside a message ("Expected: 2") belongs to the error above it.
      if (head && (!header || ERROR_NAME.test(head.kind ?? ''))) {
        header = { kind: head.kind ?? 'Error', message: head.message ?? '' };
        // A syntax error in an imported file names its place at the end of the message: "... (util.ts:9:5)".
        const inline = inlineAt(header.message, files);
        if (!inline) continue;
        found.push({ ...inline.place, message: header.message.slice(0, inline.index).trimEnd(), kind: header.kind });
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
