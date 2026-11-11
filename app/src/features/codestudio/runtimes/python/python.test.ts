// Both Python runtimes in Node, with the real MicroPython and the real Pyodide (DESIGN 2.1, 4, 6.1, 7.1).
// - The 20-program suite gives byte-exact output in both. Each answer is worked by hand.
// - CPython 3.12+ messages: "Did you mean" and "Did you forget to import" (the Python 3.12 release notes).
// - A traceback maps to the innermost project file, and the compile() check finds syntax errors without running.
// - Pyodide's ways to JavaScript are refused here too; the sandbox escapes after lockdown run in python.test.tsx.

// checks-disable-file modifiability: one describe block per feature
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadPyodide } from 'pyodide';
import type { RunFile, RunRequest, RuntimeDiagnostic, WorkerMessage } from '../../contracts/run';
import { mapDiagnostics } from '../../run/diagnostics';
import { Mount } from '../../run/mount';
import { RUN_LIMITS } from '../../run/protocol';
import { seeded } from '../../run/random';
import { Stdin } from '../../run/stdin';
import { MICROPYTHON_VERSION, loadMicroPythonEngine } from './micropython';
import { CPYTHON_VERSION, PYODIDE_VERSION, cutOffPyodide, loadPyodideEngine } from './pyodide';
import type { LoadPyodide } from './pyodide';
import { checkPython, runPython } from './session';
import type { PythonEngine } from './session';
import { pythonMapper } from './traceback';

// Pyodide takes seconds to start on a loaded machine, and fib(30) takes a while in MicroPython.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const ROOT = new URL('../../../../../../', import.meta.url);
const MICROPYTHON_WASM = fileURLToPath(
  new URL('node_modules/@micropython/micropython-webassembly-pyscript/micropython.wasm', ROOT),
);
const PYODIDE_DIR = fileURLToPath(new URL('node_modules/pyodide/', ROOT));

type Kind = 'quick' | 'full';

let full: PythonEngine;
beforeAll(async () => {
  full = await loadPyodideEngine(loadPyodide as unknown as LoadPyodide, PYODIDE_DIR);
  cutOffPyodide(full);
});

/** A fresh MicroPython for each run, as each run gets a fresh worker; Pyodide is reused (the prelude resets it). */
const engineFor = async (kind: Kind) => (kind === 'full' ? full : await loadMicroPythonEngine(MICROPYTHON_WASM));

interface Ran {
  status: string;
  exitCode?: number;
  message: string;
  out: string;
  err: string;
  diagnostics: RuntimeDiagnostic[];
  written: RunFile[];
  inputEnded: boolean;
}

async function run(
  kind: Kind,
  files: Record<string, string>,
  more: { main?: string; stdin?: string; args?: string[]; seed?: number } = {},
): Promise<Ran> {
  const list: RunFile[] = Object.entries(files).map(([path, text]) => ({ path, text }));
  const request: RunRequest = {
    kind: 'run',
    runtime: kind === 'full' ? 'python-full' : 'python-quick',
    files: list,
    main: more.main ?? list[0]!.path,
    args: more.args ?? [],
    stdin: { mode: 'prefilled', text: more.stdin ?? '' },
    limits: RUN_LIMITS,
    seed: more.seed ?? 1,
  };
  const messages: WorkerMessage[] = [];
  const random = seeded(request.seed);
  const stdin = new Stdin(request.stdin.text, false);
  const mount = new Mount(list);
  const end = runPython(await engineFor(kind), request, (message) => messages.push(message), {
    stdin,
    files: mount,
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
    message: end.message,
    out: text('out'),
    err,
    diagnostics: mapDiagnostics(pythonMapper, err, list),
    written: mount.written(),
    inputEnded: stdin.askedPastEnd,
  };
}

interface Program {
  name: string;
  files: Record<string, string>;
  out: string;
  stdin?: string;
  args?: string[];
  written?: RunFile[];
}

const lines = (...text: string[]) => text.join('\n') + '\n';
const lastLine = (text: string) => text.trimEnd().split('\n').at(-1);

// Every answer below is worked by hand: sums and products by arithmetic, 0.1 + 0.2 as the double nearest
// 0.30000000000000004 (shortest repr), floor division and modulo rounding toward negative infinity.
const PROGRAMS: Program[] = [
  { name: 'hello', files: { 'main.py': 'print("Hello, world!")\n' }, out: 'Hello, world!\n' },
  { name: 'sum 1..100', files: { 'main.py': 'print(sum(range(1, 101)))\n' }, out: '5050\n' },
  {
    name: 'fib(30)',
    files: { 'main.py': lines('def fib(n):', '    return n if n < 2 else fib(n - 1) + fib(n - 2)', 'print(fib(30))') },
    out: '832040\n',
  },
  {
    name: 'sorted',
    files: {
      'main.py': lines(
        'print(sorted([5, 2, 9, 1, 5, 6]))',
        'print(sorted(["pear", "fig", "apple"], key=len, reverse=True))',
        'print(sorted("banana"))',
      ),
    },
    out: lines('[1, 2, 5, 5, 6, 9]', "['apple', 'pear', 'fig']", "['a', 'a', 'a', 'b', 'n', 'n']"),
  },
  {
    name: 'f-strings',
    files: {
      'main.py': lines(
        'name, pi, n = "Ada", 3.14159, 7',
        'print(f"{name}: {pi:.3f} [{n:>4}] {n:03d} {255:x} {name!r}")',
        'print(f"{n * 6} {pi:.1f}% {-n:+d}")',
      ),
    },
    out: lines("Ada: 3.142 [   7] 007 ff 'Ada'", '42 3.1% -7'),
  },
  {
    name: 'Unicode',
    files: {
      'main.py': lines(
        's = "héllo wörld ✓"',
        'print(s, len(s), s[1], s[-1], s.split()[1])',
        'print(ord("é"), chr(0x2713), len("🐍"))',
      ),
    },
    out: lines('héllo wörld ✓ 13 é ✓ wörld', '233 ✓ 1'),
  },
  {
    name: 'big integers',
    files: { 'main.py': lines('f = 1', 'for i in range(1, 21):', '    f *= i', 'print(f)', 'print(2 ** 100)') },
    out: lines('2432902008176640000', '1267650600228229401496703205376'),
  },
  {
    name: 'primes below 50',
    files: {
      'main.py': lines(
        'primes = [n for n in range(2, 50) if all(n % d for d in range(2, n))]',
        'print(" ".join(str(p) for p in primes))',
      ),
    },
    out: '2 3 5 7 11 13 17 19 23 29 31 37 41 43 47\n',
  },
  {
    name: 'comprehensions',
    files: {
      'main.py': lines('print([x * x for x in range(10) if x % 2 == 0])', 'print({k: len(k) for k in ["a", "bb"]})'),
    },
    out: lines('[0, 4, 16, 36, 64]', "{'a': 1, 'bb': 2}"),
  },
  {
    name: 'word count',
    files: {
      'main.py': lines(
        'counts = {}',
        'for word in "the cat and the hat".split():',
        '    counts[word] = counts.get(word, 0) + 1',
        'print(sorted(counts.items()))',
      ),
    },
    out: "[('and', 1), ('cat', 1), ('hat', 1), ('the', 2)]\n",
  },
  {
    name: 'string methods',
    files: {
      'main.py': lines(
        'parts = " a,b,,c ".strip().split(",")',
        'print(parts, "-".join(parts), "Abc".lower(), "abc".upper(), "a1".isdigit(), "Hi".startswith("H"))',
      ),
    },
    out: "['a', 'b', '', 'c'] a-b--c abc ABC False True\n",
  },
  {
    name: 'classes',
    files: {
      'main.py': lines(
        'class Point:',
        '    def __init__(self, x, y):',
        '        self.x, self.y = x, y',
        '    def __add__(self, other):',
        '        return Point(self.x + other.x, self.y + other.y)',
        '    def __repr__(self):',
        '        return "Point(%d, %d)" % (self.x, self.y)',
        'print(Point(1, 2) + Point(3, 4))',
      ),
    },
    out: 'Point(4, 6)\n',
  },
  {
    name: 'exceptions',
    files: {
      'main.py': lines(
        'try:',
        '    int("x")',
        'except ValueError:',
        '    print("bad number")',
        'finally:',
        '    print("done")',
      ),
    },
    out: lines('bad number', 'done'),
  },
  {
    name: 'generators',
    files: {
      'main.py': lines(
        'def evens(n):',
        '    for i in range(n):',
        '        if i % 2 == 0:',
        '            yield i',
        'print(list(evens(9)), sum(evens(100)))',
      ),
    },
    out: '[0, 2, 4, 6, 8] 2450\n',
  },
  {
    name: 'standard input',
    files: { 'main.py': lines('a = int(input())', 'b = int(input("b? "))', 'print(a + b)') },
    stdin: '3\n4\n',
    out: 'b? 7\n',
  },
  {
    name: 'arguments',
    files: { 'main.py': lines('import sys', 'print(sys.argv)') },
    args: ['a', 'b c'],
    out: "['main.py', 'a', 'b c']\n",
  },
  {
    name: 'modules across files',
    files: {
      'main.py': lines('from util import double', 'print(double(21))'),
      'util.py': 'def double(x):\n    return 2 * x\n',
    },
    out: '42\n',
  },
  {
    name: 'floor division and modulo',
    files: { 'main.py': 'print(-7 // 2, -7 % 2, divmod(17, 5), 7 / 2, 2 ** -1)\n' },
    out: '-4 1 (3, 2) 3.5 0.5\n',
  },
  {
    name: 'floats',
    files: { 'main.py': 'print(0.1 + 0.2, 1 / 3, 1e16, 1e-05, float("inf"), round(7.5))\n' },
    out: '0.30000000000000004 0.3333333333333333 1e+16 1e-05 inf 8\n',
  },
  {
    name: 'writes a file',
    files: {
      'main.py': lines(
        'with open("out.txt", "w") as f:',
        '    f.write("done\\n")',
        'print(open("out.txt").read(), end="")',
      ),
    },
    out: 'done\n',
    written: [{ path: 'out.txt', text: 'done\n' }],
  },
];

describe.each(['quick', 'full'] as const)('the 20-program suite in Python (%s)', (kind) => {
  it.each(PROGRAMS)('$name', async (program) => {
    const ran = await run(kind, program.files, {
      ...(program.stdin === undefined ? {} : { stdin: program.stdin }),
      ...(program.args === undefined ? {} : { args: program.args }),
    });
    expect(ran.err).toBe('');
    expect(ran.out).toBe(program.out);
    expect(ran.status).toBe('ok');
    expect(ran.exitCode).toBe(0);
    expect(ran.written).toEqual(program.written ?? []);
  });

  it('has twenty programs', () => {
    expect(PROGRAMS).toHaveLength(20);
  });
});

describe('CPython known answers (Python 3.12 and later, full Python)', () => {
  // The messages are CPython's, as the Python 3.12 release notes show them ("Improved Error Messages").
  it('suggests print for pritn', async () => {
    const ran = await run('full', { 'main.py': 'pritn(1)\n' });
    expect(ran.status).toBe('error');
    expect(ran.message).toBe('NameError');
    expect(lastLine(ran.err)).toBe("NameError: name 'pritn' is not defined. Did you mean: 'print'?");
    expect(ran.err.startsWith('Traceback (most recent call last):\n  File "main.py", line 1, in <module>\n')).toBe(
      true,
    );
  });

  it('asks whether math was imported', async () => {
    const ran = await run('full', { 'main.py': 'print(math.sqrt(4))\n' });
    const message = "NameError: name 'math' is not defined. Did you forget to import 'math'?";
    expect(lastLine(ran.err)).toBe(message);
    expect(ran.diagnostics).toEqual([{ file: 'main.py', line: 1, message, kind: 'NameError' }]);
  });

  it('reports the version it pins', async () => {
    const ran = await run('full', { 'main.py': 'import sys\nprint(sys.version.split()[0])\n' });
    expect(ran.out).toBe(`${CPYTHON_VERSION}\n`);
  });
});

describe.each(['quick', 'full'] as const)('errors and diagnostics in Python (%s)', (kind) => {
  const project = {
    'main.py': lines('import util', 'print("start")', 'util.f()'),
    'util.py': lines('def f():', '    x = 1', '    return y'),
  };

  it('maps an error on line 3 of util.py, imported from main.py, to util.py:3', async () => {
    const ran = await run(kind, project);
    expect(ran.out).toBe('start\n');
    expect(ran.status).toBe('error');
    expect(ran.exitCode).toBe(1);
    expect(ran.diagnostics).toHaveLength(1);
    expect(ran.diagnostics[0]).toMatchObject({ file: 'util.py', line: 3, kind: 'NameError' });
    // The traceback shows project paths, never the mount's folder, and none of the runner's own frames.
    expect(ran.err).toContain('File "util.py", line 3, in f');
    expect(ran.err).toContain('File "main.py", line 3, in <module>');
    expect(ran.err).not.toMatch(/\/project|<exec>|<stdin>/);
  });

  it('runs a main file in a folder with imports beside it', async () => {
    const ran = await run(kind, { 'src/app.py': 'import helper\nprint(helper.N)\n', 'src/helper.py': 'N = 5\n' });
    expect(ran.out).toBe('5\n');
  });

  it('reports a syntax error in the main file and runs nothing', async () => {
    const ran = await run(kind, { 'main.py': 'print(1)\nif x\n    pass\n' });
    expect(ran.status).toBe('error');
    expect(ran.out).toBe('');
    expect(ran.message).toBe('SyntaxError');
    expect(ran.diagnostics[0]).toMatchObject({ file: 'main.py', line: 2, kind: 'SyntaxError' });
    if (kind === 'full') expect(lastLine(ran.err)).toBe("SyntaxError: expected ':'");
  });

  it('gives exit codes: sys.exit(), sys.exit(3), and sys.exit("bye")', async () => {
    const ok = await run(kind, { 'main.py': 'import sys\nprint("a")\nsys.exit()\nprint("b")\n' });
    expect([ok.status, ok.exitCode, ok.out, ok.err]).toEqual(['ok', 0, 'a\n', '']);
    const three = await run(kind, { 'main.py': 'import sys\nsys.exit(3)\n' });
    expect([three.status, three.exitCode, three.message, three.err]).toEqual(['error', 3, 'SystemExit', '']);
    const bye = await run(kind, { 'main.py': 'import sys\nsys.exit("bye")\n' });
    expect([bye.status, bye.exitCode, bye.err]).toEqual(['error', 1, 'bye\n']);
  });

  it('checks a file with compile() without running it', async () => {
    const engine = await engineFor(kind);
    const bad = { path: 'main.py', text: 'print("ran")\nif x\n    pass\n' };
    const found = checkPython(engine, bad, [bad]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: 'main.py', line: 2, kind: 'SyntaxError' });
    // CPython gives the column too: the colon is missing after "if x", at column 5.
    if (kind === 'full') expect(found[0]).toMatchObject({ column: 5, message: "SyntaxError: expected ':'" });
    const good = { path: 'util.py', text: 'def f():\n    return y\n' };
    expect(checkPython(engine, good, [bad, good])).toEqual([]);
  });
});

describe('a reused full Python', () => {
  it('forgets the last run project modules', async () => {
    await run('full', { 'main.py': 'import util\nprint(util.A)\n', 'util.py': 'A = 1\n' });
    const second = await run('full', { 'main.py': 'import util\nprint(util.A)\n', 'util.py': 'A = 2\n' });
    expect(second.out).toBe('2\n');
  });
});

describe.each(['quick', 'full'] as const)('input, arguments, and seeds in Python (%s)', (kind) => {
  it('raises EOFError past the end of the input, and the run notes it', async () => {
    const ran = await run(kind, { 'main.py': 'print(input())\nprint(input())\n' }, { stdin: 'one\n' });
    expect(ran.out).toBe('one\n');
    expect(lastLine(ran.err)).toBe('EOFError: EOF when reading a line');
    expect(ran.inputEnded).toBe(true);
  });

  it('reads sys.stdin to its end without the note', async () => {
    const program = lines(
      'import sys',
      'for line in sys.stdin:',
      '    print(line.strip().upper())',
      'print(sys.stdin.read() == "")',
    );
    const ran = await run(kind, { 'main.py': program }, { stdin: 'a\r\nb' });
    expect(ran.out).toBe('A\nB\nTrue\n');
    expect(ran.inputEnded).toBe(false);
  });

  it('gives the same random numbers for the same seed', async () => {
    const program = 'import random\nprint([random.randint(1, 1000) for _ in range(5)])\n';
    const first = await run(kind, { 'main.py': program }, { seed: 7 });
    const again = await run(kind, { 'main.py': program }, { seed: 7 });
    const other = await run(kind, { 'main.py': program }, { seed: 8 });
    expect(first.out).toBe(again.out);
    expect(first.out).not.toBe(other.out);
  });
});

describe('the sandbox of full Python, without lockdown (python.test.tsx repeats it after lockdown)', () => {
  it('refuses the js module, pyodide.ffi, and pyodide.http, and has no host files', async () => {
    const program = lines(
      'import os',
      'for name in ["js", "pyodide.ffi", "pyodide.http", "pyodide_js", "_pyodide_core"]:',
      '    try:',
      '        __import__(name)',
      '        print(name, "imported")',
      '    except ModuleNotFoundError:',
      '        print(name, "refused")',
      'try:',
      '    open("/etc/passwd")',
      'except OSError as e:',
      '    print("passwd", type(e).__name__)',
      'print(sorted(os.listdir(".")))',
    );
    const ran = await run('full', { 'main.py': program, 'data.txt': 'x' });
    expect(ran.err).toBe('');
    expect(ran.out).toBe(
      lines(
        'js refused',
        'pyodide.ffi refused',
        'pyodide.http refused',
        'pyodide_js refused',
        '_pyodide_core refused',
        'passwd FileNotFoundError',
        "['data.txt', 'main.py']",
      ),
    );
  });
});

describe('quick Python limits', () => {
  it('ends with "memory" when the program fills the fixed heap', async () => {
    const engine = await loadMicroPythonEngine(MICROPYTHON_WASM, 2 * 1024 * 1024);
    const files: RunFile[] = [{ path: 'main.py', text: 'a = []\nwhile True:\n    a.append("x" * 10000)\n' }];
    const random = seeded(1);
    const request: RunRequest = {
      kind: 'run',
      runtime: 'python-quick',
      files,
      main: 'main.py',
      args: [],
      stdin: { mode: 'prefilled', text: '' },
      limits: RUN_LIMITS,
      seed: 1,
    };
    const context = {
      stdin: new Stdin('', false),
      files: new Mount(files),
      random: random.random,
      randomBytes: random.fill,
      deadline: 0,
    };
    expect(runPython(engine, request, () => undefined, context).status).toBe('memory');
  });
});

describe('versions', () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it('pins the versions in package.json and the pack catalog', () => {
    expect(pkg.dependencies['@micropython/micropython-webassembly-pyscript']).toBe(MICROPYTHON_VERSION);
    expect(pkg.devDependencies['pyodide']).toBe(PYODIDE_VERSION);
    const catalog = readFileSync(new URL('app/src-tauri/src/packs/catalog.rs', ROOT), 'utf8');
    expect(catalog).toContain(`pub const PYODIDE_VERSION: &str = "${PYODIDE_VERSION}";`);
  });

  it('runs the MicroPython it names', async () => {
    const ran = await run('quick', { 'main.py': 'import sys\nprint(sys.implementation.version[:3])\n' });
    expect(ran.out).toBe(`(${MICROPYTHON_VERSION.split('.').join(', ')})\n`);
  });
});

describe('the traceback mapper', () => {
  const files: RunFile[] = [
    { path: 'main.py', text: 'a\nb\nc\n' },
    { path: 'pkg/util.py', text: 'a\nb\nc\nd\n' },
  ];

  it('takes the innermost project frame of the last traceback, past the runtime files', () => {
    const text = lines(
      'some output',
      'Traceback (most recent call last):',
      '  File "main.py", line 2, in <module>',
      '    b',
      '  File "/project/pkg/util.py", line 4, in g',
      '    d',
      '  File "/lib/python314.zip/json/__init__.py", line 9, in loads',
      'ValueError: bad',
    );
    expect(pythonMapper.map(text, files)).toEqual([
      { file: 'pkg/util.py', line: 4, message: 'ValueError: bad', kind: 'ValueError' },
    ]);
  });

  it('reads a syntax error without a header and an exception without a message', () => {
    const syntax = lines('  File "main.py", line 9', '    x', '    ^', 'SyntaxError: invalid syntax');
    expect(pythonMapper.map(syntax, files)).toEqual([
      { file: 'main.py', line: 4, message: 'SyntaxError: invalid syntax', kind: 'SyntaxError' },
    ]);
    const bare = lines(
      'Traceback (most recent call last):',
      '  File "main.py", line 1, in <module>',
      'KeyboardInterrupt',
    );
    expect(pythonMapper.map(bare, files)).toEqual([
      { file: 'main.py', line: 1, message: 'KeyboardInterrupt', kind: 'KeyboardInterrupt' },
    ]);
    expect(pythonMapper.map('NameError: no frames here\n', files)).toEqual([]);
  });
});
