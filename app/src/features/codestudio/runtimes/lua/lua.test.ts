// The Lua runtime in Node, with the real wasmoon 1.16.0 (Lua 5.4) (DESIGN 2.1, 4, 10).
// A 20-program subset: every answer is worked by hand or follows from the Lua 5.4 reference manual (integer and
// float division, `^` always gives a float, `#` counts bytes, string.format follows C's printf). Then errors mapped
// to project lines, modules across files, input, the time and memory limits, and the escapes that must be closed.

// checks-disable-file modifiability: one describe block per feature
// checks-disable-file length: the Lua programs are one-line strings, as the table of cases reads best
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { LuaFactory } from 'wasmoon';
import type { RunFile, RunRequest, RuntimeDiagnostic, WorkerMessage } from '../../contracts/run';
import { mapDiagnostics } from '../../run/diagnostics';
import { Mount } from '../../run/mount';
import { RUN_LIMITS } from '../../run/protocol';
import { seeded } from '../../run/random';
import { Stdin } from '../../run/stdin';
import { WASMOON_VERSION } from './adapter';
import { luaMapper } from './diagnostics';
import { checkLua, runLua } from './engine';

let factory: LuaFactory;
beforeAll(async () => {
  factory = new LuaFactory();
  await factory.getLuaModule();
});

interface Ran {
  status: string;
  exitCode?: number;
  out: string;
  err: string;
  diagnostics: RuntimeDiagnostic[];
  written: string[];
}

async function run(
  files: Record<string, string>,
  more: { main?: string; stdin?: string; seed?: number; timeMs?: number; memoryBytes?: number } = {},
): Promise<Ran> {
  const list: RunFile[] = Object.entries(files).map(([path, text]) => ({ path, text }));
  const request: RunRequest = {
    kind: 'run',
    runtime: 'lua',
    files: list,
    main: more.main ?? list[0]!.path,
    args: ['one'],
    stdin: { mode: 'prefilled', text: more.stdin ?? '' },
    limits: {
      ...RUN_LIMITS,
      timeMs: more.timeMs ?? RUN_LIMITS.timeMs,
      memoryBytes: more.memoryBytes ?? RUN_LIMITS.memoryBytes,
    },
    seed: more.seed ?? 1,
  };
  const messages: WorkerMessage[] = [];
  const random = seeded(request.seed);
  const mount = new Mount(list);
  const end = await runLua(factory, request, (message) => messages.push(message), {
    stdin: new Stdin(request.stdin.text, false),
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
    out: text('out'),
    err,
    diagnostics: mapDiagnostics(luaMapper, err, list),
    written: mount.paths().filter((path) => !(path in files)),
  };
}

interface Program {
  name: string;
  source: string;
  out: string;
  stdin?: string;
}

// Each answer is worked by hand. 7 // 2 is 3 (floor division of integers); 7 / 2 is 3.5 and 10 / 2 is 5.0 (`/` is
// always a float); 2 ^ 10 is 1024.0; -7 // 2 is -4 and -7 % 3 is 2 (floor semantics); #"héllo" is 6 (bytes).
const PROGRAMS: Program[] = [
  { name: 'hello', source: 'print("Hello, world!")', out: 'Hello, world!\n' },
  {
    name: 'arithmetic',
    source: 'print(7 // 2, 7 / 2, 10 / 2, 2 ^ 10, -7 // 2, -7 % 3, 7 % -3)',
    out: '3\t3.5\t5.0\t1024.0\t-4\t2\t-2\n',
  },
  {
    name: 'fizzbuzz',
    source:
      'for i = 1, 15 do\n  local s = (i % 15 == 0 and "FizzBuzz") or (i % 3 == 0 and "Fizz") or (i % 5 == 0 and "Buzz") or i\n  io.write(s, " ")\nend\nprint()',
    out: '1 2 Fizz 4 Buzz Fizz 7 8 Fizz Buzz 11 Fizz 13 14 FizzBuzz \n',
  },
  {
    name: 'factorial',
    source: 'local function f(n) if n <= 1 then return 1 end return n * f(n - 1) end\nprint(f(10), f(20))',
    out: '3628800\t2432902008176640000\n',
  },
  {
    name: 'fibonacci',
    source: 'local a, b = 0, 1\nfor _ = 1, 10 do a, b = b, a + b end\nprint(a)',
    out: '55\n',
  },
  {
    name: 'strings',
    source:
      'local s = "Hello"\nprint(s:upper(), s:lower(), #s, s:rep(2, "-"), s:sub(2, 4), s:reverse(), ("a,b,c"):gsub(",", ";"))',
    out: 'HELLO\thello\t5\tHello-Hello\tell\tolleH\ta;b;c\t2\n',
  },
  { name: 'bytes and utf8', source: 'print(#"héllo", utf8.len("héllo"))', out: '6\t5\n' },
  {
    name: 'format',
    source: 'print(string.format("%5.2f|%-4d|%04d|%x|%s", 3.14159, 42, 42, 255, "ok"))',
    out: ' 3.14|42  |0042|ff|ok\n',
  },
  {
    name: 'sort',
    source:
      'local t = {5, 2, 8, 1}\ntable.sort(t)\nprint(table.concat(t, ","))\ntable.sort(t, function(a, b) return a > b end)\nprint(table.concat(t, ","))',
    out: '1,2,5,8\n8,5,2,1\n',
  },
  {
    name: 'closures',
    source:
      'local function counter() local n = 0 return function() n = n + 1 return n end end\nlocal c = counter()\nc() c()\nprint(c())',
    out: '3\n',
  },
  {
    name: 'metatables',
    source:
      'local V = {}\nV.__index = V\nV.__add = function(a, b) return setmetatable({x = a.x + b.x}, V) end\nV.__tostring = function(v) return "V(" .. v.x .. ")" end\nprint(setmetatable({x = 1}, V) + setmetatable({x = 2}, V))',
    out: 'V(3)\n',
  },
  {
    name: 'coroutines',
    source:
      'local gen = coroutine.wrap(function() for i = 1, 3 do coroutine.yield(i * i) end end)\nprint(gen(), gen(), gen())',
    out: '1\t4\t9\n',
  },
  {
    name: 'pcall',
    source: 'print(pcall(error, "boom", 0))\nprint(select("#", pcall(error)))',
    out: 'false\tboom\n2\n',
  },
  {
    name: 'integers',
    source: 'print(math.maxinteger, math.mininteger, math.maxinteger + 1 == math.mininteger)',
    out: '9223372036854775807\t-9223372036854775808\ttrue\n',
  },
  {
    name: 'types',
    source: 'print(type(1), type(1.5), math.type(1), math.type(1.0), math.type("1"), type(nil), type(print))',
    out: 'number\tnumber\tinteger\tfloat\tnil\tnil\tfunction\n',
  },
  {
    name: 'goto and while',
    source:
      'local i, sum = 0, 0\nwhile true do\n  i = i + 1\n  if i > 10 then goto done end\n  if i % 2 == 0 then goto continue end\n  sum = sum + i\n  ::continue::\nend\n::done::\nprint(sum)',
    out: '25\n',
  },
  {
    name: 'integer for loop',
    source: 'local t = {}\nfor i = 10, 1, -3 do t[#t + 1] = i end\nprint(table.concat(t, " "))',
    out: '10 7 4 1\n',
  },
  {
    name: 'string.find',
    source: 'print(("hello world"):find("o w"), ("hello"):find("l+"), ("key=val"):match("(%w+)=(%w+)"))',
    out: '5\t3\tkey\tval\n',
  },
  {
    name: 'read lines',
    source: 'local sum = 0\nfor line in io.lines() do sum = sum + tonumber(line) end\nprint(sum)',
    stdin: '10\n20\n30\n',
    out: '60\n',
  },
  {
    name: 'read numbers',
    source: 'local a, b = io.read("n", "n")\nprint(a + b, math.type(a), math.type(b))',
    stdin: '4 2.5\n',
    out: '6.5\tinteger\tfloat\n',
  },
  {
    name: 'read a line then all',
    source: 'print(io.read())\nprint(io.read("a"))',
    stdin: 'first\nsecond\nthird',
    out: 'first\nsecond\nthird\n',
  },
  {
    name: 'read to the end',
    source: 'print(io.read(), io.read("l"), io.read(0))',
    stdin: 'only\n',
    out: 'only\tnil\tnil\n',
  },
  { name: 'arg table', source: 'print(arg[0], arg[1], #arg)', out: 'main.lua\tone\t1\n' },
];

describe('programs', () => {
  for (const program of PROGRAMS) {
    it(program.name, async () => {
      const ran = await run(
        { 'main.lua': program.source },
        program.stdin === undefined ? {} : { stdin: program.stdin },
      );
      expect(ran.err).toBe('');
      expect(ran.out).toBe(program.out);
      expect(ran.status).toBe('ok');
    });
  }

  it('gives the same random numbers for the same seed, and others for another', async () => {
    const source =
      'local t = {} for i = 1, 5 do t[i] = math.random(1, 1000000) end print(table.concat(t, " "), math.random() < 1)';
    const a = await run({ 'main.lua': source }, { seed: 7 });
    const b = await run({ 'main.lua': source }, { seed: 7 });
    const c = await run({ 'main.lua': source }, { seed: 8 });
    expect(a.out).toBe(b.out);
    expect(a.out).not.toBe(c.out);
    expect(a.out).toMatch(/^\d+( \d+){4}\ttrue\n$/);
  });

  it('ends with the exit code os.exit gives', async () => {
    const ran = await run({ 'main.lua': 'print("a")\nos.exit(3)\nprint("b")' });
    expect(ran).toMatchObject({ status: 'error', exitCode: 3, out: 'a\n', err: '' });
    expect((await run({ 'main.lua': 'os.exit(true)' })).status).toBe('ok');
    expect(await run({ 'main.lua': 'os.exit(false)' })).toMatchObject({ status: 'error', exitCode: 1 });
  });

  it('writes the standard streams with io.write, io.stdout, and io.stderr', async () => {
    const ran = await run({
      'main.lua':
        'io.write("a", 1, 2.5, "\\n")\nio.stdout:write("b"):write("c\\n")\nio.stderr:write("e\\n")\nprint(pcall(io.write, {}))',
    });
    expect(ran.out).toBe("a12.5\nbc\nfalse\tbad argument #1 to 'write' (string expected, got table)\n");
    expect(ran.err).toBe('e\n');
  });
});

describe('errors', () => {
  it('maps an arithmetic error on nil to its line', async () => {
    const ran = await run({ 'main.lua': 'local x = nil\nprint("a")\nlocal y = x + 1\nprint(y)' });
    expect(ran.status).toBe('error');
    expect(ran.exitCode).toBe(1);
    expect(ran.out).toBe('a\n');
    expect(ran.err).toBe("lua: main.lua:3: attempt to perform arithmetic on a nil value (local 'x')\n");
    expect(ran.diagnostics).toEqual([
      {
        file: 'main.lua',
        line: 3,
        message: "attempt to perform arithmetic on a nil value (local 'x')",
        kind: 'LuaError',
      },
    ]);
  });

  it('reports error() with a message, a call of nil, and an index of nil, each at its line', async () => {
    const lines = async (source: string) =>
      (await run({ 'main.lua': source })).diagnostics.map((d) => [d.line, d.message]);
    expect(await lines('\n\nerror("custom")')).toEqual([[3, 'custom']]);
    expect(await lines('local t = {}\nt.f()')).toEqual([[2, "attempt to call a nil value (field 'f')"]]);
    expect(await lines('local t\n\nprint(t.x)')).toEqual([[3, "attempt to index a nil value (local 't')"]]);
  });

  it('finds a syntax error with load, without running the file', async () => {
    const file: RunFile = { path: 'main.lua', text: 'print("ok")\nlocal x = = 3\n' };
    expect(await checkLua(factory, file)).toEqual([
      { file: 'main.lua', line: 2, message: "unexpected symbol near '='", kind: 'SyntaxError' },
    ]);
    expect(await checkLua(factory, { path: 'main.lua', text: 'print(1)' })).toEqual([]);
    const unfinished = await checkLua(factory, { path: 'a/b.lua', text: 'x = "abc\n' });
    expect(unfinished[0]).toMatchObject({ file: 'a/b.lua', line: 1 });
  });

  it('reports a syntax error of the main file when it runs', async () => {
    const ran = await run({ 'main.lua': 'print(1)\nif true then\n' });
    expect(ran.status).toBe('error');
    expect(ran.diagnostics[0]).toMatchObject({ file: 'main.lua', line: 3 });
    expect(ran.out).toBe('');
  });
});

describe('the project', () => {
  it('requires modules from other project files, once each', async () => {
    const ran = await run({
      'main.lua': 'local u = require("util")\nprint(u.double(21), require("util") == u, require("lib.sq").sq(5))',
      'util.lua': 'print("loading util")\nreturn { double = function(n) return n * 2 end }',
      'lib/sq.lua': 'return { sq = function(n) return n * n end }',
    });
    expect(ran.err).toBe('');
    expect(ran.out).toBe('loading util\n42\ttrue\t25\n');
    const folder = await run({ 'main.lua': 'print(require("pkg").name)', 'pkg/init.lua': 'return { name = "pkg" }' });
    expect(folder.out).toBe('pkg\n');
  });

  it('maps an error inside a module to that module', async () => {
    const ran = await run({
      'main.lua': 'local u = require("util")\nu.go()',
      'util.lua': 'local M = {}\nfunction M.go() local x = nil; return x.field end\nreturn M',
    });
    expect(ran.diagnostics[0]).toMatchObject({ file: 'util.lua', line: 2 });
  });

  it('says which module is missing', async () => {
    const ran = await run({ 'main.lua': 'require("nope")' });
    expect(ran.err).toContain(
      "module 'nope' not found:\n\tno field package.preload['nope']\n\tno file 'nope.lua' in the project",
    );
  });

  it('reads project files with io.open and io.lines, and keeps writes in the overlay', async () => {
    const ran = await run({
      'main.lua':
        'local f = io.open("data.txt")\nprint(f:read("l"), f:read("n"), f:read("a"))\nf:close()\nfor l in io.lines("data.txt") do io.write("[", l, "]") end\nprint()\nprint(io.open("missing.txt"))\nlocal w = io.open("out.txt", "w")\nw:write("x", 1)\nw:close()\nprint(io.open("out.txt"):read("a"))\nprint(dofile("util.lua"))',
      'data.txt': 'first\n42 rest\nlast',
      'util.lua': 'return 7',
    });
    expect(ran.err).toBe('');
    expect(ran.out).toBe(
      'first\t42\t rest\nlast\n[first][42 rest][last]\nnil\tmissing.txt: No such file or directory\t2\nx1\n7\n',
    );
    expect(ran.written).toEqual(['out.txt']);
  });
});

describe('limits', () => {
  it('stops at the time limit', async () => {
    expect((await run({ 'main.lua': 'while true do end' }, { timeMs: 300 })).status).toBe('time');
  });

  it('stops at the memory limit', async () => {
    const ran = await run(
      { 'main.lua': 'local t = {}\nfor i = 1, 1e9 do t[i] = {i} end' },
      { memoryBytes: 8 * 1024 * 1024 },
    );
    expect(ran.status).toBe('memory');
  });

  it('catches a stack overflow as an error with the line', async () => {
    const ran = await run({ 'main.lua': 'local function f() return 1 + f() end\nf()' });
    expect(ran.status).toBe('error');
    expect(ran.diagnostics[0]).toMatchObject({ line: 1 });
    expect(ran.err).toContain('stack overflow');
  });
});

describe('escapes', () => {
  it('has no way to run a program or load native code', async () => {
    const ran = await run({
      'main.lua':
        'print(os.execute, io.popen, io.tmpfile, package.loadlib, os.remove, os.rename, os.tmpname, debug.getregistry)\nprint(os.getenv("PATH"), package.cpath == "")\nprint(pcall(require, "os.execute"))',
    });
    expect(ran.out.split('\n')[0]).toBe('nil\tnil\tnil\tnil\tnil\tnil\tnil\tnil');
    expect(ran.out.split('\n')[1]).toBe('nil\ttrue');
    expect(ran.out.split('\n')[2]).toMatch(/^false\t/);
  });

  it('cannot read or run a file outside the project', async () => {
    const ran = await run({
      'main.lua':
        'print(io.open("/etc/passwd"))\nprint(io.open("../secret.txt"))\nprint(io.open("C:\\\\Windows\\\\win.ini"))\nprint(pcall(dofile, "../x.lua"))\nprint(loadfile("/etc/passwd"))',
    });
    expect(ran.err).toBe('');
    const lines = ran.out.split('\n');
    expect(lines[0]).toBe('nil\t/etc/passwd: No such file or directory\t2');
    expect(lines[1]).toBe('nil\t../secret.txt: No such file or directory\t2');
    expect(lines[2]).toMatch(/^nil\t.*No such file or directory\t2$/);
    expect(lines[3]).toMatch(/^false\t.*No such file or directory/);
    expect(lines[4]).toBe('nil\t/etc/passwd: No such file or directory');
  });

  it('keeps the host functions out of the program, and the standard library in place', async () => {
    const ran = await run({ 'main.lua': 'print(__host, host, _VERSION, type(string.format), type(utf8.char))' });
    expect(ran.out).toBe('nil\tnil\tLua 5.4\tfunction\tfunction\n');
  });
});

describe('versions', () => {
  it('keeps the pinned wasmoon version equal to package.json', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../../../../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const pinned = { ...manifest.dependencies, ...manifest.devDependencies };
    expect(pinned.wasmoon).toBe(WASMOON_VERSION);
    expect(pinned['@sqlite.org/sqlite-wasm']).toBe('3.54.1-build1');
  });
});
