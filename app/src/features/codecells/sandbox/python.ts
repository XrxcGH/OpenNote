// Python for code cells: MicroPython's WebAssembly port (MIT; THIRD_PARTY_NOTICES.md), bundled with the app, inside
// the sandbox worker. Its heap is fixed, so a cell that asks for more gets MemoryError. Its files live in memory only.
// MicroPython can reach JavaScript through its js module, which reads the worker's global object; that reference is
// swapped for an empty object here, and lockdown.ts empties the global itself as well.
import { loadMicroPython } from '@micropython/micropython-webassembly-pyscript';
import wasmUrl from '@micropython/micropython-webassembly-pyscript/micropython.wasm?url';
import type { Output } from './output';
import type { Limits, RunStatus } from './protocol';

export interface Ran {
  status: RunStatus;
  message: string;
}

interface PythonError {
  name: string;
  type?: string;
  message: string;
}

/** The runtime's tables of the JavaScript values Python holds: by number, and the number of each value. */
interface RuntimeTables {
  proxy_js_ref?: unknown[];
  proxy_js_ref_map?: Map<unknown, number>;
}

/**
 * Leaves Python no JavaScript value to use. Python reaches one only through the runtime's table, where entry 0 is
 * the global object (the js module) and every value it is given is added. Entry 0 becomes an empty object, and any
 * object or function added becomes that same empty object, so jsffi.to_js and friends give nothing to call, read,
 * or grow. The map from values to numbers keeps nothing either, so the values Python asked for are freed at once and
 * cannot fill the worker's memory (a worker out of memory takes the whole page down with it).
 */
function cutOffJavaScript(tables: RuntimeTables): void {
  const table = tables.proxy_js_ref;
  if (!Array.isArray(table) || !(tables.proxy_js_ref_map instanceof Map)) {
    throw new Error('The Python runtime did not start as expected.');
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

/** Loads the runtime; the returned function runs one cell's text. */
export async function preparePython(output: Output, limits: Limits): Promise<(source: string) => Ran> {
  const python = await loadMicroPython({
    url: wasmUrl,
    heapsize: limits.memoryBytes,
    linebuffer: false,
    stdout: (bytes: Uint8Array) => output.byte('out', bytes[0]!),
    stderr: (bytes: Uint8Array) => output.byte('err', bytes[0]!),
  });
  cutOffJavaScript(globalThis as unknown as RuntimeTables);
  return (source) => {
    try {
      python.runPython(source);
      return { status: 'ok', message: '' };
    } catch (caught) {
      const error = (
        typeof caught === 'object' && caught !== null ? caught : { message: String(caught) }
      ) as PythonError;
      const text = error.name === 'PythonError' ? error.message : `${error.name ?? 'Error'}: ${error.message}`;
      output.write('err', text.endsWith('\n') ? text : `${text}\n`);
      // A JavaScript error out of the runtime (such as making code from text) ends the cell like a Python error.
      return { status: error.type === 'MemoryError' ? 'memory' : 'error', message: error.type ?? error.name ?? '' };
    }
  };
}
