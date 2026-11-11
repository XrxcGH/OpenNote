// The two Python runtimes as the run worker loads them (run/adapters.ts): quick (MicroPython, bundled) and full
// (Pyodide, from its pack).
import wasmUrl from '@micropython/micropython-webassembly-pyscript/micropython.wasm?url';
import { microPythonAdapter } from './micropython';
import { pyodideAdapter } from './pyodide';

export const pythonQuickAdapter = microPythonAdapter(() => Promise.resolve(wasmUrl));
export const pythonFullAdapter = pyodideAdapter();
