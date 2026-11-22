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
import type { RunFile, RunRequest } from '../../../app/src/features/codestudio/contracts/run.ts';
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
import { best, hearing, judge, median, timed, timedAsync } from './judge.ts';
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
  bestOfThree('completion-list', python1000, (text, tree) => {
    const items = rank(contextAt('python', text, text.length), { tree });
    // An empty list would time a no-op, so it fails the gate instead of passing it.
    if (items.length === 0) throw new Error('The completion list was empty.');
  }),
);

/** The file with a run of numbered lines at the end, where the automatic predictor has a suggestion to give. */
const pythonSteps = `${python1000.slice(0, python1000.indexOf('def last('))}a1 = x[1]\na2 = x[2]\na`;

await measure('pattern-ghost', async () =>
  Math.max(
    ...[
      { explicit: false, base: pythonSteps },
      { explicit: true, base: python1000 },
    ].map(({ explicit, base }) =>
      bestOfThree('pattern-ghost', base, (text, tree) => {
        const found = suggest({ language: 'python', text, pos: text.length, explicit }, { tree });
        // A variant that finds nothing would time a no-op, so it fails the gate instead of passing it.
        if (!found) throw new Error(`The ${explicit ? 'explicit' : 'automatic'} ghost text found no suggestion.`);
      }),
    ),
  ),
);

// --- Diagnostics marks (G-D2): the layer's pause plus the layer's run on a 1,000-line file ---

const MARK_LANGUAGES: EditorLanguage[] = ['python', 'javascript', 'typescript', 'c', 'cpp', 'lua'];

/** A last line with a problem in it, so the layer has a mark to find and a layer that finds none fails the gate. */
const PROBLEM: Record<'syntax' | 'checker', Partial<Record<EditorLanguage, string>>> = {
  syntax: { python: ')\n', javascript: ')\n', typescript: ')\n', c: ')\n', cpp: ')\n' },
  checker: {
    python: 'print(undefined_name_x)\n',
    javascript: 'undefinedNameX + 1;\n',
    typescript: 'undefinedNameX + 1;\n',
    c: 'int probe(void) { return undefined_name_x; }\n',
    cpp: 'int probe() { return undefined_name_x; }\n',
    lua: 'print(undefined_name_x)\n',
  },
};

async function slowestLayer(id: string, layer: 'syntax' | 'checker'): Promise<number> {
  let slowest = 0;
  for (const language of MARK_LANGUAGES) {
    const text = `${sampleFile(language, 1000)}${PROBLEM[layer][language] ?? ''}`;
    const found = await analyze({ language, text, layers: [layer] });
    // A layer that finds nothing on the sample file would time a no-op (the Lua parser has no syntax layer).
    if (found[layer].length === 0 && !(language === 'lua' && layer === 'syntax'))
      throw new Error(`The ${layer} layer found no mark in the ${language} sample file.`);
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

await measure('run-quickjs', async () => {
  const quickjs = await newQuickJSWASMModuleFromVariant(
    newVariant(releaseSync, { wasmMemory: cappedHeap(RUN_LIMITS.memoryBytes) }),
  );
  const request = order('typescript', 'main.ts', 'const name: string = "world";\nconsole.log(`Hello, ${name}!`);\n');
  return warm('run-quickjs', () => {
    const heard = hearing();
    heard.check(runProgram({ quickjs, transform }, request, heard.emit, context(request)).status, 'Hello, world!');
  });
});

await measure('run-micropython', async () => {
  const wasm = `${ROOT}/node_modules/@micropython/micropython-webassembly-pyscript/micropython.wasm`;
  const engine = await loadMicroPythonEngine(wasm);
  const request = order('python-quick', 'main.py', 'print("Hello, world!")\n');
  return warm('run-micropython', () => {
    const heard = hearing();
    heard.check(runPython(engine, request, heard.emit, context(request)).status, 'Hello, world!');
  });
});

await measure('run-lua', async () => {
  const factory = new LuaFactory();
  await factory.getLuaModule();
  const request = order('lua', 'main.lua', 'print("Hello, world!")\n');
  return warm('run-lua', async () => {
    const heard = hearing();
    heard.check((await runLua(factory, request, heard.emit, context(request))).status, 'Hello, world!');
  });
});

await measure('run-sql', async () => {
  const init = sqlite3InitModule as unknown as (options: object) => Promise<Sqlite3Static>;
  const sqlite = await init({ print: () => undefined, printErr: () => undefined });
  const request = order('sql', 'main.sql', 'select 1 + 1 as two;\n');
  return warm('run-sql', () => {
    const heard = hearing();
    heard.check(runSql(sqlite, request, heard.emit, context(request)).status, '1 row');
  });
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
const runHello = (engine: PythonEngine) => {
  const heard = hearing();
  heard.check(runPython(engine, hello, heard.emit, context(hello)).status, 'Hello, world!');
};

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
      const end = await adapter.prepare!(request, () => undefined, context(request));
      if (end !== null) throw new Error(`The compile ended with ${end.status}.`);
    });
  });
}

process.stdout.write(`${JSON.stringify(results)}\n`);
process.exit(0);
