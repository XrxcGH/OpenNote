// Python's engine check (layer L-c) with the real Pyodide in Node: compile() marks a syntax error at its line, good
// code gets no mark, and a missing pack gives no marks instead of an error. SQL and Lua run their real engines too
// (SQLite and wasmoon), and every runtime's check is registered.

import { fileURLToPath } from 'node:url';
import { loadPyodide } from 'pyodide';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeAdapter } from '../contracts';
import { pyodideAdapter, type LoadPyodide } from '../runtimes/python/pyodide';
import { engineChecks, engineProvider } from './engine';
import { lineAt, lineStarts } from './text';
import { luaEngineCheck, pythonEngineCheck, registerRuntimeChecks, sqlEngineCheck } from './runtimeChecks';

// In Node a `?url` import of a WebAssembly file gives the dev server's /@fs/ address, which Node cannot open.
const nodeModule = (path: string) => async () => {
  const { fileURLToPath: toPath } = await import('node:url');
  return { default: toPath(new URL(`../../../../../node_modules/${path}`, import.meta.url)) };
};
vi.mock('wasmoon/dist/glue.wasm?url', () => nodeModule('wasmoon/dist/glue.wasm')());
vi.mock('@sqlite.org/sqlite-wasm/sqlite3.wasm?url', () => nodeModule('@sqlite.org/sqlite-wasm/dist/sqlite3.wasm')());

// Pyodide takes seconds to start on a loaded machine.
vi.setConfig({ testTimeout: 180_000 });

const PYODIDE_DIR = fileURLToPath(new URL('../../../../../node_modules/pyodide/', import.meta.url));
const full = pyodideAdapter(PYODIDE_DIR, () => Promise.resolve(loadPyodide as unknown as LoadPyodide));

const request = (text: string) => ({ file: 'main.py', version: 1, language: 'python' as const, text });

describe('runtime engine checks', () => {
  it('marks a Python syntax error at its line through full Python, and good code not at all', async () => {
    const provider = engineProvider(pythonEngineCheck(() => Promise.resolve(full)));
    expect(provider).toMatchObject({ id: 'pyodide', layer: 'engine', languages: ['python'] });
    const bad = 'x = 1\nif x\n    print(x)\n';
    const marks = await provider.run(request(bad));
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ file: 'main.py', severity: 'error', source: 'pyodide' });
    expect(marks[0]!.message).toContain("expected ':'");
    expect(lineAt(lineStarts(bad), marks[0]!.from)).toBe(2);
    expect(await provider.run(request('x = 1\nif x:\n    print(x)\n'))).toEqual([]);
  });

  it('gives no marks when the full Python pack is missing', async () => {
    const missing = () => Promise.reject(new Error('pack missing'));
    expect(await engineProvider(pythonEngineCheck(missing)).run(request('if x\n'))).toEqual([]);
    const failing: RuntimeAdapter = {
      id: 'python-full',
      load: async () => {},
      run: () => Promise.reject(new Error('not run here')),
      check: () => Promise.reject(new Error('runtime stopped')),
    };
    expect(await engineProvider(pythonEngineCheck(() => Promise.resolve(failing))).run(request('if x\n'))).toEqual([]);
  });

  it('marks an SQL statement SQLite cannot prepare against the project schema', async () => {
    const provider = engineProvider(sqlEngineCheck());
    const schema = { path: 'schema.sql', text: 'CREATE TABLE people (name TEXT);\n' };
    const bad = 'SELECT name FROM people;\nSELECT age FROM people;\n';
    const marks = await provider.run({ file: 'query.sql', version: 1, language: 'sql', text: bad, files: [schema] });
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ severity: 'error', source: 'sqlite' });
    expect(marks[0]!.message).toContain('age');
    expect(lineAt(lineStarts(bad), marks[0]!.from)).toBe(2);
  });

  it('marks a Lua syntax error through wasmoon, and good code not at all', async () => {
    const provider = engineProvider(luaEngineCheck());
    const bad = 'local x = 1\nif x then\n';
    const marks = await provider.run({ file: 'main.lua', version: 1, language: 'lua', text: bad });
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ severity: 'error', source: 'wasmoon' });
    expect(await provider.run({ file: 'main.lua', version: 1, language: 'lua', text: 'print(1)\n' })).toEqual([]);
  });

  it('registers the Python, SQL, Lua, and clang checks and removes them again', () => {
    const off = registerRuntimeChecks(() => Promise.resolve(full));
    expect(engineChecks().map((check) => [check.id, check.languages, check.layer])).toEqual([
      ['pyodide', ['python'], 'engine'],
      ['sqlite', ['sql'], 'engine'],
      ['wasmoon', ['lua'], 'engine'],
      ['clang', ['c', 'cpp'], 'compiler'],
    ]);
    off();
    expect(engineChecks()).toEqual([]);
  });
});
