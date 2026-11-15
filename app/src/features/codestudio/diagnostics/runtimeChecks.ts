// The engine checks of the runtimes in this build (layer L-c, DESIGN 6.1). Python's check is compile() in full
// Python (Pyodide, so CPython's own parser): quick Python (MicroPython) does not know every CPython form, so it would
// mark good code. The runtime loads on the first check, not before. Without the full Python pack the check finds
// nothing, and the Lezer and OpenNote layers still run. The studio calls registerRuntimeChecks once, next to
// createDiagnostics.

import type { RuntimeAdapter } from '../contracts';
import { fromRuntimeAdapter, registerEngineCheck, type EngineCheck } from './engine';

const loadFullPython = (): Promise<RuntimeAdapter> =>
  import('../runtimes/python').then((loaded) => loaded.pythonFullAdapter);

/** Python's engine check. `load` gives the adapter whose `check` runs compile(); by default full Python. */
export function pythonEngineCheck(load: () => Promise<RuntimeAdapter> = loadFullPython): EngineCheck {
  return {
    id: 'pyodide',
    layer: 'engine',
    languages: ['python'],
    async check(file, files) {
      try {
        const check = fromRuntimeAdapter(await load(), ['python'], 'pyodide');
        return check ? await check.check(file, files) : [];
      } catch {
        // A missing pack, or a runtime that failed to start: no engine marks.
        return [];
      }
    },
  };
}

/** Registers every runtime's engine check. Returns the way to remove them. */
export function registerRuntimeChecks(load?: () => Promise<RuntimeAdapter>): () => void {
  const removers = [registerEngineCheck(pythonEngineCheck(load))];
  return () => removers.forEach((remove) => remove());
}
