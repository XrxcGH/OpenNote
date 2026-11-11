// Python (full): Pyodide 314.0.7 (CPython 3.14.2, MPL-2.0) behind the RuntimeAdapter contract (DESIGN 2.1). It is
// a pack (ADR 0070): the worker loads it from the opennote-pack scheme while it is warm, before lockdown, since
// lockdown takes fetch away. Then lockdown empties the global object, and the program is refused Pyodide's ways to
// JavaScript: the `js` module, `pyodide_js`, `pyodide.ffi`, `pyodide.http`, and the rest of the `pyodide` and
// `_pyodide` packages (CUT_OFF_SOURCE). The project lives in Pyodide's MEMFS, as for MicroPython.

import type { RuntimeAdapter, Stream } from '../../contracts/run';
import { packFileUrl } from '../../packs/client';
import { ALLOWANCES } from '../../run/adapters';
import { codeStudioPython } from '../../../../strings/en/codeStudio/python';
import { checkPython, runPython } from './session';
import type { EmscriptenFS, PythonEngine } from './session';
import { pythonMapper } from './traceback';

/** The pinned versions: the pack in the catalog (catalog.rs) and the dev dependency (unit tests keep them equal). */
export const PYODIDE_VERSION = '314.0.7';
export const CPYTHON_VERSION = '3.14.2';

/** The part of Pyodide's API the engine uses. */
interface PyodideWriter {
  write(buffer: Uint8Array): number;
}
export interface PyodideLike {
  FS: unknown;
  version: string;
  runPython(source: string): unknown;
  setStdout(options: PyodideWriter): void;
  setStderr(options: PyodideWriter): void;
  setStdin(options: { error: boolean }): void;
}
export type LoadPyodide = (options: { indexURL: string; fullStdLib?: boolean }) => Promise<PyodideLike>;

/**
 * Refuses the program every module that reaches JavaScript or the network, and forgets the ones already loaded,
 * so an `import` meets ModuleNotFoundError. Lockdown has already emptied the global object those modules read.
 * Pyodide keeps its own references to its internals, so its runtime still works.
 */
const CUT_OFF_SOURCE = String.raw`
def _on_cut_off():
    import sys
    roots = ('js', 'pyodide_js', 'pyodide', '_pyodide', '_pyodide_core', 'micropip', 'pyodide_http')
    for name in list(sys.modules):
        if name.split('.')[0] in roots:
            del sys.modules[name]
    class Refused:
        def find_spec(self, name, path=None, target=None):
            if name.split('.')[0] in roots:
                raise ModuleNotFoundError("No module named '" + name + "'", name=name)
            return None
    sys.meta_path.insert(0, Refused())

_on_cut_off()
del _on_cut_off
`;

/** Loads Pyodide from `indexURL` and makes it an engine. Output goes to the engine's sink. */
export async function loadPyodideEngine(load: LoadPyodide, indexURL: string): Promise<PythonEngine> {
  const pyodide = await load({ indexURL, fullStdLib: false });
  const engine: PythonEngine = {
    fs: pyodide.FS as EmscriptenFS,
    exec: (source) => {
      pyodide.runPython(source);
    },
    sink: () => undefined,
  };
  const writer = (stream: Stream): PyodideWriter => ({
    write(buffer) {
      engine.sink(stream, buffer.slice());
      return buffer.length;
    },
  });
  pyodide.setStdout(writer('out'));
  pyodide.setStderr(writer('err'));
  // Input comes from the prelude's stand-in for sys.stdin; the real one ends at once.
  pyodide.setStdin({ error: true });
  return engine;
}

/** Cuts the program off from JavaScript. The worker calls it after lockdown, before the program runs. */
export function cutOffPyodide(engine: PythonEngine): void {
  engine.exec(CUT_OFF_SOURCE);
}

/**
 * Pyodide's own code reads the global `Function` for `Function.prototype.apply` and `instanceof Function`, and
 * lockdown removes that global, since calling it makes code from text. This stand-in has the real prototype, so those
 * two still work, and it refuses to be called.
 */
export function restoreFunctionShape(scope: object = globalThis): void {
  if ('Function' in scope) return;
  const stand = function Function(): never {
    throw new EvalError('Code from text is not allowed here.');
  };
  Object.defineProperty(stand, 'prototype', { value: Object.getPrototypeOf(stand) as object, writable: false });
  Object.defineProperty(scope, 'Function', { value: stand, configurable: true, writable: false });
}

/** Imports Pyodide's loader from the pack, or says the pack is missing. */
async function loadFromPack(indexURL: string): Promise<LoadPyodide> {
  try {
    const loaded = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as { loadPyodide: LoadPyodide };
    return loaded.loadPyodide;
  } catch {
    throw new Error(codeStudioPython.fullMissing);
  }
}

/**
 * The full Python adapter. `indexURL` is the folder of Pyodide's files, ending in "/": the pack scheme in the app,
 * a test server in tests. `load` imports Pyodide's loader; by default from `indexURL`.
 */
export function pyodideAdapter(
  indexURL: string = packFileUrl('pyodide/'),
  load: () => Promise<LoadPyodide> = () => loadFromPack(indexURL),
): RuntimeAdapter {
  let engine: Promise<PythonEngine> | null = null;
  let cut = false;
  const loaded = () => (engine ??= load().then((loader) => loadPyodideEngine(loader, indexURL)));
  return {
    id: 'python-full',
    pack: 'pyodide',
    version: `Python ${CPYTHON_VERSION} (Pyodide ${PYODIDE_VERSION})`,
    allowances: ALLOWANCES['python-full'],
    diagnostics: pythonMapper,
    async load(onProgress) {
      onProgress(5);
      await loaded();
    },
    async run(request, emit, context) {
      const ready = await loaded();
      if (!cut) {
        restoreFunctionShape();
        cutOffPyodide(ready);
        cut = true;
      }
      return runPython(ready, request, emit, context);
    },
    async check(file, files) {
      return checkPython(await loaded(), file, files);
    },
  };
}
