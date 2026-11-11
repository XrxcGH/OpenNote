// The JavaScript and TypeScript runtime in Node, with the real QuickJS and the real Sucrase (DESIGN 2.1, 4, 9).
// - The 20-program suite runs in both languages. Its answers are worked by hand or come from the language specification.
// - Sucrase keeps line numbers, so errors map to the line in the TypeScript file.
// - Modules work across project files, and a missing one gives a clear error.
// - The Jest-compatible test API gives the known answers from Jest's documentation.
// The sandbox escapes run in a real worker in js.test.tsx.

// checks-disable-file modifiability: one describe block per feature
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
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
import { runProgram } from './engine';
import type { Engine } from './engine';
import { resolveModule } from './modules';
import { compile, usesModules } from './transpile';

let engine: Engine;
beforeAll(async () => {
  engine = { quickjs: await newQuickJSWASMModuleFromVariant(releaseSync), transform };
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
  more: { main?: string; stdin?: string; args?: string[]; tests?: boolean; timeMs?: number } = {},
): Ran {
  const list: RunFile[] = Object.entries(files).map(([path, text]) => ({ path, text }));
  const request: RunRequest = {
    kind: 'run',
    runtime: 'typescript',
    files: list,
    main: more.main ?? list[0]!.path,
    args: more.args ?? [],
    stdin: { mode: 'prefilled', text: more.stdin ?? '' },
    limits: { ...RUN_LIMITS, timeMs: more.timeMs ?? RUN_LIMITS.timeMs },
    seed: 1,
    ...(more.tests ? { test: { cases: [], framework: true } } : {}),
  };
  const messages: WorkerMessage[] = [];
  const random = seeded(request.seed);
  const end = runProgram(engine, request, (message) => messages.push(message), {
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

  // The first growth of a fresh WebAssembly heap to the memory limit can take seconds on a loaded machine.
  it('stops at the memory limit and at the time limit', { timeout: 120_000 }, () => {
    const hog = 'const a = []; while (true) a.push(new Array(1e5).fill(1));';
    expect(run({ 'main.js': hog }, { timeMs: 100_000 }).status).toBe('memory');
    expect(run({ 'main.js': 'while (true) {}' }, { timeMs: 300 }).status).toBe('time');
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
    expect(ran.diagnostics).toEqual([
      { file: 'main.ts', line: 9, column: expect.any(Number), message: 'line nine', kind: 'Error' },
    ]);
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

  it('lets toEqual ignore undefined properties and toStrictEqual not', () => {
    const ran = tests(
      [
        "test('equal', () => expect({ a: 1, b: undefined }).toEqual({ a: 1 }));",
        "test('strict', () => expect({ a: 1, b: undefined }).toStrictEqual({ a: 1 }));",
        "test('array items', () => expect([2]).toEqual([2, undefined]));",
        "test('array items strict', () => expect([2]).toStrictEqual([2, undefined]));",
        "test('sparse strict', () => expect([, 1]).toStrictEqual([undefined, 1]));",
        'class LaCroix { constructor(flavor) { this.flavor = flavor; } }',
        "test('types', () => expect(new LaCroix('lemon')).toEqual({ flavor: 'lemon' }));",
        "test('types strict', () => expect(new LaCroix('lemon')).toStrictEqual({ flavor: 'lemon' }));",
      ].join('\n'),
      'equal.test.js',
    );
    expect(ran.tests.map((result) => result.status)).toEqual(['pass', 'fail', 'pass', 'fail', 'fail', 'pass', 'fail']);
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
