// The JavaScript and TypeScript runtimes in a real browser, in the real run worker (run/worker.ts) after lockdown.
// The sandbox escapes are the same as code cells' JavaScript tests (codecells/sandbox/sandbox.test.tsx): no network,
// timers, modules from outside the project, or worker globals; the time and memory limits; deep recursion; and a
// program that fakes the time limit. Then one TypeScript project end to end: a module, a diagnostic, and tests.

// checks-disable-file modifiability: one describe block per feature
import { describe, expect, it, vi } from 'vitest';
import type { RunFile, RunLimits, RuntimeDiagnostic, RuntimeId } from '../../contracts/run';
import { RunHost, createRunWorker } from '../../run/host';
import type { RunOrder } from '../../run/host';
import { RUN_LIMITS } from '../../run/protocol';

// Each run starts a worker and a WebAssembly runtime, which a loaded machine slows.
vi.setConfig({ testTimeout: 60_000 });

const QUICK = { ...RUN_LIMITS, timeMs: 1500 };

async function run(files: RunFile[], more: { runtime?: RuntimeId; limits?: RunLimits; tests?: boolean } = {}) {
  const runs = new RunHost({ createWorker: createRunWorker });
  const order: RunOrder = {
    runtime: more.runtime ?? 'javascript',
    files,
    main: files[0]!.path,
    args: [],
    stdin: { mode: 'prefilled', text: '' },
    limits: more.limits ?? RUN_LIMITS,
    seed: 1,
    ...(more.tests ? { test: { cases: [], framework: true } } : {}),
  };
  let out = '';
  let err = '';
  const tests: string[] = [];
  const diagnostics: RuntimeDiagnostic[] = [];
  const handle = runs.run(order, {
    onOutput: (stream, text) => (stream === 'out' ? (out += text) : (err += text)),
    onTest: (result) => tests.push(`${result.name}: ${result.status}`),
    onDiagnostics: (items) => diagnostics.push(...items),
  });
  const done = await handle.done;
  runs.dispose();
  return { ...done, out, err, tests, diagnostics };
}

const js = (source: string, limits?: RunLimits) => run([{ path: 'main.js', text: source }], limits ? { limits } : {});

describe('the sandbox', () => {
  it('gives JavaScript programs no network, timers, modules, or worker globals', async () => {
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

  it('stops a program at the time limit and at the memory limit', async () => {
    expect((await js('while (true) {}', QUICK)).status).toBe('time');
    expect((await js('const a = []; while (true) a.push(new Array(1e5).fill(1));')).status).toBe('memory');
  });

  it('reports deep recursion as an error in the program', async () => {
    const ran = await js('function f() { f(); }\nf();');
    expect(ran.status).toBe('error');
    expect(ran.err).toMatch(/stack overflow/i);
  });

  it('does not let a program fake the time limit', async () => {
    const ran = await js('throw { name: "InternalError", message: "interrupted" };');
    expect(ran.status).toBe('error');
  });
});

describe('a TypeScript project', () => {
  it('runs a module, reports its version, and maps an error to its line', async () => {
    const ran = await run(
      [
        {
          path: 'main.ts',
          text: "import { half } from './util';\nconst n: number = half(10);\nconsole.log(n);\nhalf(-1);",
        },
        {
          path: 'util.ts',
          text: 'export function half(n: number): number {\n  if (n < 0) throw new RangeError("negative");\n  return n / 2;\n}',
        },
      ],
      { runtime: 'typescript' },
    );
    expect(ran.out).toBe('5\n');
    expect(ran.status).toBe('error');
    expect(ran.version).toMatch(/^TypeScript through Sucrase 3\.35\.1, QuickJS/);
    expect(ran.diagnostics).toEqual([expect.objectContaining({ file: 'util.ts', line: 2, kind: 'RangeError' })]);
  });

  it('runs its tests and sends one result per test', async () => {
    const ran = await run(
      [
        { path: 'main.ts', text: 'export const sum = (a: number, b: number): number => a + b;' },
        {
          path: 'main.test.ts',
          text: [
            "import { sum } from './main';",
            "test('adds', () => expect(sum(1, 2)).toBe(3));",
            "test('wrong', () => expect(sum(1, 2)).toBe(4));",
          ].join('\n'),
        },
      ],
      { runtime: 'typescript', tests: true },
    );
    expect(ran.tests).toEqual(['adds: pass', 'wrong: fail']);
    expect(ran.out).toContain('Tests: 1 passed, 1 failed, 0 skipped, 2 total.');
  });
});
