// The code cell sandbox in a real browser: worked problems with known answers in both languages, and the ways out a
// cell might try (network, files, the worker's globals, code from text), the time and memory limits, Stop, and the
// output limit.
import { describe, expect, it, vi } from 'vitest';
import { LIMITS } from './protocol';
import type { CodeLanguage, Limits } from './protocol';
import { runCode } from './run';
import type { RunResult } from './run';

// Each run starts a worker and a WebAssembly runtime, which a loaded machine slows.
vi.setConfig({ testTimeout: 60_000 });

const QUICK: Limits = { ...LIMITS, timeMs: 1500 };

async function run(language: CodeLanguage, source: string, limits: Limits = LIMITS) {
  let out = '';
  let err = '';
  const handle = runCode(
    language,
    source,
    (stream, text) => (stream === 'out' ? (out += text) : (err += text)),
    limits,
  );
  const result: RunResult = await handle.done;
  return { ...result, out, err };
}

const py = (source: string, limits?: Limits) => run('python', source, limits);
const js = (source: string, limits?: Limits) => run('javascript', source, limits);

describe('worked problems', () => {
  it('finds the square root of 2 with Newton’s method in Python', async () => {
    const ran = await py(
      ['x = 1.0', 'for _ in range(6):', '    x = x - (x * x - 2) / (2 * x)', 'print("%.10f" % x)'].join('\n'),
    );
    expect(ran.status).toBe('ok');
    expect(ran.out).toBe('1.4142135624\n');
  });

  it('solves textbook problems in Python', async () => {
    const ran = await py(
      [
        'import math',
        '# Projectile: 20 m/s at 45 degrees, g = 9.81 m/s^2. Range = v^2 sin(2θ) / g = 40.77 m.',
        'print("%.2f" % (20**2 * math.sin(math.radians(90)) / 9.81))',
        '# Roots of x^2 - 5x + 6 = 0 are 2 and 3.',
        'a, b, c = 1, -5, 6',
        'd = math.sqrt(b*b - 4*a*c)',
        'print(sorted([(-b - d) / (2*a), (-b + d) / (2*a)]))',
        'print(sum(range(1, 101)))',
      ].join('\n'),
    );
    expect(ran.status).toBe('ok');
    expect(ran.out).toBe('40.77\n[2.0, 3.0]\n5050\n');
  });

  it('solves textbook problems in JavaScript and shows the last value', async () => {
    const ran = await js(
      [
        '// Ideal gas: n = PV/RT for 101325 Pa, 0.0224 m^3, 273.15 K is about 1.00 mol.',
        'console.log((101325 * 0.0224 / (8.314 * 273.15)).toFixed(2));',
        'let x = 1; for (let i = 0; i < 6; i++) x -= (x * x - 2) / (2 * x);',
        'print(x.toFixed(10));',
        'Array.from({ length: 100 }, (_, i) => i + 1).reduce((a, b) => a + b, 0)',
      ].join('\n'),
    );
    expect(ran.status).toBe('ok');
    expect(ran.out).toBe('1.00\n1.4142135624\n→ 5050\n');
  });

  it('reports errors with their message', async () => {
    const python = await py('print(1)\n1 / 0');
    expect(python.status).toBe('error');
    expect(python.out).toBe('1\n');
    expect(python.err).toContain('ZeroDivisionError');
    const script = await js('null.x');
    expect(script.status).toBe('error');
    expect(script.err).toContain('TypeError');
  });
});

describe('the sandbox', () => {
  it('leaves the worker nothing of the browser after lockdown', async () => {
    const worker = new Worker(new URL('./lockdownProbe.ts', import.meta.url), { type: 'module' });
    const report = await new Promise<Record<string, unknown>>((resolve) => {
      worker.onmessage = (event: MessageEvent) => resolve(event.data as Record<string, unknown>);
    });
    worker.terminate();
    expect(report.left).toEqual([]);
    expect(report.present).toEqual([]);
    expect(report.makers).toEqual(['blocked', 'blocked', 'blocked', 'blocked']);
    expect(report.kept).toBe('objectfunctionobject');
  });

  it('gives JavaScript cells no network, timers, modules, or worker globals', async () => {
    const ran = await js(
      [
        'const names = ["fetch", "XMLHttpRequest", "WebSocket", "importScripts", "indexedDB", "caches", "navigator",',
        '  "postMessage", "setTimeout", "Worker", "self", "location", "document", "window", "__TAURI_INTERNALS__"];',
        'console.log(names.filter((name) => typeof globalThis[name] !== "undefined").join(",") || "none");',
        'console.log(typeof Function("return this")().fetch);',
        'import("https://example.com/x.js").then(() => console.log("loaded"), () => console.log("no import"));',
      ].join('\n'),
    );
    expect(ran.status).toBe('ok');
    expect(ran.out).toBe('none\nundefined\nno import\n');
  });

  it('gives Python cells no JavaScript, network, or real files', async () => {
    const ran = await py(
      [
        'import js',
        'for name in ("fetch", "Object", "postMessage", "globalThis", "Module"):',
        '    try:',
        '        getattr(js, name)',
        '        print("reached", name)',
        '    except Exception:',
        '        pass',
        'for name in ("socket", "urequests", "requests", "ssl"):',
        '    try:',
        '        __import__(name)',
        '        print("imported", name)',
        '    except ImportError:',
        '        pass',
        'try:',
        '    open("C:/Windows/win.ini").read()',
        '    print("read a file")',
        'except OSError:',
        '    pass',
        'print("done")',
      ].join('\n'),
    );
    expect(ran.out).toBe('done\n');
    expect(ran.status).toBe('ok');
  });

  it('gives Python cells no JavaScript values to call, read, or grow', async () => {
    const made = await py(
      ['import jsffi', 'f = jsffi.to_js({}).constructor.constructor("return globalThis")', 'print("made", f)'].join(
        '\n',
      ),
    );
    expect(made.status).toBe('error');
    expect(made.out).toBe('');
    expect(made.err).toContain('AttributeError');
    // Once, this filled the worker's JavaScript memory and took the whole page down.
    const grown = await py(
      ['import jsffi', 'keep = []', 'while True:', '    keep.append(jsffi.to_js(list(range(100000))))'].join('\n'),
      QUICK,
    );
    expect(['memory', 'time']).toContain(grown.status);
    const array = await py('import jsffi\nA = jsffi.to_js([0]).constructor\nA(2**24).fill(1.5)');
    expect(array.status).toBe('error');
  });

  it('stops a cell at the time limit', async () => {
    expect((await py('while True:\n    pass', QUICK)).status).toBe('time');
    expect((await js('while (true) {}', QUICK)).status).toBe('time');
  });

  it('stops a cell at the memory limit', async () => {
    expect((await py('x = bytearray(200 * 1024 * 1024)')).status).toBe('memory');
    expect((await js('const a = []; while (true) a.push(new Array(1e5).fill(1));')).status).toBe('memory');
  });

  it('stops a cell when Stop is pressed', async () => {
    const handle = runCode('python', 'print("go")\nwhile True:\n    pass', () => undefined);
    setTimeout(() => handle.stop(), 2500);
    expect((await handle.done).status).toBe('stopped');
  });

  it('keeps only the output limit of text', async () => {
    const ran = await py('for i in range(100000):\n    print("line", i)', { ...LIMITS, outputChars: 1000 });
    expect(ran.status).toBe('ok');
    expect(ran.truncated).toBe(true);
    expect(ran.out.length).toBeLessThanOrEqual(1000);
  });

  it('says the output was cut when the time limit ends a run that printed past the limit', async () => {
    const ran = await py('while True:\n    print("x" * 1000)', { ...QUICK, outputChars: 5000 });
    expect(ran.status).toBe('time');
    expect(ran.truncated).toBe(true);
    const jsRan = await js('while (true) console.log("x".repeat(1000));', { ...QUICK, outputChars: 5000 });
    expect(jsRan.status).toBe('time');
    expect(jsRan.truncated).toBe(true);
  });

  it('reports deep recursion in JavaScript as an error in the cell', async () => {
    const ran = await js('function f() { f(); }\nf();');
    expect(ran.status).toBe('error');
    expect(ran.err).toMatch(/stack overflow/i);
  });

  it('does not let a cell fake the time limit', async () => {
    const ran = await js('throw { name: "InternalError", message: "interrupted" };');
    expect(ran.status).toBe('error');
  });
});
