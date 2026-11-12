// Python (quick): MicroPython's WebAssembly port (MIT, bundled, already shipped for code cells) behind the
// RuntimeAdapter contract (DESIGN 2.1). It loads in the warm worker before lockdown. Its heap may grow by the run's
// memory limit and no further (heap.ts), so a program that asks for more gets MemoryError. Input is the prefilled
// text only: the port runs synchronously, so it cannot wait for the page (DESIGN 4.4).

import { loadMicroPython } from '@micropython/micropython-webassembly-pyscript';
import type { RuntimeAdapter } from '../../contracts/run';
import { ALLOWANCES } from '../../run/adapters';
import { codeStudioPython } from '../../../../strings/en/codeStudio/python';
import { capHeap, loadWithMemory } from './heap';
import { checkPython, runPython } from './session';
import type { EmscriptenFS, PythonEngine } from './session';
import { pythonMapper } from './traceback';

/** The pinned version in package.json (a unit test keeps them equal). */
export const MICROPYTHON_VERSION = '1.27.0';

/** The runtime's tables of the JavaScript values Python holds: by number, and the number of each value. */
interface RuntimeTables {
  proxy_js_ref?: unknown[];
  proxy_js_ref_map?: Map<unknown, number>;
}

/**
 * Leaves Python no JavaScript value to use, as code cells do (codecells/sandbox/python.ts). Python reaches one only
 * through the runtime's table, where entry 0 is the global object (the js module) and every value it is given is
 * added. Entry 0 and every object or function added become one empty object, and the map from values to numbers
 * keeps nothing, so `js` and `jsffi` give nothing to call, read, or grow.
 */
export function cutOffJavaScript(tables: RuntimeTables): void {
  const table = tables.proxy_js_ref;
  if (!Array.isArray(table) || !(tables.proxy_js_ref_map instanceof Map)) {
    throw new Error(codeStudioPython.startFailed);
  }
  const inert: unknown = Object.freeze(Object.create(null));
  const isValue = (value: unknown) => (typeof value === 'object' && value !== null) || typeof value === 'function';
  table[0] = inert;
  tables.proxy_js_ref = new Proxy(table, {
    set(target, key, value: unknown) {
      return Reflect.set(target, key, typeof key === 'string' && /^\d+$/.test(key) && isValue(value) ? inert : value);
    },
  });
  tables.proxy_js_ref_map = new Map<unknown, number>();
  tables.proxy_js_ref_map.set = function (this: Map<unknown, number>) {
    return this;
  };
}

/**
 * The heap MicroPython starts with. When it is full, MicroPython adds more heap, so the run's memory limit is the cap
 * on that growth (heap.ts), not this size.
 */
const START_HEAP = 1024 * 1024;

/** Loads MicroPython with its output going to the engine's sink. `url` is the wasm file. */
export async function loadMicroPythonEngine(url: string): Promise<PythonEngine> {
  const engine: PythonEngine = {
    fs: null as unknown as EmscriptenFS,
    exec: () => undefined,
    sink: () => undefined,
  };
  const { value: python, memory } = await loadWithMemory('mp_js_init', () =>
    loadMicroPython({
      url,
      heapsize: START_HEAP,
      linebuffer: false,
      stdout: (bytes: Uint8Array) => engine.sink('out', bytes),
      stderr: (bytes: Uint8Array) => engine.sink('err', bytes),
    }),
  );
  // Without its memory there is no limit, so the runtime does not start.
  if (!memory) throw new Error(codeStudioPython.startFailed);
  // The limit counts from the top of what the runtime uses, not from the end of its memory. The memory starts with
  // free room, and the program would get it on top of the limit. A small block marks that top.
  const module = (python as unknown as { _module: { _malloc(size: number): number; _free(at: number): void } })._module;
  const top = module._malloc(1);
  module._free(top);
  engine.limitMemory = capHeap(
    (other) => other === memory,
    () => top,
  );
  cutOffJavaScript(globalThis as unknown as RuntimeTables);
  engine.fs = (python as unknown as { FS: EmscriptenFS }).FS;
  engine.exec = (source) => {
    python.runPython(source);
  };
  return engine;
}

/** The quick Python adapter. `wasmUrl` is where the worker finds micropython.wasm. */
export function microPythonAdapter(wasmUrl: () => Promise<string>): RuntimeAdapter {
  let engine: Promise<PythonEngine> | null = null;
  const loaded = () => (engine ??= wasmUrl().then((url) => loadMicroPythonEngine(url)));
  return {
    id: 'python-quick',
    version: `MicroPython ${MICROPYTHON_VERSION}`,
    allowances: ALLOWANCES['python-quick'],
    // The port runs synchronously, so it cannot wait for the page (DESIGN 4.4).
    prefilledOnly: true,
    diagnostics: pythonMapper,
    async load(onProgress) {
      onProgress(10);
      await loaded();
    },
    async run(request, emit, context) {
      return runPython(await loaded(), request, emit, context);
    },
    async check(file, files) {
      return checkPython(await loaded(), file, files);
    },
  };
}
