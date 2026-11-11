// Python tracebacks as RuntimeDiagnostic (DESIGN 4.6). CPython and MicroPython print the same frame lines,
// `  File "util.py", line 3, in f`, then the exception's own line, `NameError: name 'y' is not defined`. A syntax
// error has one frame and no "Traceback" header. The error is placed at the innermost frame in a project file, so an
// error inside util.py, called from main.py, marks util.py.

import type { DiagnosticMapper, RuntimeDiagnostic } from '../../contracts/run';
import { normalPath } from '../../run/mount';
import { HOME } from './prelude';

const FRAME = /^\s+File "(?<file>[^"]+)", line (?<line>\d+)/;
/** The exception's line: its type (possibly dotted), then an optional message. */
const EXCEPTION = /^(?<kind>[A-Za-z_][\w.]*)(?::\s?(?<message>.*))?$/;

/** A traceback's path as a project path, or null for the runtime's own files. */
function projectPath(file: string): string | null {
  const local = file.startsWith(`${HOME}/`) ? file.slice(HOME.length + 1) : file;
  return normalPath(local);
}

/** The frames of the block that ends at line `end`: the indented lines above it, up to its header. */
function framesAbove(lines: readonly string[], end: number): { file: string; line: number }[] {
  const frames: { file: string; line: number }[] = [];
  for (let at = end - 1; at >= 0; at--) {
    const text = lines[at]!;
    if (text === '' || !/^\s/.test(text)) break;
    const match = FRAME.exec(text);
    if (match?.groups) frames.unshift({ file: match.groups.file!, line: Number(match.groups.line) });
  }
  return frames;
}

export const pythonMapper: DiagnosticMapper = {
  map(errorText, files) {
    const counts = new Map(files.map((file) => [file.path, file.text.split('\n').length]));
    const lines = errorText.replace(/\r\n?/g, '\n').split('\n');
    for (let at = lines.length - 1; at > 0; at--) {
      const match = EXCEPTION.exec(lines[at]!);
      if (!match?.groups) continue;
      const frames = framesAbove(lines, at);
      if (frames.length === 0) continue;
      for (let index = frames.length - 1; index >= 0; index--) {
        const frame = frames[index]!;
        const file = projectPath(frame.file);
        const last = file === null ? undefined : counts.get(file);
        if (file === null || last === undefined || frame.line < 1) continue;
        const found: RuntimeDiagnostic = {
          file,
          line: Math.min(frame.line, last),
          message: lines[at]!.trim(),
          kind: match.groups.kind!,
        };
        return [found];
      }
      return [];
    }
    return [];
  },
};
