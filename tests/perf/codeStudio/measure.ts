// The Node measures of the code studio's gates. This file is bundled with the studio's own modules, as the app bundles
// them (run.ts does it with rolldown), and run in a plain Node process: the test runner's module loader makes parsers
// several times slower than in the app. Prints one JSON array of gate results to the standard output.
// Every timed section goes through `timed`, so OPENNOTE_PERF_INJECT_MS can prove that each gate fails when slow.
// Runtimes that reach the app as pack downloads (Pyodide, clang) load here from the npm package of the same version.

import { pythonLanguage } from '@codemirror/lang-python';
import releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { loadPyodide } from 'pyodide';
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import { transform } from 'sucrase';
import { LuaFactory } from 'wasmoon';
import { contextAt, suggest } from '../../../app/src/features/codestudio/complete/ghost.ts';
import { rank } from '../../../app/src/features/codestudio/complete/rank.ts';
import type { SyntaxTree } from '../../../app/src/features/codestudio/complete/scope.ts';
import type { RunFile, RunRequest, WorkerMessage } from '../../../app/src/features/codestudio/contracts/run.ts';
import { analyze } from '../../../app/src/features/codestudio/diagnostics/analyze.ts';
import { sampleFile } from '../../../app/src/features/codestudio/diagnostics/bench.ts';
import { LAYER_DEBOUNCE_MS } from '../../../app/src/features/codestudio/diagnostics/types.ts';
import type { EditorLanguage } from '../../../app/src/features/codestudio/diagnostics/types.ts';
import { Mount } from '../../../app/src/features/codestudio/run/mount.ts';
import { RUN_LIMITS } from '../../../app/src/features/codestudio/run/protocol.ts';
import { seeded } from '../../../app/src/features/codestudio/run/random.ts';
import { Stdin } from '../../../app/src/features/codestudio/run/stdin.ts';
import { clangAdapter } from '../../../app/src/features/codestudio/runtimes/cpp/adapter.ts';
import { Clang } from '../../../app/src/features/codestudio/runtimes/cpp/clang.ts';
import type { ClangModule } from '../../../app/src/features/codestudio/runtimes/cpp/clang.ts';
import { cappedHeap, runProgram } from '../../../app/src/features/codestudio/runtimes/js/engine.ts';
import { runLua } from '../../../app/src/features/codestudio/runtimes/lua/engine.ts';
import { loadMicroPythonEngine } from '../../../app/src/features/codestudio/runtimes/python/micropython.ts';
import { cutOffPyodide, loadPyodideEngine } from '../../../app/src/features/codestudio/runtimes/python/pyodide.ts';
import type { LoadPyodide } from '../../../app/src/features/codestudio/runtimes/python/pyodide.ts';
import { runPython } from '../../../app/src/features/codestudio/runtimes/python/session.ts';
import type { PythonEngine } from '../../../app/src/features/codestudio/runtimes/python/session.ts';
import { runSql } from '../../../app/src/features/codestudio/runtimes/sql/engine.ts';
import { GATES } from './budgets.ts';
import { best, judge, median, timed, timedAsync } from './judge.ts';
import type { GateResult } from './judge.ts';

const ROOT = process.env.OPENNOTE_ROOT ?? process.cwd();
const only = process.env.OPENNOTE_PERF_ONLY?.split(',').map((part) => part.trim());
const wanted = (id: string) => !only || only.includes(id);
const gate = (id: string) => GATES.find((candidate) => candidate.id === id)!;
/** OPENNOTE_PERF_QUICK=1 takes fewer samples, so a test that injects a delay into every sample stays short. */
const QUICK = process.env.OPENNOTE_PERF_QUICK === '1';
const ATTEMPTS = QUICK ? 1 : 3;
const results: GateResult[] = [];

/** Runs one gate's measure unless the run is limited to other gates. A thrown error fails the gate, never hides it. */
async function measure(id: string, work: () => Promise<number>): Promise<void> {
  if (!wanted(id)) return;
  try {
    results.push(judge(gate(id), Math.round((await work()) * 100) / 100));
  } catch (error) {
    results.push({
      id,
      status: 'fail',
      reason: `The measure failed: ${error instanceof Error ? error.message : error}`,
    });
  }
}

// --- Completion list and ghost text (G-C1, G-C2) ---

function thousandLines(): string {
  const lines: string[] = [];
  for (let i = 0; lines.length < 995; i++) {
    lines.push(`def step_${i}(values, limit_${i}):`);
    lines.push(`    total_${i} = 0`);
    lines.push(`    for item in values:`);
    lines.push(`        total_${i} += item * ${i}`);
    lines.push(`    return min(total_${i}, limit_${i})`);
  }
  lines.push('def last(radius, count):', '    nums = [1, 2, 3]', '    result = radius * count', '    print(res');
  return lines.join('\n');
}

const SAMPLES = QUICK ? 5 : 15;

/** The median of cold samples: each types a different character earlier in the file and reparses (not timed). */
function coldMedian(id: string, base: string, run: (text: string, tree: SyntaxTree) => void): number {
  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const at = base.indexOf('\n', (base.length * i) / SAMPLES);
    const text = `${base.slice(0, at)} # ${String.fromCharCode(97 + i)}${base.slice(at)}`;
    const tree = pythonLanguage.parser.parse(text);
    times.push(timed(id, () => run(text, tree)));
  }
  return median(times);
}

const bestOfThree = (id: string, base: string, run: (text: string, tree: SyntaxTree) => void) =>
  best(Array.from({ length: ATTEMPTS }, () => coldMedian(id, base, run)));

const python1000 = thousandLines();

await measure('completion-list', async () =>
  bestOfThree('completion-list', python1000, (text, tree) => rank(contextAt('python', text, text.length), { tree })),
);

await measure('pattern-ghost', async () =>
  Math.max(
    ...[false, true].map((explicit) =>
      bestOfThree('pattern-ghost', python1000, (text, tree) =>
        suggest({ language: 'python', text, pos: text.length, explicit }, { tree }),
      ),
    ),
  ),
);

// --- Diagnostics marks (G-D2): the layer's pause plus the layer's run on a 1,000-line file ---

const MARK_LANGUAGES: EditorLanguage[] = ['python', 'javascript', 'typescript', 'c', 'cpp', 'lua'];

async function slowestLayer(id: string, layer: 'syntax' | 'checker'): Promise<number> {
  let slowest = 0;
  for (const language of MARK_LANGUAGES) {
    const text = sampleFile(language, 1000);
    await analyze({ language, text, layers: [layer] });
    const runs: number[] = [];
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const times: number[] = [];
      for (let i = 0; i < (QUICK ? 3 : 7); i++)
        times.push(await timedAsync(id, () => analyze({ language, text, layers: [layer] })));
      runs.push(median(times));
    }
    slowest = Math.max(slowest, best(runs));
  }
  return LAYER_DEBOUNCE_MS[layer] + slowest;
}

await measure('syntax-marks', () => slowestLayer('syntax-marks', 'syntax'));
await measure('checker-marks', () => slowestLayer('checker-marks', 'checker'));

// --- Run start with a loaded engine (G-R1, G-R2) ---

function order(runtime: RunRequest['runtime'], file: string, text: string): RunRequest {
  return {
    kind: 'run',
    runtime,
    files: [{ path: file, text }],
    main: file,
    args: [],
    stdin: { mode: 'prefilled', text: '' },
    limits: RUN_LIMITS,
    seed: 1,
  };
}

function context(request: RunRequest) {
  const random = seeded(request.seed);
  return {
    stdin: new Stdin('', false),
    files: new Mount(request.files as RunFile[]),
    random: random.random,
    randomBytes: random.fill,
    deadline: performance.now() + request.limits.timeMs,
  };
}

/** A warm-up run, then the best of three medians of five runs: what a person sees from the second run on. */
async function warm(id: string, once: () => Promise<void> | void): Promise<number> {
  await once();
  const runs: number[] = [];
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const times: number[] = [];
    for (let i = 0; i < (QUICK ? 3 : 5); i++) times.push(await timedAsync(id, async () => once()));
    runs.push(median(times));
  }
  return best(runs);
}

const noMessages = (_message: WorkerMessage) => undefined;
const mustBeOk = (status: string) => {
  if (status !== 'ok') throw new Error(`The run ended with ${status}.`);
};

await measure('run-quickjs', async () => {
  const quickjs = await newQuickJSWASMModuleFromVariant(
    newVariant(releaseSync, { wasmMemory: cappedHeap(RUN_LIMITS.memoryBytes) }),
  );
  const request = order('typescript', 'main.ts', 'const name: string = "world";\nconsole.log(`Hello, ${name}!`);\n');
  return warm('run-quickjs', () =>
    mustBeOk(runProgram({ quickjs, transform }, request, noMessages, context(request)).status),
  );
});

await measure('run-micropython', async () => {
  const wasm = `${ROOT}/node_modules/@micropython/micropython-webassembly-pyscript/micropython.wasm`;
  const engine = await loadMicroPythonEngine(wasm);
  const request = order('python-quick', 'main.py', 'print("Hello, world!")\n');
  return warm('run-micropython', () => mustBeOk(runPython(engine, request, noMessages, context(request)).status));
});

await measure('run-lua', async () => {
  const factory = new LuaFactory();
  await factory.getLuaModule();
  const request = order('lua', 'main.lua', 'print("Hello, world!")\n');
  return warm('run-lua', async () => mustBeOk((await runLua(factory, request, noMessages, context(request))).status));
});

await measure('run-sql', async () => {
  const init = sqlite3InitModule as unknown as (options: object) => Promise<Sqlite3Static>;
  const sqlite = await init({ print: () => undefined, printErr: () => undefined });
  const request = order('sql', 'main.sql', 'select 1 + 1 as two;\n');
  return warm('run-sql', () => mustBeOk(runSql(sqlite, request, noMessages, context(request)).status));
});

let pyodide: Promise<PythonEngine> | undefined;
const pyodideEngine = () =>
  (pyodide ??= loadPyodideEngine(loadPyodide as unknown as LoadPyodide, `${ROOT}/node_modules/pyodide/`).then(
    (engine) => {
      cutOffPyodide(engine);
      return engine;
    },
  ));
const hello = order('python-full', 'main.py', 'print("Hello, world!")\n');
const runHello = (engine: PythonEngine) => mustBeOk(runPython(engine, hello, noMessages, context(hello)).status);

// Cold first: the load and the first run are timed together, once, before the warm gate loads nothing more.
await measure('run-pyodide-cold', () => timedAsync('run-pyodide-cold', async () => runHello(await pyodideEngine())));
await measure('run-pyodide-warm', async () => {
  const engine = await pyodideEngine();
  return warm('run-pyodide-warm', () => runHello(engine));
});

// --- C and C++ compile with a loaded toolchain (G-R4): the compile step of a 200-line file, second compile on ---

function source(language: 'c' | 'cpp'): string {
  const head =
    language === 'c'
      ? ['#include <stdio.h>', '#include <string.h>', '#include <stdlib.h>']
      : ['#include <iostream>', '#include <string>', '#include <vector>', '#include <algorithm>'];
  const lines = [...head, ''];
  for (let i = 0; lines.length < 190; i++) {
    lines.push(
      `static int step_${i}(int value) {`,
      `  int total = 0;`,
      `  for (int k = 0; k < value; k++) {`,
      `    total += k * ${i + 1};`,
      `  }`,
      `  return total;`,
      `}`,
      ``,
    );
  }
  lines.push(language === 'c' ? 'int main(void) {' : 'int main() {', '  int sum = 0;');
  for (let i = 0; i < 8; i++) lines.push(`  sum += step_${i}(${i + 3});`);
  lines.push(language === 'c' ? '  printf("%d\\n", sum);' : '  std::cout << sum << std::endl;', '  return 0;', '}');
  return lines.join('\n');
}

const clang = new Clang(() => import('@yowasp/clang') as unknown as Promise<ClangModule>);
for (const language of ['c', 'cpp'] as const) {
  await measure(`compile-${language}`, async () => {
    const adapter = clangAdapter(language, clang);
    await adapter.load(() => {});
    const request = order(language, `main.${language}`, source(language));
    return warm(`compile-${language}`, async () => {
      const end = await adapter.prepare!(request, noMessages, context(request));
      if (end !== null) throw new Error(`The compile ended with ${end.status}.`);
    });
  });
}

process.stdout.write(`${JSON.stringify(results)}\n`);
process.exit(0);
