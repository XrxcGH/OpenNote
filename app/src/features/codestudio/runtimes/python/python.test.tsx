// Both Python runtimes in a real browser, in a real run worker after lockdown (DESIGN 4.8).
// - Quick Python runs through the app's own run worker (run/worker.ts and run/adapters.ts).
// - Full Python runs through fixtures/worker.ts, with the same protocol and adapter. It loads Pyodide from the test
//   server, since the pack scheme exists only in the app.
//
// Sandbox escapes: the js module has no fetch, and pyodide.http.pyfetch fails. Files outside the project and the
// runtime's own library are absent. The project mount is the only folder with the program's files. Lockdown is the
// boundary: a JavaScript object that full Python still reaches past the cut-off has no fetch, eval, postMessage, or
// timers, and code from text is refused.
//
// Run ends: output printed before an endless loop reaches the page, and an exit code past 32 bits ends the run at
// once. Asyncio runs without the page's timers. Interactive input says it is not available.

// checks-disable-file modifiability: one describe block per feature
import { describe, expect, it, vi } from 'vitest';
import type { RunFile, RuntimeDiagnostic, RuntimeId } from '../../contracts/run';
import { RunHost, createRunWorker, fromWorker } from '../../run/host';
import type { RunOrder } from '../../run/host';
import { RUN_LIMITS } from '../../run/protocol';
import { REACH, REACH_HELD } from './fixtures/reach';

// Loading Pyodide in a worker takes seconds, more on a loaded machine; the test server also transforms its loader.
vi.setConfig({ testTimeout: 180_000 });

const LIMITS = { ...RUN_LIMITS, loadMs: 120_000 };

const createWorker = (runtime: RuntimeId) =>
  runtime === 'python-full'
    ? fromWorker(new Worker(new URL('./fixtures/worker.ts', import.meta.url), { type: 'module', name: 'test-python' }))
    : createRunWorker(runtime);

interface More {
  stdin?: string;
  args?: string[];
  timeMs?: number;
  interactive?: boolean;
}

async function run(runtime: RuntimeId, files: RunFile[], more: More = {}) {
  const limits = { ...LIMITS, ...(more.timeMs ? { timeMs: more.timeMs } : {}) };
  const runs = new RunHost({ createWorker, limits });
  const order: RunOrder = {
    runtime,
    files,
    main: files[0]!.path,
    args: more.args ?? [],
    stdin: { mode: more.interactive ? 'interactive' : 'prefilled', text: more.stdin ?? '' },
    limits,
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

// After REACH (fixtures/reach.ts), the network from Python's side.
const NETWORK = lines(
  'import socket',
  'try:',
  '    socket.create_connection(("example.com", 80), timeout=1)',
  '    print("socket: connected")',
  'except OSError:',
  '    print("socket: refused")',
  'from urllib.request import urlopen',
  'try:',
  '    urlopen("http://example.com/", timeout=1)',
  '    print("urlopen: read")',
  'except Exception:',
  '    print("urlopen: refused")',
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

  it('lockdown is the boundary: the program reaches no JavaScript value, nor any way to make one', async () => {
    const ran = await run('python-full', [{ path: 'main.py', text: REACH + NETWORK }]);
    expect([ran.status, ran.err]).toEqual(['ok', '']);
    expect(ran.out).toBe(REACH_HELD + lines('socket: refused', 'urlopen: refused'));
  });

  it('runs no code from text through ctypes, and the run says so in its own words', async () => {
    const program = lines(
      'import ctypes',
      'try:',
      '    print("eval:", ctypes.CDLL(None).emscripten_run_script_int(b"6*7"), flush=True)',
      'except Exception as e:',
      '    print("eval:", type(e).__name__, flush=True)',
    );
    const ran = await run('python-full', [{ path: 'main.py', text: program }]);
    expect(ran.out).not.toContain('eval: 42');
    // Whatever ends the run, its message is the app's text or a Python error name, never the runtime's raw text.
    expect(ran.message).not.toMatch(/console|not defined|Program terminated/);
  });

  it('gives os._exit its exit code', async () => {
    const three = await run('python-full', [
      { path: 'main.py', text: 'import os\nprint("a", flush=True)\nos._exit(3)\n' },
    ]);
    expect([three.status, three.exitCode, three.out]).toEqual(['error', 3, 'a\n']);
    const zero = await run('python-full', [{ path: 'main.py', text: 'import os\nos._exit(0)\n' }]);
    expect([zero.status, zero.exitCode, zero.message]).toEqual(['ok', 0, '']);
  });

  it('runs asyncio with sleep and gather after lockdown', async () => {
    const program = lines(
      'import asyncio',
      'async def job(name, delay):',
      '    await asyncio.sleep(delay)',
      '    print(name, "done")',
      '    return name',
      'async def main():',
      '    return await asyncio.gather(job("a", 0.05), job("b", 0.01))',
      'print(asyncio.run(main()))',
    );
    const ran = await run('python-full', [{ path: 'main.py', text: program }]);
    expect([ran.status, ran.err]).toEqual(['ok', '']);
    expect(ran.out).toBe(lines('b done', 'a done', "['a', 'b']"));
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

describe.each(['python-quick', 'python-full'] as const)('how a run of %s ends', (runtime) => {
  it('shows what the program printed before an endless loop, and ends with "time"', async () => {
    const program = lines('print("before the loop")', 'while True:', '    pass');
    const ran = await run(runtime, [{ path: 'main.py', text: program }], { timeMs: 3_000 });
    expect([ran.status, ran.out]).toEqual(['time', 'before the loop\n']);
  });

  it('ends at once on an exit code past 32 bits, and keeps the written files', async () => {
    const program = lines('import sys', 'open("o.txt", "w").write("x")', 'sys.exit(2**40)');
    const ran = await run(runtime, [{ path: 'main.py', text: program }]);
    expect([ran.status, ran.exitCode, ran.err]).toEqual(['error', 2 ** 31 - 1, '']);
    expect(ran.written).toEqual([{ path: 'o.txt', text: 'x' }]);
  });

  it('says interactive input is not available, and reads the input box', async () => {
    const program = 'print(input())\n';
    const ran = await run(runtime, [{ path: 'main.py', text: program }], { stdin: 'hi\n', interactive: true });
    expect([ran.status, ran.out]).toEqual(['ok', 'hi\n']);
    expect(ran.notes).toContain('interactive-unavailable');
  });

  // The limit is 64 MiB: 1 MiB blocks stop with MemoryError before 66, within the time limit.
  it('stops a program at the memory limit', async () => {
    const program = lines(
      'blocks = []',
      'try:',
      '    for _ in range(300):',
      '        blocks.append(bytearray(1024 * 1024))',
      'except MemoryError:',
      '    pass',
      'n = len(blocks)',
      'blocks = None',
      'print(n)',
    );
    const ran = await run(runtime, [{ path: 'main.py', text: program }]);
    expect([ran.status, ran.err]).toEqual(['ok', '']);
    expect(Number(ran.out)).toBeGreaterThan(0);
    expect(Number(ran.out)).toBeLessThan(66);
  });

  it('stops a file that grows past the memory limit with ENOSPC', async () => {
    const program = lines(
      'n = 0',
      'chunk = "x" * (1024 * 1024)',
      'try:',
      '    with open("big.txt", "w") as f:',
      '        for _ in range(400):',
      '            f.write(chunk)',
      '            f.flush()',
      '            n += 1',
      'except OSError as e:',
      '    print("refused", e.errno)',
      'print(n)',
    );
    const ran = await run(runtime, [{ path: 'main.py', text: program }]);
    expect([ran.status, ran.err]).toEqual(['ok', '']);
    const [refused, n] = ran.out.split('\n');
    expect(refused).toBe('refused 51');
    expect(Number(n)).toBeLessThanOrEqual(64);
  });

  it('runs main.py next to project files named random.py, io.py, and json.py', async () => {
    const files = [
      { path: 'main.py', text: 'print("main")\nraise ValueError("bad")\n' },
      { path: 'random.py', text: 'print("project random")\n' },
      { path: 'io.py', text: 'print("project io")\n' },
      { path: 'json.py', text: 'print("project json")\n' },
    ];
    const ran = await run(runtime, files);
    expect([ran.status, ran.out]).toEqual(['error', 'main\n']);
    expect(ran.err).toContain('ValueError: bad');
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
