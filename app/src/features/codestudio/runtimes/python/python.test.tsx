// Both Python runtimes in a real browser, in a real run worker after lockdown (DESIGN 4.8).
// - Quick Python runs through the app's own run worker (run/worker.ts and run/adapters.ts).
// - Full Python runs through fixtures/worker.ts, with the same protocol and adapter. It loads Pyodide from the test
//   server, since the pack scheme exists only in the app.
//
// Sandbox escapes: the js module has no fetch, and pyodide.http.pyfetch fails. Files outside the project and the
// runtime's own library are absent. The project mount is the only folder with the program's files.

// checks-disable-file modifiability: one describe block per feature
import { describe, expect, it, vi } from 'vitest';
import type { RunFile, RuntimeDiagnostic, RuntimeId } from '../../contracts/run';
import { RunHost, createRunWorker, fromWorker } from '../../run/host';
import type { RunOrder } from '../../run/host';
import { RUN_LIMITS } from '../../run/protocol';

// Loading Pyodide in a worker takes seconds, more on a loaded machine; the test server also transforms its loader.
vi.setConfig({ testTimeout: 180_000 });

const LIMITS = { ...RUN_LIMITS, loadMs: 120_000 };

const createWorker = (runtime: RuntimeId) =>
  runtime === 'python-full'
    ? fromWorker(new Worker(new URL('./fixtures/worker.ts', import.meta.url), { type: 'module', name: 'test-python' }))
    : createRunWorker(runtime);

async function run(runtime: RuntimeId, files: RunFile[], more: { stdin?: string; args?: string[] } = {}) {
  const runs = new RunHost({ createWorker, limits: LIMITS });
  const order: RunOrder = {
    runtime,
    files,
    main: files[0]!.path,
    args: more.args ?? [],
    stdin: { mode: 'prefilled', text: more.stdin ?? '' },
    limits: LIMITS,
    seed: 1,
  };
  let out = '';
  let err = '';
  const diagnostics: RuntimeDiagnostic[] = [];
  const handle = runs.run(order, {
    onOutput: (stream, text) => (stream === 'out' ? (out += text) : (err += text)),
    onDiagnostics: (items) => diagnostics.push(...items),
  });
  const done = await handle.done;
  runs.dispose();
  return { ...done, out, err, diagnostics };
}

const lines = (...text: string[]) => text.join('\n') + '\n';

const ESCAPES = lines(
  'import os',
  'for name in ["js", "pyodide.ffi", "pyodide.http", "pyodide_js", "_pyodide_core"]:',
  '    try:',
  '        __import__(name)',
  '        print(name, "imported")',
  '    except ImportError:',
  '        print(name, "refused")',
  'try:',
  '    import pyodide.http',
  '    pyodide.http.pyfetch("https://example.com/")',
  '    print("pyfetch ran")',
  'except Exception as e:',
  '    print("pyfetch", type(e).__name__)',
  'for path in ["/etc/passwd", "../outside.txt", "/project/../etc/hosts"]:',
  '    try:',
  '        open(path).read()',
  '        print(path, "read")',
  '    except OSError as e:',
  '        print(path, type(e).__name__)',
  'print(sorted(os.listdir(".")))',
);

describe('full Python in the run worker', () => {
  it('cannot reach fetch, pyfetch, or files outside the project', async () => {
    const ran = await run('python-full', [
      { path: 'main.py', text: ESCAPES },
      { path: 'data.txt', text: 'x' },
    ]);
    expect([ran.status, ran.message, ran.err]).toEqual(['ok', '', '']);
    expect(ran.out).toBe(
      lines(
        'js refused',
        'pyodide.ffi refused',
        'pyodide.http refused',
        'pyodide_js refused',
        '_pyodide_core refused',
        'pyfetch ModuleNotFoundError',
        '/etc/passwd FileNotFoundError',
        '../outside.txt FileNotFoundError',
        '/project/../etc/hosts FileNotFoundError',
        "['data.txt', 'main.py']",
      ),
    );
  });

  it('has no JavaScript left to call, even through objects loaded before the cut', async () => {
    const program = lines(
      'import sys',
      'found = [m for m in sys.modules if m.split(".")[0] in ("js", "pyodide_js", "pyodide", "_pyodide")]',
      'print(found)',
      'import asyncio',
      'loop_module = type(asyncio.get_event_loop_policy()).__module__',
      'print(loop_module.split(".")[0] in sys.modules)',
    );
    const ran = await run('python-full', [{ path: 'main.py', text: program }]);
    expect(ran.out).toBe('[]\nFalse\n');
  });

  it('runs a project end to end: a module, input, arguments, a diagnostic, the version, a written file', async () => {
    const ran = await run(
      'python-full',
      [
        {
          path: 'main.py',
          text: lines(
            'import sys, util',
            'print(sys.argv[1:], util.twice(input()))',
            'open("out.txt", "w").write("ok")',
            'util.boom()',
          ),
        },
        { path: 'util.py', text: lines('def twice(s):', '    return s * 2', 'def boom():', '    return 1 / 0') },
      ],
      { stdin: 'ab\n', args: ['x'] },
    );
    expect(ran.out).toBe("['x'] abab\n");
    expect(ran.status).toBe('error');
    expect(ran.message).toBe('ZeroDivisionError');
    expect(ran.version).toBe('Python 3.14.2 (Pyodide 314.0.7)');
    expect(ran.written).toEqual([{ path: 'out.txt', text: 'ok' }]);
    expect(ran.diagnostics).toEqual([
      { file: 'util.py', line: 4, message: 'ZeroDivisionError: division by zero', kind: 'ZeroDivisionError' },
    ]);
  });
});

describe('quick Python in the app run worker', () => {
  it('runs a project end to end and cannot reach JavaScript', async () => {
    const ran = await run(
      'python-quick',
      [
        {
          path: 'main.py',
          text: lines(
            'import sys, util',
            'print(sys.argv[1:], util.twice(input()))',
            'import js',
            'print(getattr(js, "fetch", None))',
            'util.boom()',
          ),
        },
        { path: 'util.py', text: lines('def twice(s):', '    return s * 2', 'def boom():', '    return 1 // 0') },
      ],
      { stdin: 'ab\n', args: ['x'] },
    );
    expect(ran.out).toBe("['x'] abab\nNone\n");
    expect(ran.status).toBe('error');
    expect(ran.version).toBe('MicroPython 1.27.0');
    expect(ran.diagnostics).toEqual([
      { file: 'util.py', line: 4, message: 'ZeroDivisionError: divide by zero', kind: 'ZeroDivisionError' },
    ]);
  });
});
