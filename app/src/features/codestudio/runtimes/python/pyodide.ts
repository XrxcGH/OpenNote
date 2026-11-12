// Python (full): Pyodide 314.0.7 (CPython 3.14.2, MPL-2.0) behind the RuntimeAdapter contract (DESIGN 2.1). It is
// a pack (ADR 0070): the worker loads it from the opennote-pack scheme while it is warm, before lockdown, since
// lockdown takes fetch away. The project lives in Pyodide's MEMFS, as for MicroPython.
//
// The boundary is lockdown. It empties the global object and refuses code from text, so a JavaScript value Python
// still reaches has nothing to call.
//
// The cut-off (CUT_OFF_SOURCE) is a second layer. It gives plain errors and takes away what Pyodide's Python side
// still holds:
// - An `import` of `js`, `pyodide_js`, `pyodide.ffi`, `pyodide.http`, or the rest of `pyodide` and `_pyodide` meets
//   ModuleNotFoundError.
// - Every JavaScript proxy Python holds is destroyed and dropped. The Pyodide API object is one of them.
// - The functions and classes that make new JavaScript values (`to_js`, `create_proxy`, `JsException`) are gone or
//   refuse.
//
// Nothing can be hidden from Python's own introspection, so the cut-off is not a wall. A program that gets past it may
// still make a JavaScript value; lockdown makes that value harmless. python.test.tsx walks all a program reaches to
// check it. The memory limit caps the WebAssembly heap and the files. A JavaScript value is not in either, so the time
// limit, which ends the worker, is what bounds it.

import type { RuntimeAdapter, Stream } from '../../contracts/run';
import { packFileUrl } from '../../packs/client';
import { ALLOWANCES } from '../../run/adapters';
import { codeStudioPython } from '../../../../strings/en/codeStudio/python';
import { capHeap } from './heap';
import { checkPython, runPython } from './session';
import type { EmscriptenFS, PythonEngine } from './session';
import { pythonMapper } from './traceback';

/** The pinned versions: the pack in the catalog (catalog.rs) and the dev dependency (unit tests keep them equal). */
export const PYODIDE_VERSION = '314.0.7';
export const CPYTHON_VERSION = '3.14.2';

/** The part of Pyodide's API the engine uses. `_module` is Emscripten's module, read for the heap's buffer. */
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
  _module?: { HEAP8?: Int8Array };
}
export type LoadPyodide = (options: { indexURL: string; fullStdLib?: boolean }) => Promise<PyodideLike>;

/**
 * Gives asyncio a plain event loop. Pyodide's own loop, and its version of asyncio.run, use the page's timers and
 * import `pyodide_js`. Lockdown and the cut-off take both away. This loop has no JavaScript and no timers: when it
 * waits, it sleeps. Nothing can wake it early, since a run has no threads, sockets, or signals.
 */
const EVENT_LOOP_SOURCE = String.raw`
def _on_event_loop():
    import asyncio, time, warnings
    from asyncio import base_events, events

    class Selector:
        def select(self, timeout=None):
            if timeout is not None and timeout > 0:
                time.sleep(timeout)
            return []
        def close(self):
            pass

    class PlainLoop(base_events.BaseEventLoop):
        def __init__(self):
            super().__init__()
            self._selector = Selector()
        def _process_events(self, event_list):
            pass
        def _write_to_self(self):
            pass

    base = getattr(events, '_BaseDefaultEventLoopPolicy', None) or events.BaseDefaultEventLoopPolicy
    class PlainPolicy(base):
        _loop_factory = PlainLoop

    PlainLoop.__module__ = PlainPolicy.__module__ = Selector.__module__ = 'asyncio'
    # Pyodide wraps asyncio.run and time.sleep for its own loop; the wrappers keep the originals.
    asyncio.run = getattr(asyncio.run, '__wrapped__', asyncio.run)
    time.sleep = getattr(time.sleep, '__wrapped__', time.sleep)
    # Pyodide marks its own loop as always running, which asyncio.run refuses.
    events._set_running_loop(None)
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', DeprecationWarning)
        asyncio.set_event_loop_policy(PlainPolicy())

_on_event_loop()
del _on_event_loop
`;

/**
 * Refuses the program every module that reaches JavaScript or the network, and forgets the ones already loaded. An
 * `import` meets ModuleNotFoundError, and Pyodide's import hook for the js modules leaves the import path.
 *
 * Then `_on_forget` drops every JavaScript proxy the garbage collector can see from what holds it, and destroys it.
 * The built-in functions of `_pyodide_core` go too: from every module, and from the copy Python keeps to make the
 * module again. So the module `_imp.create_builtin` makes has none of them. Pyodide's classes that make a JavaScript
 * value from Python arguments refuse to. Pyodide's runtime keeps its own references in C, so it still works.
 *
 * This is not the boundary: lockdown is (see the top of this file).
 */
const CUT_OFF_SOURCE = String.raw`
def _on_cut_off():
    import sys, _imp
    roots = ('js', 'pyodide_js', 'pyodide', '_pyodide', '_pyodide_core', 'micropip', 'pyodide_http')
    for name in list(sys.modules):
        if name.split('.')[0] in roots:
            del sys.modules[name]
    for finder in list(sys.meta_path):
        held = getattr(finder, 'jsproxies', None)
        if held is not None:
            held.clear()
            sys.meta_path.remove(finder)
    class Refused:
        def find_spec(self, name, path=None, target=None):
            if name.split('.')[0] in roots:
                raise ModuleNotFoundError("No module named '" + name + "'", name=name)
            return None
    sys.meta_path.insert(0, Refused())
    create = _imp.create_builtin
    def create_builtin(spec):
        if getattr(spec, 'name', '').split('.')[0] in roots:
            raise ModuleNotFoundError("No module named '" + spec.name + "'", name=spec.name)
        return create(spec)
    _imp.create_builtin = create_builtin

_on_cut_off()
del _on_cut_off

def _on_forget():
    import gc
    def is_js(value):
        try:
            return any(c.__name__ == 'JsProxy' for c in type(value).__mro__)
        except Exception:
            return False
    def makes_js(value):
        owner = getattr(value, '__self__', None)
        native = type(value).__name__ == 'builtin_function_or_method'
        return native and getattr(owner, '__name__', None) == '_pyodide_core'
    def held(value):
        return is_js(value) or makes_js(value)
    gc.collect()
    found = []
    for item in gc.get_objects():
        if held(item):
            found.append(item)
        found.extend(value for value in gc.get_referents(item) if held(value))
    done = set()
    for value in found:
        if id(value) in done:
            continue
        done.add(id(value))
        for holder in gc.get_referrers(value):
            if holder is found:
                continue
            if isinstance(holder, dict):
                for key in [key for key, item in holder.items() if item is value]:
                    del holder[key]
            elif isinstance(holder, list):
                holder[:] = [item for item in holder if item is not value]
            elif type(holder).__name__ == 'cell':
                holder.cell_contents = None
            elif isinstance(getattr(holder, '__dict__', None), dict):
                for key in [key for key, item in vars(holder).items() if item is value]:
                    try:
                        delattr(holder, key)
                    except Exception:
                        pass
        if is_js(value):
            try:
                value.destroy()
            except Exception:
                pass
    def refuse(*args, **kwargs):
        raise TypeError('JavaScript objects are not available here.')
    def classes(base, out, ids):
        for sub in type.__subclasses__(base):
            if id(sub) not in ids:
                ids.add(id(sub))
                out.append(sub)
                classes(sub, out, ids)
        return out
    for cls in classes(object, [], set()):
        if not cls.__name__.startswith('Js') or not str(cls.__module__).startswith(('pyodide', '_pyodide')):
            continue
        for name in ('new', '_new_exc'):
            if name in vars(cls):
                try:
                    delattr(cls, name)
                except Exception:
                    pass
        if '__new__' in vars(cls):
            try:
                cls.__new__ = staticmethod(refuse)
            except Exception:
                pass
    found.clear()
    gc.collect()

_on_forget()
del _on_forget
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
    limitMemory: capHeap(
      (memory) => memory.buffer === pyodide._module?.HEAP8?.buffer,
      () => pyodide._module?.HEAP8?.buffer.byteLength ?? 0,
    ),
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
  engine.exec(EVENT_LOOP_SOURCE);
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
    // Input is the prefilled text until Pyodide's input waits for the page through JSPI (DESIGN 4.4, R2).
    prefilledOnly: true,
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
