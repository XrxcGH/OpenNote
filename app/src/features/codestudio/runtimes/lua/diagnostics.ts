// Lua errors as editor diagnostics (DESIGN 4.6 and 6.1, layer L-c). A Lua error message starts with the chunk name
// and the line, `main.lua:3: attempt to perform arithmetic on a nil value`. The chunk name is the project path.

import type { RunFile, RuntimeDiagnostic } from '../../contracts/run';
import { patternMapper } from '../../run/diagnostics';

export const luaMapper = patternMapper([
  { pattern: /(?<file>[^:\s]+):(?<line>\d+): (?<message>(?!in )[^\n]*)/, fallbackKind: 'LuaError' },
]);

/** The diagnostics for the text `load` gave for a file that does not compile; none for null. */
export function syntaxDiagnostics(error: string | null | undefined, file: RunFile): RuntimeDiagnostic[] {
  if (!error) return [];
  const found = luaMapper.map(error, [file]).map((item) => ({ ...item, kind: 'SyntaxError' }));
  return found.length > 0 ? found : [{ file: file.path, line: 1, message: error, kind: 'SyntaxError' }];
}
