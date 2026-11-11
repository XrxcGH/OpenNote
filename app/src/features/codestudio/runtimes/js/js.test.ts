// The JavaScript and TypeScript runtime in Node, with the real QuickJS and the real Sucrase (DESIGN 2.1, 4, 9).
// - The 20-program suite runs in both languages. Its answers are worked by hand or come from the language specification.
// - Sucrase keeps line numbers, so errors map to the line in the TypeScript file.
// - Modules work across project files, and a missing one gives a clear error.
// - The Jest-compatible test API gives the known answers from Jest's documentation.
// The sandbox escapes run in a real worker in js.test.tsx.

// checks-disable-file modifiability: one describe block per feature
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import { transform } from 'sucrase';
import type { RunFile, RunRequest, RuntimeDiagnostic, WorkerMessage } from '../../contracts/run';
import type { TestResult } from '../../contracts/testing';
import { mapDiagnostics } from '../../run/diagnostics';
import { Mount } from '../../run/mount';
import { RUN_LIMITS } from '../../run/protocol';
import { seeded } from '../../run/random';
import { Stdin } from '../../run/stdin';
import { VERSIONS } from './adapter';
import { quickjsMapper } from './diagnostics';
import { BASE_HEAP_BYTES, cappedHeap, headroomBytes, runProgram } from './engine';
import type { Engine } from './engine';
import { resolveModule } from './modules';
import { compile, usesModules } from './transpile';

/** A fresh QuickJS with its heap capped, as the worker makes one for each run. */
async function newEngine(memoryBytes = RUN_LIMITS.memoryBytes): Promise<Engine> {
  const quickjs = await newQuickJSWASMModuleFromVariant(
    newVariant(releaseSync, { wasmMemory: cappedHeap(memoryBytes) }),
  );
  return { quickjs, transform };
}

let engine: Engine;
beforeAll(async () => {
  engine = await newEngine();
});

interface Ran {
  status: string;
  exitCode?: number;
  out: string;
  err: string;
  tests: TestResult[];
  diagnostics: RuntimeDiagnostic[];
}

function run(
  files: Record<string, string>,
  more: {
    main?: string;
    stdin?: string;
    args?: string[];
    tests?: boolean;
    timeMs?: number;
    memoryBytes?: number;
    engine?: Engine;
  } = {},
): Ran {
  const list: RunFile[] = Object.entries(files).map(([path, text]) => ({ path, text }));
  const request: RunRequest = {
    kind: 'run',
    runtime: 'typescript',
    files: list,
    main: more.main ?? list[0]!.path,
    args: more.args ?? [],
    stdin: { mode: 'prefilled', text: more.stdin ?? '' },
    limits: {
      ...RUN_LIMITS,
      timeMs: more.timeMs ?? RUN_LIMITS.timeMs,
      memoryBytes: more.memoryBytes ?? RUN_LIMITS.memoryBytes,
    },
    seed: 1,
    ...(more.tests ? { test: { cases: [], framework: true } } : {}),
  };
  const messages: WorkerMessage[] = [];
  const random = seeded(request.seed);
  const end = runProgram(more.engine ?? engine, request, (message) => messages.push(message), {
    stdin: new Stdin(request.stdin.text, false),
    files: new Mount(list),
    random: random.random,
    randomBytes: random.fill,
    deadline: performance.now() + request.limits.timeMs,
  });
  const text = (stream: string) =>
    messages.map((message) => (message.kind === 'out' && message.stream === stream ? message.text : '')).join('');
  const err = text('err');
  return {
    status: end.status,
    ...(end.exitCode === undefined ? {} : { exitCode: end.exitCode }),
    out: text('out'),
    err,
    tests: messages.flatMap((message) => (message.kind === 'test' ? [message.result] : [])),
    diagnostics: mapDiagnostics(quickjsMapper, err, list),
  };
}

interface Program {
  name: string;
  js: string;
  ts: string;
  out: string;
  stdin?: string;
}

// Each answer is worked by hand or follows from the ECMAScript specification (default sort compares strings;
// 0.1 + 0.2 is the double nearest 0.30000000000000004), and console.log's format is Node's documented one.
const PROGRAMS: Program[] = [
  {
    name: 'hello',
    js: 'console.log("Hello, world!");',
    ts: 'const who: string = "world";\nconsole.log(`Hello, ${who}!`);',
    out: 'Hello, world!\n',
  },
  {
    name: 'sum 1..100',
    js: 'let s = 0;\nfor (let i = 1; i <= 100; i++) s += i;\nconsole.log(s);',
    ts: 'let s: number = 0;\nfor (let i: number = 1; i <= 100; i++) s += i;\nconsole.log(s);',
    out: '5050\n',
  },
  {
    name: 'fib(30)',
    js: 'function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }\nconsole.log(fib(30));',
    ts: 'function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }\nconsole.log(fib(30));',
    out: '832040\n',
  },
  {
    name: '20! with BigInt',
    js: 'let f = 1n;\nfor (let i = 1n; i <= 20n; i++) f *= i;\nconsole.log(f.toString());',
    ts: 'let f: bigint = 1n;\nfor (let i: bigint = 1n; i <= 20n; i++) f *= i;\nconsole.log(f.toString());',
    out: '2432902008176640000\n',
  },
  {
    name: 'primes below 50',
    js: 'const p = [];\nfor (let n = 2; n < 50; n++) if (p.every((q) => n % q)) p.push(n);\nconsole.log(p.join(" "));',
    ts: [
      'const p: number[] = [];',
      'for (let n = 2; n < 50; n++) if (p.every((q: number) => n % q)) p.push(n);',
      'console.log(p.join(" "));',
    ].join('\n'),
    out: '2 3 5 7 11 13 17 19 23 29 31 37 41 43 47\n',
  },
  {
    name: 'sorted',
    js: 'const a = [5, 3, 10, 1];\nconsole.log([...a].sort((x, y) => x - y).join(","), [...a].sort().join(","));',
    ts: [
      'const a: number[] = [5, 3, 10, 1];',
      'console.log([...a].sort((x: number, y: number) => x - y).join(","), [...a].sort().join(","));',
    ].join('\n'),
    out: '1,3,5,10 1,10,3,5\n',
  },
  {
    name: 'reverse a string',
    js: 'console.log("OpenNote".split("").reverse().join(""));',
    ts: 'const word: string = "OpenNote";\nconsole.log(word.split("").reverse().join(""));',
    out: 'etoNnepO\n',
  },
  {
    name: 'Unicode',
    js: 'console.log("héllo wörld".toUpperCase(), "😀".length, [..."😀"].length);',
    ts: 'const s: string = "héllo wörld";\nconsole.log(s.toUpperCase(), "😀".length, [..."😀"].length);',
    out: 'HÉLLO WÖRLD 2 1\n',
  },
  {
    name: 'formatting numbers',
    js: 'console.log((3.14159).toFixed(2), (255).toString(16), (1e21).toString());',
    ts: 'const pi: number = 3.14159;\nconsole.log(pi.toFixed(2), (255).toString(16), (1e21).toString());',
    out: '3.14 ff 1e+21\n',
  },
  {
    name: 'gcd(1071, 462)',
    js: 'const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));\nconsole.log(gcd(1071, 462));',
    ts: 'const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));\nconsole.log(gcd(1071, 462));',
    out: '21\n',
  },
  {
    name: 'FizzBuzz to 15',
    js: [
      'for (let i = 1; i <= 15; i++) console.log(i % 15 === 0 ? "FizzBuzz" : i % 3 === 0 ? "Fizz" : i % 5 === 0 ? "Buzz" : i);',
    ].join('\n'),
    ts: [
      'for (let i: number = 1; i <= 15; i++) console.log(i % 15 === 0 ? "FizzBuzz" : i % 3 === 0 ? "Fizz" : i % 5 === 0 ? "Buzz" : i);',
    ].join('\n'),
    out: '1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz\n',
  },
  {
    name: 'word count',
    js: 'const c = {};\nfor (const w of "the cat the hat".split(" ")) c[w] = (c[w] || 0) + 1;\nconsole.log(c);',
    ts: [
      'const c: Record<string, number> = {};',
      'for (const w of "the cat the hat".split(" ")) c[w] = (c[w] ?? 0) + 1;',
      'console.log(c);',
    ].join('\n'),
    out: '{ the: 2, cat: 1, hat: 1 }\n',
  },
  {
    name: 'JSON',
    js: 'const text = JSON.stringify({ a: [1, 2], b: "x" });\nconsole.log(text, JSON.parse(text).a[1]);',
    ts: [
      'interface D { a: number[]; b: string }',
      'const text = JSON.stringify({ a: [1, 2], b: "x" } as D);',
      'console.log(text, (JSON.parse(text) as D).a[1]);',
    ].join('\n'),
    out: '{"a":[1,2],"b":"x"} 2\n',
  },
  {
    name: 'classes',
    js: [
      'class Animal { constructor(name) { this.name = name; } speak() { return `${this.name} makes a sound`; } }',
      'class Dog extends Animal { speak() { return `${this.name} barks`; } }',
      'console.log(new Dog("Rex").speak());',
    ].join('\n'),
    ts: [
      'class Animal { constructor(public name: string) {} speak(): string { return `${this.name} makes a sound`; } }',
      'class Dog extends Animal { override speak(): string { return `${this.name} barks`; } }',
      'console.log(new Dog("Rex").speak());',
    ].join('\n'),
    out: 'Rex barks\n',
  },
  {
    name: 'closures',
    js: [
      'function counter() { let n = 0; return () => ++n; }',
      'const next = counter();',
      'console.log(next(), next(), next());',
    ].join('\n'),
    ts: [
      'function counter(): () => number { let n = 0; return () => ++n; }',
      'const next = counter();',
      'console.log(next(), next(), next());',
    ].join('\n'),
    out: '1 2 3\n',
  },
  {
    name: 'generators',
    js: [
      'function* squares() { for (let i = 0; ; i++) yield i * i; }',
      'const out = [];',
      'for (const s of squares()) { if (out.length === 5) break; out.push(s); }',
      'console.log(out);',
    ].join('\n'),
    ts: [
      'function* squares(): Generator<number> { for (let i = 0; ; i++) yield i * i; }',
      'const out: number[] = [];',
      'for (const s of squares()) { if (out.length === 5) break; out.push(s); }',
      'console.log(out);',
    ].join('\n'),
    out: '[ 0, 1, 4, 9, 16 ]\n',
  },
  {
    name: 'promises',
    js: 'async function answer() { return 42; }\nanswer().then((v) => console.log("async", v));\nconsole.log("sync");',
    ts: [
      'async function answer(): Promise<number> { return 42; }',
      'answer().then((v: number) => console.log("async", v));',
      'console.log("sync");',
    ].join('\n'),
    out: 'sync\nasync 42\n',
  },
  {
    name: 'destructuring',
    js: 'const [first, ...rest] = [1, 2, 3];\nconst { x, y = 5 } = { x: 4 };\nconsole.log(first, rest, x + y);',
    ts: [
      'const [first, ...rest]: number[] = [1, 2, 3];',
      'const { x, y = 5 }: { x: number; y?: number } = { x: 4 };',
      'console.log(first, rest, x + y);',
    ].join('\n'),
    out: '1 [ 2, 3 ] 9\n',
  },
  {
    name: 'number edges',
    js: 'console.log(2 ** 53 + 1 === 2 ** 53, 0.1 + 0.2, 7 / 0, -7 % 3);',
    ts: 'const big: number = 2 ** 53;\nconsole.log(big + 1 === big, 0.1 + 0.2, 7 / 0, -7 % 3);',
    out: 'true 0.30000000000000004 Infinity -1\n',
  },
  {
    name: 'standard input',
    js: 'const a = Number(readline());\nconst b = Number(readline());\nconsole.log(a + b, readline());',
    ts: [
      'const a: number = Number(readline());',
      'const b: number = Number(readline());',
      'console.log(a + b, readline());',
    ].join('\n'),
    stdin: '3\n4\n',
    out: '7 null\n',
  },
];

describe('the 20-program suite', () => {
  it('has 20 programs', () => expect(PROGRAMS).toHaveLength(20));

  it.each(PROGRAMS)('runs "$name" in JavaScript', (program) => {
    const ran = run({ 'main.js': program.js }, { stdin: program.stdin ?? '' });
    expect(ran.err).toBe('');
    expect(ran.out).toBe(program.out);
    expect(ran.status).toBe('ok');
  });

  it.each(PROGRAMS)('runs "$name" in TypeScript', (program) => {
    const ran = run({ 'main.ts': program.ts }, { stdin: program.stdin ?? '' });
    expect(ran.err).toBe('');
    expect(ran.out).toBe(program.out);
    expect(ran.status).toBe('ok');
  });
});

describe('the run', () => {
  it('shows the last value after an arrow, and nothing for undefined', () => {
    expect(run({ 'main.js': 'const x = 2;\nx * 21' }).out).toBe('→ 42\n');
    expect(run({ 'main.js': 'console.log(1)' }).out).toBe('1\n');
    expect(run({ 'main.ts': 'const t: string = "ok";\nt' }).out).toBe('→ ok\n');
    // Sucrase's "use strict" is a directive, not the program's last value.
    expect(run({ 'main.ts': 'const t: string = "ok";' }).out).toBe('');
  });

  it('seeds Math.random from the run seed (xorshift32 of 1 is 270369, worked by hand)', () => {
    expect(run({ 'main.js': 'console.log(Math.random() * 2 ** 32)' }).out).toBe('270369\n');
  });

  it('writes console methods to the right streams', () => {
    const ran = run({
      'main.js':
        'console.info("i"); console.debug("d"); console.warn("w"); console.error("e");\nconsole.assert(1 > 2, "no");',
    });
    expect(ran.out).toBe('i\nd\n');
    expect(ran.err).toBe('w\ne\nAssertion failed: no\n');
  });

  it('formats values the way Node documents console.log', () => {
    const ran = run({
      'main.js':
        'console.log([1, "a"], { k: [true, null] }, new Map([["a", 1]]), new Set([2]), function f() {}, undefined);',
    });
    expect(ran.out).toBe("[ 1, 'a' ] { k: [ true, null ] } Map(1) { 'a' => 1 } Set(1) { 2 } [Function: f] undefined\n");
  });

  it('gives arguments, and ends with process.exit', () => {
    const ran = run(
      { 'main.js': 'console.log(process.argv.slice(2).join("+"));\nprocess.exit(3);\nconsole.log("after");' },
      {
        args: ['a', 'b'],
      },
    );
    expect(ran.out).toBe('a+b\n');
    expect(ran.exitCode).toBe(3);
    expect(ran.status).toBe('error');
  });

  // QuickJS's own limit cannot see block sizes in this build. Without the heap cap, the program below grew the heap
  // to its 2 GB ceiling (1,935 arrays of 800 KB), whatever limit was set.
  it('stops at the memory limit within the capped heap, in well under 2 s', async () => {
    const limit = 16 * 1024 * 1024;
    const small = await newEngine(limit);
    const started = performance.now();
    const ran = run(
      { 'main.js': 'const a = []; while (true) a.push(new Array(1e5).fill(1));' },
      { engine: small, memoryBytes: limit, timeMs: 60_000 },
    );
    expect(ran.status).toBe('memory');
    expect(performance.now() - started).toBeLessThan(2000);
    expect(small.quickjs.getWasmMemory().buffer.byteLength).toBeLessThanOrEqual(
      BASE_HEAP_BYTES + limit + headroomBytes(limit),
    );
  });

  it("ends the run when the heap grows past the run's own, smaller limit", async () => {
    const fresh = await newEngine();
    const limit = 4 * 1024 * 1024;
    const ran = run(
      // Arrays that grow by push are the blocks QuickJS's own limit misses: alone, it let this program use 64 MB.
      {
        'main.js': 'const a = []; while (true) { const b = []; for (let i = 0; i < 1000; i++) b.push(i); a.push(b); }',
      },
      { engine: fresh, memoryBytes: limit, timeMs: 60_000 },
    );
    expect(ran.status).toBe('memory');
    // The heap grows in steps of about a fifth, so it stops a few megabytes past the limit, far below the cap.
    expect(fresh.quickjs.getWasmMemory().buffer.byteLength).toBeLessThan(BASE_HEAP_BYTES + 3 * limit);
  });

  // Many small blocks fill the heap between two checks of the interrupt handler. QuickJS then cannot make its own
  // out-of-memory error and throws null, which ended these runs as "Uncaught null" before the heap had headroom.
  it('ends many small allocations as "memory" under the default limits', async () => {
    const programs: Record<string, string>[] = [
      { 'main.js': "const a = []; for (;;) a.push({ i: a.length, s: 'x' + a.length });" },
      { 'main.js': 'let n = null; for (;;) n = { next: n };' },
      { 'main.js': 'const m = new Map(); for (let i = 0; ; i++) m.set(i, { i });' },
      {
        'main.ts': [
          'class P { constructor(public x: number, public y: number) {} }',
          'const all: P[] = [];',
          'for (;;) all.push(new P(1, 2));',
        ].join('\n'),
      },
    ];
    for (const files of programs) {
      const ran = run(files, { engine: await newEngine(), timeMs: 60_000 });
      expect([files, ran.status, ran.err]).toEqual([files, 'memory', 'InternalError: out of memory\n']);
    }
  });

  it('stops at the time limit, also inside a promise job', () => {
    expect(run({ 'main.js': 'while (true) {}' }, { timeMs: 300 }).status).toBe('time');
    const later = 'async function main() { await null; while (true) {} }\nmain();\nconsole.log("started");';
    const ran = run({ 'main.js': later }, { timeMs: 600 });
    expect(ran.status).toBe('time');
    expect(ran.out).toBe('started\n');
  });

  it('does not count a thrown look-alike of the interrupt as the time limit', () => {
    const ran = run({ 'main.js': 'throw { name: "InternalError", message: "interrupted" };' });
    expect(ran.status).toBe('error');
  });

  it('prints any thrown value, and never fails the run while formatting it', () => {
    const cases: [string, string][] = [
      ['throw 10n;', 'Uncaught 10n\n'],
      ['Promise.reject(10n)', 'Uncaught 10n\n'],
      ['throw Symbol("s");', 'Uncaught Symbol(s)\n'],
      ['throw null;', 'Uncaught null\n'],
      ['throw undefined;', 'Uncaught undefined\n'],
      ['throw "text";', 'Uncaught "text"\n'],
      ['const o = { a: 1 }; o.self = o; throw o;', 'Uncaught { a: 1, self: [Circular] }\n'],
    ];
    for (const [program, err] of cases) {
      const ran = run({ 'main.js': program });
      expect([program, ran.status, ran.err]).toEqual([program, 'error', err]);
    }
    const proxy = 'throw new Proxy({}, { get() { throw new Error("no"); }, ownKeys() { throw new Error("no"); } });';
    expect(run({ 'main.js': proxy }).status).toBe('error');
  });

  it('pins that a rejection is silent unless it is the last value (no rejection tracker in quickjs-emscripten)', () => {
    const ran = run({ 'main.js': 'async function main() { throw new Error("boom"); }\nmain();\nconsole.log("done");' });
    expect([ran.status, ran.out, ran.err]).toEqual(['ok', 'done\n', '']);
  });

  it('ends with a clear error when the main file is not in the project', () => {
    const ran = run({ 'util.js': '1' }, { main: 'main.js' });
    expect(ran.status).toBe('error');
    expect(ran.err).toContain('The project has no file with that name');
  });

  it('reports an uncaught error with its type, and a rejected last promise', () => {
    const thrown = run({ 'main.js': 'null.x' });
    expect(thrown.status).toBe('error');
    expect(thrown.err).toContain('TypeError');
    const rejected = run({ 'main.js': 'async function main() { throw new RangeError("late"); }\nmain();' });
    expect(rejected.status).toBe('error');
    expect(rejected.err).toContain('RangeError: late');
  });

  it('keeps the version lines equal to the pinned packages', () => {
    const root = JSON.parse(readFileSync(new URL('../../../../../../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const pins = root.dependencies;
    expect(pins['quickjs-emscripten-core']).toBe(VERSIONS.quickjs);
    expect(pins.sucrase).toBe(VERSIONS.sucrase);
  });
});

describe('Sucrase keeps line numbers', () => {
  const header = [
    'interface Point {',
    '  x: number;',
    '  y: number;',
    '}',
    'type Pair = [number, number];',
    'const p: Point = { x: 1, y: 2 };',
    'const pair: Pair = [p.x, p.y];',
    'console.log(pair.length);',
  ].join('\n');

  it('reports a runtime error on line 9 of a TypeScript file with interfaces above as line 9', () => {
    const ran = run({ 'main.ts': `${header}\nthrow new Error("line nine");\n` });
    expect(ran.out).toBe('2\n');
    expect(ran.diagnostics).toEqual([{ file: 'main.ts', line: 9, column: 16, message: 'line nine', kind: 'Error' }]);
  });

  it('reports an error inside a function called later at the function line', () => {
    const ran = run({ 'main.ts': `${header}\nfunction f(o: Point | null): number { return o!.x; }\nf(null);\n` });
    expect(ran.diagnostics[0]).toMatchObject({ file: 'main.ts', line: 9, kind: 'TypeError' });
  });

  it('reports a syntax error Sucrase finds on line 9 as line 9', () => {
    const ran = run({ 'main.ts': `${header}\nlet broken: number = ;\n` });
    expect(ran.status).toBe('error');
    expect(ran.diagnostics).toEqual([expect.objectContaining({ file: 'main.ts', line: 9, kind: 'SyntaxError' })]);
  });

  it('keeps every line of the transpiled text in place', () => {
    const source = `${header}\nexport const z: number = 1;\nimport { q } from "./q";\n`;
    const compiled = compile('main.ts', source, transform);
    expect('code' in compiled && compiled.code.split('\n').length).toBe(source.split('\n').length);
  });

  it('leaves a plain script alone, so it keeps sloppy mode', () => {
    expect(usesModules('x = 1;\nconsole.log(x);')).toBe(false);
    expect(usesModules('a.import = 1; exported = 2;')).toBe(false);
    expect(usesModules('import x from "./x";')).toBe(true);
    expect(run({ 'main.js': 'undeclared = 5;\nconsole.log(undeclared);' }).out).toBe('5\n');
    // The words import and export in a string or a comment do not make a module.
    expect(run({ 'main.js': 'x = 1; console.log("please import data", x);' }).out).toBe('please import data 1\n');
    expect(run({ 'main.js': '// TODO: export later\ny = 2;\nconsole.log(y);' }).out).toBe('2\n');
  });

  it('keeps columns on line 1 of a transpiled file equal to the plain file', () => {
    const column = (files: Record<string, string>) => run(files).diagnostics[0]?.column;
    const plain = column({ 'main.js': 'throw new Error("one");' });
    expect(plain).toBe(16);
    expect(column({ 'main.ts': 'throw new Error("one");' })).toBe(plain);
    expect(column({ 'main.js': 'throw new Error("one");\nimport "./u.js";', 'u.js': '' })).toBe(plain);
    expect(column({ 'main.js': 'require("./u.js");', 'u.js': 'throw new Error("one");' })).toBe(plain);
  });

  it('stops with a clear message at constructs Sucrase 3.35.1 compiles wrong', () => {
    const several = run({ 'main.ts': 'const x = 1;\nexport const a = 1, b = 2;\nconsole.log(a, b);' });
    expect(several.status).toBe('error');
    expect(several.err).toContain('Export one name in each statement here');
    expect(several.diagnostics).toEqual([expect.objectContaining({ file: 'main.ts', line: 2, kind: 'SyntaxError' })]);
    const namespace = run({
      'main.ts': '// set up\nnamespace Setup { console.log("configured"); }\nconsole.log("done");',
    });
    expect(namespace.status).toBe('error');
    expect(namespace.out).toBe('');
    expect(namespace.err).toContain('A namespace or module block with code in it cannot run here');
    expect(namespace.diagnostics).toEqual([expect.objectContaining({ file: 'main.ts', line: 2 })]);
    // Every form Sucrase compiles wrong, also where a global of the second name exists and the wrong code would run.
    const forms = [
      'export const a = 1,\n  b = 2;',
      'export let a = 1,b = 2;',
      'export let a, b;',
      'export var a\n, b = 2;',
    ];
    for (const form of forms) {
      const module = run({ 'main.ts': 'var b = 0;\nimport * as u from "./u";\nconsole.log(u.a, b);', 'u.ts': form });
      expect([form, module.status, module.out]).toEqual([form, 'error', '']);
      expect(module.err).toContain('Export one name in each statement here');
      expect(module.diagnostics).toEqual([expect.objectContaining({ file: 'u.ts', line: 1, kind: 'SyntaxError' })]);
    }
    // A comma expression on a line of its own is not an export, even when it starts with an exported name.
    const comma = run({ 'main.ts': 'export let x = 1;\nx, console.log("comma");' });
    expect([comma.status, comma.out]).toEqual(['ok', 'comma\n']);
    const imported = run({ 'main.ts': 'import { a } from "./u";\nconsole.log(a);', 'u.ts': 'export let a = 1, b;' });
    expect(imported.diagnostics).toEqual([expect.objectContaining({ file: 'u.ts', line: 1, kind: 'SyntaxError' })]);
    // A declared namespace has no code, so Sucrase may drop it; one export per statement is fine.
    const fine = [
      'declare namespace D { const x: number; }',
      'export const a = 1;',
      'export const m: Map<string, number> = new Map();',
      'console.log(a, m.size);',
    ].join('\n');
    expect(run({ 'main.ts': fine }).out).toBe('1 0\n');
  });
});

describe('modules', () => {
  it('runs main.ts importing ./util.ts, and folders, .js names for .ts files, and JSON', () => {
    const ran = run(
      {
        'main.ts': [
          "import { add, PI } from './util';",
          "import scale from './lib/scale.js';",
          "import * as data from './data.json';",
          'console.log(add(2, 3), PI, scale(4), data.name);',
        ].join('\n'),
        'util.ts': 'export const add = (a: number, b: number): number => a + b;\nexport const PI = 3.14;',
        'lib/scale.ts':
          "import { add } from '../util.ts';\nexport default function scale(n: number): number { return add(n, n); }",
        'data.json': '{ "name": "demo" }',
      },
      { main: 'main.ts' },
    );
    expect(ran.err).toBe('');
    expect(ran.out).toBe('5 3.14 8 demo\n');
  });

  it('runs a module once, however many files import it', () => {
    const ran = run({
      'main.js': "import './a.js';\nimport './b.js';\nimport { count } from './counter.js';\nconsole.log(count());",
      'a.js': "import { count } from './counter.js';\ncount();",
      'b.js': "import { count } from './counter.js';\ncount();",
      'counter.js': 'console.log("loaded");\nlet n = 0;\nexport function count() { return ++n; }',
    });
    expect(ran.out).toBe('loaded\n3\n');
  });

  it('gives a clear error naming the path of a missing module', () => {
    const ran = run({ 'main.ts': "import { x } from './nope';\nconsole.log(x);" });
    expect(ran.status).toBe('error');
    expect(ran.err).toContain("Cannot find module './nope' imported from main.ts.");
    const pkg = run({ 'main.js': "import _ from 'lodash';" });
    expect(pkg.err).toContain("Cannot find module 'lodash' imported from main.js. Packages are not available here");
  });

  it('maps an error in an imported file to that file and line', () => {
    const ran = run({
      'main.ts': "import { boom } from './util';\nboom();",
      'util.ts': 'export function boom(): void {\n  const o: any = undefined;\n  o.x;\n}',
    });
    expect(ran.diagnostics[0]).toMatchObject({ file: 'util.ts', line: 3, kind: 'TypeError' });
    const syntax = run({
      'main.ts': "import { y } from './bad';\nconsole.log(y);",
      'bad.ts': 'export const y = 1;\nlet z: = 2;',
    });
    expect(syntax.diagnostics[0]).toMatchObject({ file: 'bad.ts', line: 2, kind: 'SyntaxError' });
  });

  it('resolves only paths inside the project', () => {
    const exists = (path: string) => ['a/b.ts', 'c.js'].includes(path);
    expect(resolveModule('./b', 'a/main.ts', exists)).toEqual({ path: 'a/b.ts' });
    expect(resolveModule('../c', 'a/main.ts', exists)).toEqual({ path: 'c.js' });
    expect(resolveModule('../../c', 'a/main.ts', exists)).toEqual({ missing: 'file' });
    expect(resolveModule('https://example.com/x.js', 'main.js', exists)).toEqual({ missing: 'package' });
  });
});

const tests = (source: string, path = 'math.test.ts') => run({ [path]: source }, { tests: true });

describe('TypeScript guards on hostile input', () => {
  // The namespace guard once tried every blank line against all the blank lines after it: 80,000 took 7.9 s.
  it('compiles a 190,000-line blank TypeScript file in well under a second', () => {
    const source = `${'\n'.repeat(190_000)}console.log(1);`;
    compile('main.ts', source, transform);
    const started = performance.now();
    const compiled = compile('main.ts', source, transform);
    expect(performance.now() - started).toBeLessThan(200);
    expect('code' in compiled).toBe(true);
  });
});

describe('the Jest-compatible test API (known answers from Jest documentation)', () => {
  it('passes toBeCloseTo and fails toBe for 0.1 + 0.2 against 0.3', () => {
    const ran = tests(
      [
        "test('close', () => { expect(0.1 + 0.2).toBeCloseTo(0.3); });",
        "test('exact', () => {",
        '  expect(0.1 + 0.2).toBe(0.3);',
        '});',
      ].join('\n'),
    );
    expect(ran.tests.map((result) => [result.name, result.status])).toEqual([
      ['close', 'pass'],
      ['exact', 'fail'],
    ]);
    const failed = ran.tests[1]!;
    expect(failed.message).toContain('Expected: 0.3');
    expect(failed.message).toContain('Received: 0.30000000000000004');
    expect(failed.location).toEqual({ file: 'math.test.ts', line: 3 });
    expect(ran.status).toBe('error');
    expect(ran.out).toContain('Tests: 1 passed, 1 failed, 0 skipped, 2 total.');
  });

  // toBeCloseTo(n, digits = 2) passes when |received - n| < 10^-digits / 2: these sit on each side of that bound.
  it('puts the toBeCloseTo bound at half a unit of the last digit', () => {
    const ran = tests(
      [
        "test('0.304', () => expect(0.304).toBeCloseTo(0.3));",
        "test('0.306', () => expect(0.306).toBeCloseTo(0.3));",
        "test('1.23', () => expect(1.23).toBeCloseTo(1.2, 1));",
        "test('1.26', () => expect(1.26).toBeCloseTo(1.2, 1));",
      ].join('\n'),
    );
    expect(ran.tests.map((result) => [result.name, result.status])).toEqual([
      ['0.304', 'pass'],
      ['0.306', 'fail'],
      ['1.23', 'pass'],
      ['1.26', 'fail'],
    ]);
  });

  it('lets toEqual ignore undefined properties and toStrictEqual not', () => {
    const ran = tests(
      [
        "test('equal', () => expect({ a: 1, b: undefined }).toEqual({ a: 1 }));",
        "test('strict', () => expect({ a: 1, b: undefined }).toStrictEqual({ a: 1 }));",
        "test('array items', () => expect([2]).toEqual([2, undefined]));",
        "test('array length', () => expect([undefined]).toEqual([]));",
        "test('sparse', () => expect([, 1]).toEqual([undefined, 1]));",
        "test('array items strict', () => expect([2]).toStrictEqual([2, undefined]));",
        "test('sparse strict', () => expect([, 1]).toStrictEqual([undefined, 1]));",
        'class LaCroix { constructor(flavor) { this.flavor = flavor; } }',
        "test('types', () => expect(new LaCroix('lemon')).toEqual({ flavor: 'lemon' }));",
        "test('types strict', () => expect(new LaCroix('lemon')).toStrictEqual({ flavor: 'lemon' }));",
      ].join('\n'),
      'equal.test.js',
    );
    // Arrays of different lengths differ, as in Jest's equality check; only a hole equals undefined.
    expect(ran.tests.map((result) => result.status)).toEqual([
      'pass',
      'fail',
      'fail',
      'fail',
      'pass',
      'fail',
      'fail',
      'pass',
      'fail',
    ]);
  });

  it('matches toThrow against a message substring, a pattern, and a class', () => {
    const ran = tests(
      [
        "const boom = () => { throw new TypeError('bad thing happened'); };",
        "test('substring', () => expect(boom).toThrow('thing'));",
        "test('other text', () => expect(boom).toThrow('other'));",
        "test('pattern', () => expect(boom).toThrow(/^bad/));",
        "test('class', () => expect(boom).toThrow(TypeError));",
        "test('no throw', () => expect(() => 1).toThrow());",
        "test('not', () => expect(() => 1).not.toThrow());",
      ].join('\n'),
    );
    expect(ran.tests.map((result) => result.status)).toEqual(['pass', 'fail', 'pass', 'pass', 'fail', 'pass']);
  });

  it('has the other matchers and .not', () => {
    const ran = tests(
      [
        'test("all", () => {',
        '  expect(1).not.toBe(2);',
        '  expect("x").toBeTruthy(); expect(0).toBeFalsy(); expect(null).toBeNull();',
        '  expect(undefined).toBeUndefined(); expect(0).toBeDefined();',
        '  expect([1, 2]).toContain(2); expect("team").not.toContain("I"); expect([1, 2, 3]).toHaveLength(3);',
        '  expect("grey").toMatch(/gr[ae]y/); expect(10).toBeGreaterThan(9); expect(10).toBeGreaterThanOrEqual(10);',
        '  expect(1).toBeLessThan(2); expect(2).toBeLessThanOrEqual(2); expect(0.1234).toBeCloseTo(0.12, 1);',
        '});',
      ].join('\n'),
    );
    expect(ran.tests).toEqual([expect.objectContaining({ name: 'all', status: 'pass' })]);
  });

  it('names tests by their describe blocks and runs hooks in order', () => {
    const ran = tests(
      [
        'const log = [];',
        'beforeEach(() => log.push("outer before"));',
        'afterEach(() => log.push("outer after"));',
        'describe("math", () => {',
        '  beforeEach(() => log.push("inner before"));',
        '  afterEach(() => log.push("inner after"));',
        '  it("adds", () => { log.push("test"); expect(1 + 1).toBe(2); });',
        '});',
        'const order = ["outer before", "inner before", "test", "inner after", "outer after", "outer before"];',
        'test("order", () => expect(log).toEqual(order));',
      ].join('\n'),
      'hooks.test.js',
    );
    expect(ran.tests.map((result) => [result.id, result.name, result.status])).toEqual([
      ['hooks.test.js::math > adds', 'math > adds', 'pass'],
      ['hooks.test.js::order', 'order', 'pass'],
    ]);
  });

  it('runs async tests, and says so when one never finishes', () => {
    const ran = tests(
      [
        'test("async", async () => { const v = await Promise.resolve(3); expect(v).toBe(3); });',
        'test("never", () => new Promise(() => {}));',
        'test("after", () => {});',
      ].join('\n'),
    );
    expect(ran.tests.map((result) => result.status)).toEqual(['pass', 'error', 'error']);
    expect(ran.tests[1]!.message).toContain('The test did not finish');
  });

  it('tells an error in a test from a failed expectation, and a test file that does not load', () => {
    const ran = run(
      {
        'main.ts': 'export const one = 1;',
        'a.test.ts': [
          "import { one } from './main';",
          "test('throws', () => { throw new RangeError('no'); });",
          "test('uses', () => expect(one).toBe(1));",
        ].join('\n'),
        'b.test.ts': "import './missing';",
      },
      { tests: true },
    );
    // A file that does not load is reported when it is loaded, before any test runs.
    expect(ran.tests.map((result) => [result.name, result.status])).toEqual([
      ['b.test.ts', 'error'],
      ['throws', 'error'],
      ['uses', 'pass'],
    ]);
    expect(ran.tests[0]!.message).toContain("Cannot find module './missing'");
  });
});

describe('limits and caps in a test run', () => {
  it('ends the run at the time limit inside a test, sync or async, and does not run later tests', () => {
    for (const body of ['() => { while (true) {} }', 'async () => { await null; while (true) {} }']) {
      const ran = run(
        {
          'spin.test.js': ['test("first", () => {});', `test("spin", ${body});`, 'test("later", () => {});'].join('\n'),
        },
        { tests: true, timeMs: 500 },
      );
      expect(ran.status).toBe('time');
      expect(ran.tests.map((result) => [result.name, result.status])).toEqual([
        ['first', 'pass'],
        ['spin', 'time'],
        ['later', 'skipped'],
      ]);
      expect(ran.tests[1]!.message).toContain('time limit');
    }
  });

  it('ends the run when a test runs out of memory', async () => {
    const limit = 16 * 1024 * 1024;
    const ran = run(
      {
        'hog.test.js': [
          'test("hog", () => { const a = []; while (true) a.push(new Array(1e5).fill(1)); });',
          'test("later", () => {});',
        ].join('\n'),
      },
      { tests: true, engine: await newEngine(limit), memoryBytes: limit, timeMs: 60_000 },
    );
    expect(ran.status).toBe('memory');
    expect(ran.tests.map((result) => [result.name, result.status])).toEqual([
      ['hog', 'error'],
      ['later', 'skipped'],
    ]);
  });

  it('ends the run as "memory" when a test fills the heap with small objects', async () => {
    const ran = run(
      {
        'small.test.js': [
          'test("hog", () => { const a = []; for (;;) a.push({ i: a.length }); });',
          'test("later", () => {});',
        ].join('\n'),
      },
      { tests: true, engine: await newEngine(), timeMs: 60_000 },
    );
    expect(ran.status).toBe('memory');
    expect(ran.tests.map((result) => [result.name, result.status])).toEqual([
      ['hog', 'error'],
      ['later', 'skipped'],
    ]);
    expect(ran.tests[0]!.message).toContain('memory');
    expect(ran.out).not.toContain('PASS');
  });

  // While the run closes, the test API reports the unfinished tests. It must not call code the program replaced, and
  // it has a hard deadline of its own, so the run still ends on time.
  it('reports unfinished tests without the built-ins a program replaced', () => {
    const spoil = [
      'const spin = function () { for (;;) {} };',
      'Array.prototype.join = spin; Date.now = spin; globalThis.Error = spin;',
      'Object.defineProperty(Object.getPrototypeOf(RangeError.prototype), "name", { get: spin });',
    ].join('\n');
    let started = performance.now();
    const timed = run(
      { 'spin.test.js': `${spoil}\ntest("spin", () => { for (;;) {} });\ntest("later", () => {});` },
      { tests: true, timeMs: 300 },
    );
    expect(performance.now() - started).toBeLessThan(3000);
    expect(timed.status).toBe('time');
    expect(timed.tests.map((result) => [result.name, result.status])).toEqual([
      ['spin', 'time'],
      ['later', 'skipped'],
    ]);
    started = performance.now();
    const stuck = run(
      { 'stuck.test.js': `${spoil}\ntest("stuck", () => new Promise(() => {}));\ntest("later", () => {});` },
      { tests: true, timeMs: 2000 },
    );
    expect(performance.now() - started).toBeLessThan(3000);
    expect(stuck.status).toBe('error');
    expect(stuck.tests.map((result) => [result.name, result.status])).toEqual([
      ['stuck', 'error'],
      ['later', 'error'],
    ]);
  });

  it('runs at most PROJECT_LIMITS.tests tests, says so, and numbers equal names', () => {
    const ran = run(
      { 'many.test.js': 'for (let i = 0; i < 501; i++) test("same", () => {});' },
      { tests: true, timeMs: 60_000 },
    );
    expect(ran.tests).toHaveLength(500);
    expect(ran.err).toContain('This run has 501 tests. Only the first 500 ran.');
    expect(ran.status).toBe('error');
    expect(ran.tests.slice(0, 3).map((result) => result.id)).toEqual([
      'many.test.js::same',
      'many.test.js::same (2)',
      'many.test.js::same (3)',
    ]);
    expect(new Set(ran.tests.map((result) => result.id)).size).toBe(500);
  });

  it('stops sending results after process.exit in a test', () => {
    const ran = tests('test("a", () => {});\ntest("b", () => { process.exit(0); });\ntest("c", () => {});');
    expect(ran.tests.map((result) => result.name)).toEqual(['a']);
    expect(ran.exitCode).toBe(0);
  });
});

describe('more of the test API', () => {
  it('runs beforeAll and afterAll once around their describe block', () => {
    const ran = tests(
      [
        'const log = [];',
        'beforeAll(() => log.push("all"));',
        'describe("d", () => {',
        '  beforeAll(() => log.push("d-all"));',
        '  afterAll(() => log.push("d-end"));',
        '  test("one", () => log.push("one"));',
        '  test("two", () => log.push("two"));',
        '});',
        'test("check", () => expect(log).toEqual(["all", "d-all", "one", "two", "d-end"]));',
      ].join('\n'),
    );
    expect(ran.tests.map((result) => result.status)).toEqual(['pass', 'pass', 'pass']);
  });

  it('fails every test of a describe whose beforeAll throws', () => {
    const ran = tests(
      'describe("d", () => {\n  beforeAll(() => { throw new Error("setup"); });\n  test("x", () => {});\n});',
    );
    expect(ran.tests.map((result) => [result.status, result.message])).toEqual([['error', 'Error: setup']]);
  });

  it('refuses .only and .each, and a test inside a test, with clear errors', () => {
    const only = tests('test.only("x", () => {});');
    expect(only.tests[0]!.message).toContain('test.only is not supported here');
    const each = tests('it.each([1])("x", () => {});');
    expect(each.tests[0]!.message).toContain('it.each is not supported here');
    const nested = tests('test("outer", () => { test("inner", () => {}); });');
    expect(nested.tests.map((result) => result.status)).toEqual(['error']);
    expect(nested.tests[0]!.message).toContain('A test cannot start inside another test');
  });

  it('compares symbol keys, and Map keys by value, in toEqual', () => {
    const ran = tests(
      [
        'const s = Symbol("s");',
        'test("symbols", () => expect({ [s]: 1 }).not.toEqual({ [s]: 2 }));',
        'test("map keys", () => expect(new Map([[{ k: 1 }, "v"]])).toEqual(new Map([[{ k: 1 }, "v"]])));',
      ].join('\n'),
    );
    expect(ran.tests.map((result) => result.status)).toEqual(['pass', 'pass']);
  });

  it('keeps reporting when the program replaces JSON.stringify and Object.keys', () => {
    const ran = tests(
      'JSON.stringify = () => "x";\nObject.keys = () => [];\ntest("a", () => expect({ a: 1 }).not.toEqual({ a: 2 }));',
    );
    expect(ran.tests.map((result) => result.status)).toEqual(['pass']);
  });
});

describe('diagnostics in project paths with spaces and parentheses', () => {
  const files = (paths: string[]): RunFile[] => paths.map((path) => ({ path, text: 'a\nb\nc' }));

  it('finds the file from the end of each frame, longest path first', () => {
    const list = files(['my file.ts', 'file.ts', 'main (1).js', 'src/my dir/x (2).ts']);
    const map = (text: string) => quickjsMapper.map(text, list);
    expect(map('Error: a\n    at <eval> (my file.ts:2:16)\n')).toEqual([
      { file: 'my file.ts', line: 2, column: 16, message: 'a', kind: 'Error' },
    ]);
    expect(map('TypeError: b\n    at f (main (1).js:3:1)\n')[0]).toMatchObject({ file: 'main (1).js', line: 3 });
    expect(map('Error: c\n    at src/my dir/x (2).ts:1:2\n')[0]).toMatchObject({ file: 'src/my dir/x (2).ts' });
    expect(map('SyntaxError: Unexpected token (main (1).js:2:3)\n')[0]).toMatchObject({
      file: 'main (1).js',
      line: 2,
      message: 'Unexpected token',
    });
  });

  it('keeps the first error line as the header when its message has more lines', () => {
    const text =
      'AssertionError: expect(received).toBe(2)\n\nExpected: 2\nReceived: 1\n    at <eval> (a.test.ts:2:5)\n';
    expect(quickjsMapper.map(text, files(['a.test.ts']))).toEqual([
      { file: 'a.test.ts', line: 2, column: 5, message: 'expect(received).toBe(2)', kind: 'AssertionError' },
    ]);
  });

  it('maps a real run and a failing test in such files', () => {
    const ran = run({ 'my file.ts': 'const a = 1;\nthrow new Error("here");' });
    expect(ran.diagnostics).toEqual([expect.objectContaining({ file: 'my file.ts', line: 2 })]);
    const tested = run({ 'main (1).test.js': 'test("t", () => {\n  expect(1).toBe(2);\n});' }, { tests: true });
    expect(tested.tests[0]!.location).toEqual({ file: 'main (1).test.js', line: 2 });
  });
});

describe('module edges', () => {
  it('imports "." and ".." as their folder index, and a module that starts with "#!"', () => {
    const ran = run({
      'main.js': 'const a = require("./lib/a.js");\nconsole.log(a.value, require("./tool.js").name);',
      'lib/a.js': 'module.exports = { value: require(".").base + require("..").top };',
      'lib/index.js': 'module.exports = { base: 1 };',
      'index.js': 'module.exports = { top: 2 };',
      'tool.js': '#!/usr/bin/env node\nexports.name = "tool";',
    });
    expect(ran.err).toBe('');
    expect(ran.out).toBe('3 tool\n');
  });
});
