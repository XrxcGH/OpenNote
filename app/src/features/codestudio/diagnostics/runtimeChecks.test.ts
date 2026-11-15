// Python's engine check (layer L-c) with the real Pyodide in Node: compile() marks a syntax error at its line, good
// code gets no mark, and a missing pack gives no marks instead of an error.

import { fileURLToPath } from 'node:url';
import { loadPyodide } from 'pyodide';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeAdapter } from '../contracts';
import { pyodideAdapter, type LoadPyodide } from '../runtimes/python/pyodide';
import { engineChecks, engineProvider } from './engine';
import { lineAt, lineStarts } from './text';
import { pythonEngineCheck, registerRuntimeChecks } from './runtimeChecks';

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

  it('registers the Python check and removes it again', () => {
    const off = registerRuntimeChecks(() => Promise.resolve(full));
    expect(engineChecks().map((check) => [check.id, check.languages])).toEqual([['pyodide', ['python']]]);
    off();
    expect(engineChecks()).toEqual([]);
  });
});
